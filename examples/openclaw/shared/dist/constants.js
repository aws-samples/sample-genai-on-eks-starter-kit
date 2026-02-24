"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_IDLE_TIMEOUT_MS = exports.CHAT_STREAM_TIMEOUT_MS = exports.CHAT_SEND_TIMEOUT_MS = exports.GATEWAY_READY_TIMEOUT_MS = exports.GATEWAY_PORT = exports.BRIDGE_PORT = void 0;
// Ports
exports.BRIDGE_PORT = 8080;
exports.GATEWAY_PORT = 18789;
// Timeouts (ms)
exports.GATEWAY_READY_TIMEOUT_MS = 120_000;
exports.CHAT_SEND_TIMEOUT_MS = 30_000;
exports.CHAT_STREAM_TIMEOUT_MS = 300_000;
exports.CHAT_IDLE_TIMEOUT_MS = 60_000;
