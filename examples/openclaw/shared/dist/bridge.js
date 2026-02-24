"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const sse_sender_js_1 = require("./sse-sender.js");
function createApp(deps) {
    const startTime = Date.now();
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Optional Bearer token auth
    if (deps.authToken) {
        app.use((req, res, next) => {
            if (req.path === "/health")
                return next();
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
        const body = req.body;
        if (!body.message) {
            res.status(400).json({ error: "Missing required field: message" });
            return;
        }
        deps.lifecycle.updateLastActivity();
        const sse = new sse_sender_js_1.SseSender(res);
        let clientDisconnected = false;
        req.on("close", () => {
            clientDisconnected = true;
            console.log("Client disconnected");
        });
        try {
            const generator = deps.openclawClient.sendMessage(body.message);
            for await (const chunk of generator) {
                if (clientDisconnected) {
                    console.log("Stopping iteration due to client disconnect");
                    break;
                }
                sse.sendChunk(chunk);
            }
            if (!clientDisconnected) {
                sse.sendDone();
            }
        }
        catch (err) {
            if (!clientDisconnected) {
                sse.sendError(err instanceof Error ? err.message : "Unknown error");
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
