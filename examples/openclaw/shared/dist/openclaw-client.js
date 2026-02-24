"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawClient = void 0;
const ws_1 = __importDefault(require("ws"));
const node_crypto_1 = require("node:crypto");
const constants_js_1 = require("./constants.js");
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms);
        promise.then((val) => { clearTimeout(timer); resolve(val); }, (err) => { clearTimeout(timer); reject(err); });
    });
}
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
        console.log(`[ws] Connecting to ${this.gatewayUrl}...`);
        this.ws = new ws_1.default(this.gatewayUrl);
        this.ws.on("error", (err) => {
            console.error("[ws] Connection error:", err.message || err);
            this.readyReject(err instanceof Error ? err : new Error(String(err)));
        });
        this.ws.on("open", () => {
            console.log("[ws] WebSocket connection opened, waiting for challenge...");
        });
        this.ws.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch (err) {
                console.error("[ws] Failed to parse WebSocket message:", raw.toString().slice(0, 500));
                return;
            }
            console.log("[ws] Received:", msg.type, msg.event ?? msg.id ?? "", msg.ok ?? "");
            // Gateway connect challenge — respond with connect request
            if (msg.type === "event" && msg.event === "connect.challenge") {
                console.log("[ws] Received connect challenge, sending auth...");
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
            // Gateway connect response — accept with or without hello-ok payload type
            if (msg.type === "res" && msg.id === "connect-1") {
                if (msg.ok === true) {
                    const payload = msg.payload;
                    // Accept the handshake regardless of payload.type — some gateway versions
                    // return hello-ok, others return the snapshot directly
                    const snapshot = (payload?.snapshot ?? payload);
                    const sessionDefaults = snapshot?.sessionDefaults;
                    this.sessionKey = sessionDefaults?.mainSessionKey ?? "main";
                    console.log("[ws] Gateway handshake complete, sessionKey:", this.sessionKey);
                    console.log("[ws] Handshake payload type:", payload?.type ?? "(none)");
                    this.reconnectAttempts = 0;
                    this.readyResolve();
                    return;
                }
                else {
                    const error = msg.error;
                    console.error("[ws] Gateway connect failed:", JSON.stringify(msg));
                    this.readyReject(new Error(`Gateway connect failed: ${error?.message ?? JSON.stringify(msg)}`));
                    return;
                }
            }
            // Response to a pending request (chat.send -> runId)
            if (msg.type === "res" && msg.id && msg.id !== "connect-1") {
                const pending = this.pendingRequests.get(msg.id);
                if (pending) {
                    this.pendingRequests.delete(msg.id);
                    if (msg.ok === true) {
                        console.log("[ws] chat.send response OK, payload:", JSON.stringify(msg.payload).slice(0, 300));
                        pending.resolve(msg.payload ?? {});
                    }
                    else {
                        const error = msg.error;
                        console.error("[ws] chat.send response FAILED:", JSON.stringify(msg));
                        pending.reject(new Error(error?.message ?? "Request failed"));
                    }
                }
                else {
                    console.warn("[ws] Unhandled response for id:", msg.id);
                }
                return;
            }
            // Agent streaming event — carries cumulative text per token
            if (msg.type === "event" && msg.event === "agent") {
                const payload = msg.payload;
                if (!payload)
                    return;
                const runId = (payload.runId ?? payload.run);
                if (!runId) {
                    console.warn("[ws] agent event without runId:", JSON.stringify(payload).slice(0, 200));
                    return;
                }
                const run = this.activeRuns.get(runId);
                if (!run) {
                    console.warn("[ws] agent event for unknown runId:", runId);
                    return;
                }
                if (payload.stream === "assistant" && payload.data != null) {
                    const fullText = extractTextContent(payload.data);
                    const delta = fullText.slice(run.lastTextLength);
                    run.lastTextLength = fullText.length;
                    run.lastChunkTime = Date.now();
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
                if (!run) {
                    console.warn("[ws] chat event for unknown runId:", runId, "state:", payload.state);
                    return;
                }
                console.log("[ws] chat lifecycle event:", payload.state, "runId:", runId);
                if (payload.state === "final" || payload.state === "completed") {
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
            // Log any unhandled message types for debugging
            console.log("[ws] Unhandled message:", JSON.stringify(msg).slice(0, 500));
        });
        this.ws.on("close", (code, reason) => {
            console.log(`[ws] WebSocket closed (code=${code}, reason=${reason?.toString() ?? "none"})`);
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.pow(2, this.reconnectAttempts) * 1000;
                this.reconnectAttempts++;
                console.log(`[ws] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                setTimeout(() => this.connect(), delay);
            }
            else {
                console.error("[ws] Max reconnection attempts reached, giving up");
                // Reject all pending requests
                for (const [id, handler] of this.pendingRequests) {
                    handler.reject(new Error("WebSocket closed, max reconnect attempts reached"));
                    this.pendingRequests.delete(id);
                }
                for (const [id, run] of this.activeRuns) {
                    run.reject(new Error("WebSocket closed, max reconnect attempts reached"));
                    this.activeRuns.delete(id);
                }
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
            lastChunkTime: Date.now(),
        };
        const completionPromise = new Promise((resolve, reject) => {
            chat.resolve = resolve;
            chat.reject = reject;
        });
        // Wait for chat.send response to get runId — WITH TIMEOUT
        const responsePromise = new Promise((resolve, reject) => {
            this.pendingRequests.set(reqId, { resolve, reject });
        });
        console.log("[bridge] Sending chat.send request, reqId:", reqId);
        this.ws.send(JSON.stringify(request));
        const payload = await withTimeout(responsePromise, constants_js_1.CHAT_SEND_TIMEOUT_MS, "chat.send response");
        const runId = (payload?.runId ?? payload?.run ?? payload?.id);
        if (!runId) {
            console.error("[bridge] No runId in chat.send response. Full payload:", JSON.stringify(payload));
            throw new Error("No runId in chat.send response");
        }
        console.log("[bridge] Got runId:", runId);
        this.activeRuns.set(runId, chat);
        // Overall stream timeout
        const streamDeadline = Date.now() + constants_js_1.CHAT_STREAM_TIMEOUT_MS;
        // Yield chunks as they arrive
        while (true) {
            if (chat.chunks.length > 0) {
                yield chat.chunks.shift();
                continue;
            }
            // Check overall timeout
            if (Date.now() > streamDeadline) {
                this.activeRuns.delete(runId);
                throw new Error(`Stream timeout: no completion after ${constants_js_1.CHAT_STREAM_TIMEOUT_MS}ms`);
            }
            // Check idle timeout (no chunks for too long)
            const idleDuration = Date.now() - chat.lastChunkTime;
            if (idleDuration > constants_js_1.CHAT_IDLE_TIMEOUT_MS) {
                this.activeRuns.delete(runId);
                throw new Error(`Stream idle timeout: no data for ${constants_js_1.CHAT_IDLE_TIMEOUT_MS}ms`);
            }
            const result = await Promise.race([
                new Promise((resolve, reject) => {
                    chat.chunkResolve = resolve;
                    chat.chunkReject = reject;
                }),
                completionPromise.then(() => ({ value: "", done: true }), (err) => {
                    throw err;
                }),
                // Idle check timer — wake up to re-check timeouts
                new Promise((resolve) => {
                    setTimeout(() => resolve({ value: "", done: false }), 5_000);
                }),
            ]);
            if (result.done) {
                return;
            }
            // Skip empty wake-up ticks (from the idle check timer)
            if (result.value) {
                yield result.value;
            }
        }
    }
    close() {
        this.maxReconnectAttempts = 0; // prevent reconnection on intentional close
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
