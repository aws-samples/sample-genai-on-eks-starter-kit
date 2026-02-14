"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const net = __importStar(require("net"));
const constants_js_1 = require("./constants.js");
const bridge_js_1 = require("./bridge.js");
const openclaw_client_js_1 = require("./openclaw-client.js");
const lifecycle_js_1 = require("./lifecycle.js");
function requireEnv(name) {
    const val = process.env[name];
    if (!val) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return val;
}
function waitForPort(port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        function tryConnect() {
            const sock = net.createConnection({ port, host: "127.0.0.1" });
            sock.once("connect", () => {
                sock.destroy();
                resolve();
            });
            sock.once("error", () => {
                sock.destroy();
                if (Date.now() >= deadline) {
                    reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
                }
                else {
                    setTimeout(tryConnect, 500);
                }
            });
        }
        tryConnect();
    });
}
async function main() {
    const gatewayToken = requireEnv("OPENCLAW_GATEWAY_TOKEN");
    const authToken = process.env.BRIDGE_AUTH_TOKEN;
    const gatewayUrl = "ws://localhost:18789";
    console.log("Waiting for OpenClaw Gateway to be ready...");
    await waitForPort(18789, constants_js_1.GATEWAY_READY_TIMEOUT_MS);
    console.log("Connecting to OpenClaw Gateway...");
    const openclawClient = new openclaw_client_js_1.OpenClawClient(gatewayUrl, gatewayToken);
    await openclawClient.waitForReady();
    console.log("OpenClaw Gateway connected.");
    const lifecycle = new lifecycle_js_1.LifecycleManager();
    const app = (0, bridge_js_1.createApp)({
        openclawClient,
        lifecycle,
        authToken,
    });
    const server = app.listen(constants_js_1.BRIDGE_PORT, "0.0.0.0", () => {
        console.log(`Bridge server listening on port ${constants_js_1.BRIDGE_PORT}`);
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
