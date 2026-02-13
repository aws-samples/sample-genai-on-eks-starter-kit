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

const startTime = Date.now();

export function createApp(deps: BridgeDeps): express.Express {
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

    if (!body.message) {
      res.status(400).json({ error: "Missing required field: message" });
      return;
    }

    deps.lifecycle.updateLastActivity();

    const sse = new SseSender(res);

    try {
      const generator = deps.openclawClient.sendMessage(body.message);
      for await (const chunk of generator) {
        sse.sendChunk(chunk);
      }
      sse.sendDone();
    } catch (err) {
      sse.sendError(err instanceof Error ? err.message : "Unknown error");
      sse.sendDone();
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
