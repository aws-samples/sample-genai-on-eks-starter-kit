"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawClient = void 0;
const ws_1 = __importDefault(require("ws"));
const node_crypto_1 = require("node:crypto");
class OpenClawClient {
    gatewayUrl;
    ws = null;
    token;
    nextId = 1;
    sessionKey = "";
    pendingRequests = new Map();
    activeRuns = new Map();
    readyResolve;
    readyReject;
    readyPromise;
    reconnectAttempts = 0;
    maxReconnectAttempts = 3;
    constructor(baseUrl, token) {
        this.gatewayUrl = baseUrl;
        this.token = token;
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });
        this.connect();
    }
    waitForReady() {
        return this.readyPromise;
    }
    connect() {
        this.ws = new ws_1.default(this.gatewayUrl);
        this.ws.on("error", (err) => {
            this.readyReject(err instanceof Error ? err : new Error(String(err)));
        });
        this.ws.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch (err) {
                console.error("Failed to parse WebSocket message:", err);
                return;
            }
            // Gateway connect challenge — respond with connect request
            if (msg.type === "event" && msg.event === "connect.challenge") {
                const connectReq = {
                    type: "req",
                    id: "connect-1",
                    method: "connect",
                    params: {
                        minProtocol: 3,
                        maxProtocol: 3,
                        client: {
                            id: "gateway-client",
                            version: "1.0.0",
                            platform: "linux",
                            mode: "backend",
                        },
                        role: "operator",
                        scopes: ["operator.read", "operator.write"],
                        caps: [],
                        commands: [],
                        permissions: {},
                        auth: { token: this.token },
                        locale: "en-US",
                        userAgent: "openclaw-eks-bridge/1.0",
                    },
                };
                this.ws.send(JSON.stringify(connectReq));
                return;
            }
            // Gateway hello-ok — handshake complete
            if (msg.type === "res" && msg.id === "connect-1" && msg.ok === true) {
                const payload = msg.payload;
                if (payload?.type === "hello-ok") {
                    const snapshot = payload.snapshot;
                    const sessionDefaults = snapshot?.sessionDefaults;
                    this.sessionKey = sessionDefaults?.mainSessionKey ?? "main";
                    console.log("Gateway handshake complete, sessionKey:", this.sessionKey);
                    this.readyResolve();
                    return;
                }
            }
            // Gateway connect error
            if (msg.type === "res" && msg.id === "connect-1" && msg.ok === false) {
                const error = msg.error;
                this.readyReject(new Error(`Gateway connect failed: ${error?.message ?? JSON.stringify(msg)}`));
                return;
            }
            // Response to a pending request (chat.send -> runId)
            if (msg.type === "res" && msg.id && msg.id !== "connect-1") {
                const pending = this.pendingRequests.get(msg.id);
                if (pending) {
                    this.pendingRequests.delete(msg.id);
                    if (msg.ok === true) {
                        pending.resolve(msg.payload ?? {});
                    }
                    else {
                        const error = msg.error;
                        pending.reject(new Error(error?.message ?? "Request failed"));
                    }
                }
                return;
            }
            // Agent streaming event — carries cumulative text per token
            if (msg.type === "event" && msg.event === "agent") {
                const payload = msg.payload;
                if (!payload)
                    return;
                const runId = (payload.runId ?? payload.run);
                if (!runId)
                    return;
                const run = this.activeRuns.get(runId);
                if (!run)
                    return;
                if (payload.stream === "assistant" && payload.data != null) {
                    const fullText = extractTextContent(payload.data);
                    const delta = fullText.slice(run.lastTextLength);
                    run.lastTextLength = fullText.length;
                    if (delta) {
                        if (run.chunkResolve) {
                            const resolve = run.chunkResolve;
                            run.chunkResolve = null;
                            run.chunkReject = null;
                            resolve({ value: delta, done: false });
                        }
                        else {
                            run.chunks.push(delta);
                        }
                    }
                }
                return;
            }
            // Chat lifecycle event — final/error/aborted
            if (msg.type === "event" && msg.event === "chat") {
                const payload = msg.payload;
                if (!payload)
                    return;
                const runId = payload.runId;
                const run = this.activeRuns.get(runId);
                if (!run)
                    return;
                if (payload.state === "final") {
                    this.activeRuns.delete(runId);
                    if (run.chunkResolve) {
                        const resolve = run.chunkResolve;
                        run.chunkResolve = null;
                        run.chunkReject = null;
                        resolve({ value: "", done: true });
                    }
                    run.resolve();
                }
                else if (payload.state === "error" || payload.state === "aborted") {
                    this.activeRuns.delete(runId);
                    const err = new Error(payload.errorMessage ?? `Chat ${payload.state}`);
                    if (run.chunkReject) {
                        const reject = run.chunkReject;
                        run.chunkResolve = null;
                        run.chunkReject = null;
                        reject(err);
                    }
                    run.reject(err);
                }
                return;
            }
        });
        this.ws.on("close", () => {
            console.log("WebSocket closed");
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.pow(2, this.reconnectAttempts) * 1000;
                this.reconnectAttempts++;
                console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                setTimeout(() => this.connect(), delay);
            }
            else {
                console.error("Max reconnection attempts reached");
            }
        });
    }
    async *sendMessage(message) {
        await this.readyPromise;
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new Error("WebSocket not connected");
        }
        const reqId = String(this.nextId++);
        const request = {
            type: "req",
            id: reqId,
            method: "chat.send",
            params: {
                sessionKey: this.sessionKey,
                message,
                idempotencyKey: (0, node_crypto_1.randomUUID)(),
            },
        };
        const chat = {
            resolve: () => { },
            reject: () => { },
            chunks: [],
            chunkResolve: null,
            chunkReject: null,
            lastTextLength: 0,
        };
        const completionPromise = new Promise((resolve, reject) => {
            chat.resolve = resolve;
            chat.reject = reject;
        });
        // Wait for chat.send response to get runId
        const responsePromise = new Promise((resolve, reject) => {
            this.pendingRequests.set(reqId, { resolve, reject });
        });
        this.ws.send(JSON.stringify(request));
        const payload = await responsePromise;
        const runId = payload?.runId;
        if (!runId) {
            throw new Error("No runId in chat.send response");
        }
        this.activeRuns.set(runId, chat);
        // Yield chunks as they arrive
        while (true) {
            if (chat.chunks.length > 0) {
                yield chat.chunks.shift();
                continue;
            }
            const result = await Promise.race([
                new Promise((resolve, reject) => {
                    chat.chunkResolve = resolve;
                    chat.chunkReject = reject;
                }),
                completionPromise.then(() => ({ value: "", done: true }), (err) => {
                    throw err;
                }),
            ]);
            if (result.done) {
                return;
            }
            yield result.value;
        }
    }
    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}
exports.OpenClawClient = OpenClawClient;
function extractTextContent(message) {
    if (typeof message === "string")
        return message;
    if (message && typeof message === "object") {
        const msg = message;
        if (typeof msg.content === "string")
            return msg.content;
        if (typeof msg.text === "string")
            return msg.text;
        // Claude-style content blocks
        if (Array.isArray(msg.content)) {
            return msg.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("");
        }
    }
    return "";
}
