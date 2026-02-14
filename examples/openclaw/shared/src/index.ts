import * as net from "net";
import { BRIDGE_PORT, GATEWAY_READY_TIMEOUT_MS } from "./constants.js";
import { createApp } from "./bridge.js";
import { OpenClawClient } from "./openclaw-client.js";
import { LifecycleManager } from "./lifecycle.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function tryConnect(): void {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    }
    tryConnect();
  });
}

async function main(): Promise<void> {
  const gatewayToken = requireEnv("OPENCLAW_GATEWAY_TOKEN");
  const authToken = process.env.BRIDGE_AUTH_TOKEN;
  const gatewayUrl = "ws://localhost:18789";

  console.log("Waiting for OpenClaw Gateway to be ready...");
  await waitForPort(18789, GATEWAY_READY_TIMEOUT_MS);

  console.log("Connecting to OpenClaw Gateway...");
  const openclawClient = new OpenClawClient(gatewayUrl, gatewayToken);
  await openclawClient.waitForReady();
  console.log("OpenClaw Gateway connected.");

  const lifecycle = new LifecycleManager();

  const app = createApp({
    openclawClient,
    lifecycle,
    authToken,
  });

  const server = app.listen(BRIDGE_PORT, "0.0.0.0", () => {
    console.log(`Bridge server listening on port ${BRIDGE_PORT}`);
  });

  // SIGTERM handler for graceful shutdown
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    server.close(async () => {
      await lifecycle.gracefulShutdown();
      openclawClient.close();
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
