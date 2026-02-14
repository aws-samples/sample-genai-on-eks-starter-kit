import WebSocket from "ws";
import { randomUUID } from "node:crypto";

interface PendingChat {
  resolve: () => void;
  reject: (reason: Error) => void;
  chunks: string[];
  chunkResolve: ((value: IteratorResult<string>) => void) | null;
  chunkReject: ((reason: Error) => void) | null;
  lastTextLength: number;
}

type ReqHandler = {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
};

export class OpenClawClient {
  readonly gatewayUrl: string;
  private ws: WebSocket | null = null;
  private token: string;
  private nextId = 1;
  private sessionKey = "";
  private pendingRequests = new Map<string, ReqHandler>();
  private activeRuns = new Map<string, PendingChat>();
  private readyResolve!: () => void;
  private readyReject!: (reason: Error) => void;
  private readyPromise: Promise<void>;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(baseUrl: string, token: string) {
    this.gatewayUrl = baseUrl;
    this.token = token;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.connect();
  }

  waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  private connect(): void {
    this.ws = new WebSocket(this.gatewayUrl);

    this.ws.on("error", (err) => {
      this.readyReject(err instanceof Error ? err : new Error(String(err)));
    });

    this.ws.on("message", (raw: WebSocket.Data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch (err) {
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
        this.ws!.send(JSON.stringify(connectReq));
        return;
      }

      // Gateway hello-ok — handshake complete
      if (msg.type === "res" && msg.id === "connect-1" && msg.ok === true) {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (payload?.type === "hello-ok") {
          const snapshot = payload.snapshot as Record<string, unknown> | undefined;
          const sessionDefaults = snapshot?.sessionDefaults as
            | Record<string, unknown>
            | undefined;
          this.sessionKey = (sessionDefaults?.mainSessionKey as string) ?? "main";
          console.log("Gateway handshake complete, sessionKey:", this.sessionKey);
          this.readyResolve();
          return;
        }
      }

      // Gateway connect error
      if (msg.type === "res" && msg.id === "connect-1" && msg.ok === false) {
        const error = msg.error as Record<string, unknown> | undefined;
        this.readyReject(
          new Error(`Gateway connect failed: ${error?.message ?? JSON.stringify(msg)}`),
        );
        return;
      }

      // Response to a pending request (chat.send -> runId)
      if (msg.type === "res" && msg.id && msg.id !== "connect-1") {
        const pending = this.pendingRequests.get(msg.id as string);
        if (pending) {
          this.pendingRequests.delete(msg.id as string);
          if (msg.ok === true) {
            pending.resolve((msg.payload as Record<string, unknown>) ?? {});
          } else {
            const error = msg.error as Record<string, unknown> | undefined;
            pending.reject(new Error((error?.message as string) ?? "Request failed"));
          }
        }
        return;
      }

      // Agent streaming event — carries cumulative text per token
      if (msg.type === "event" && msg.event === "agent") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (!payload) return;
        const runId = (payload.runId ?? payload.run) as string;
        if (!runId) return;
        const run = this.activeRuns.get(runId);
        if (!run) return;

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
            } else {
              run.chunks.push(delta);
            }
          }
        }
        return;
      }

      // Chat lifecycle event — final/error/aborted
      if (msg.type === "event" && msg.event === "chat") {
        const payload = msg.payload as Record<string, unknown> | undefined;
        if (!payload) return;
        const runId = payload.runId as string;
        const run = this.activeRuns.get(runId);
        if (!run) return;

        if (payload.state === "final") {
          this.activeRuns.delete(runId);
          if (run.chunkResolve) {
            const resolve = run.chunkResolve;
            run.chunkResolve = null;
            run.chunkReject = null;
            resolve({ value: "", done: true });
          }
          run.resolve();
        } else if (payload.state === "error" || payload.state === "aborted") {
          this.activeRuns.delete(runId);
          const err = new Error(
            (payload.errorMessage as string) ?? `Chat ${payload.state}`,
          );
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
      } else {
        console.error("Max reconnection attempts reached");
      }
    });
  }

  async *sendMessage(message: string): AsyncGenerator<string> {
    await this.readyPromise;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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
        idempotencyKey: randomUUID(),
      },
    };

    const chat: PendingChat = {
      resolve: () => {},
      reject: () => {},
      chunks: [],
      chunkResolve: null,
      chunkReject: null,
      lastTextLength: 0,
    };

    const completionPromise = new Promise<void>((resolve, reject) => {
      chat.resolve = resolve;
      chat.reject = reject;
    });

    // Wait for chat.send response to get runId
    const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve, reject });
    });

    this.ws.send(JSON.stringify(request));

    const payload = await responsePromise;
    const runId = payload?.runId as string;
    if (!runId) {
      throw new Error("No runId in chat.send response");
    }
    this.activeRuns.set(runId, chat);

    // Yield chunks as they arrive
    while (true) {
      if (chat.chunks.length > 0) {
        yield chat.chunks.shift()!;
        continue;
      }

      const result = await Promise.race([
        new Promise<IteratorResult<string>>((resolve, reject) => {
          chat.chunkResolve = resolve;
          chat.chunkReject = reject;
        }),
        completionPromise.then(
          () => ({ value: "", done: true }) as IteratorResult<string>,
          (err) => {
            throw err;
          },
        ),
      ]);

      if (result.done) {
        return;
      }
      yield result.value;
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

function extractTextContent(message: unknown): string {
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>;
    if (typeof msg.content === "string") return msg.content;
    if (typeof msg.text === "string") return msg.text;
    // Claude-style content blocks
    if (Array.isArray(msg.content)) {
      return (msg.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text")
        .map((b) => b.text as string)
        .join("");
    }
  }
  return "";
}
