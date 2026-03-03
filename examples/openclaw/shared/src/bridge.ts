import express from "express";
import { SseSender } from "./sse-sender.js";
import type { OpenClawClient } from "./openclaw-client.js";
import type { LifecycleManager } from "./lifecycle.js";
import type { BridgeMessageRequest } from "./types.js";

export interface BridgeDeps {
  openclawClient: OpenClawClient;
  lifecycle: LifecycleManager;
  authToken?: string;
}

export function createApp(deps: BridgeDeps): express.Express {
  const startTime = Date.now();
  const app = express();

  app.use(express.json());

  // Optional Bearer token auth
  if (deps.authToken) {
    app.use((req, res, next) => {
      if (req.path === "/health") return next();
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${deps.authToken}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/message", async (req, res) => {
    const body = req.body as Partial<BridgeMessageRequest>;

    console.log("[bridge] POST /message received, message length:", body.message?.length ?? 0);

    if (!body.message) {
      console.warn("[bridge] Missing 'message' field in request body. Keys:", Object.keys(body));
      res.status(400).json({ error: "Missing required field: message" });
      return;
    }

    deps.lifecycle.updateLastActivity();

    const sse = new SseSender(res);

    // Use res.on("close") instead of req.on("close") — the response
    // stream closing is the reliable signal that the client disconnected.
    let clientGone = false;
    res.on("close", () => {
      clientGone = true;
      console.log("[bridge] Response stream closed (client disconnected)");
    });

    try {
      console.log("[bridge] Sending message to OpenClaw Gateway...");
      const generator = deps.openclawClient.sendMessage(body.message);
      let chunkCount = 0;
      for await (const chunk of generator) {
        if (clientGone || res.destroyed) {
          console.log("[bridge] Stopping iteration — client gone");
          break;
        }
        chunkCount++;
        sse.sendChunk(chunk);
      }
      console.log(`[bridge] Stream finished, ${chunkCount} chunks delivered`);
      if (!clientGone && !res.destroyed) {
        sse.sendDone();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[bridge] Error during message processing:", errMsg);
      if (!clientGone && !res.destroyed) {
        sse.sendError(errMsg);
        sse.sendDone();
      }
    }
  });

  app.get("/status", (_req, res) => {
    res.json({
      status: "running",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      lastActivity: deps.lifecycle.lastActivityTime.toISOString(),
    });
  });

  return app;
}
