"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleManager = void 0;
class LifecycleManager {
    _lastActivity;
    _shutdown = false;
    constructor() {
        this._lastActivity = new Date();
    }
    get lastActivityTime() {
        return this._lastActivity;
    }
    get isShuttingDown() {
        return this._shutdown;
    }
    updateLastActivity() {
        this._lastActivity = new Date();
    }
    async gracefulShutdown() {
        console.log("Lifecycle: initiating graceful shutdown");
        this._shutdown = true;
        console.log("Lifecycle: shutdown flag set, cleanup complete");
    }
}
exports.LifecycleManager = LifecycleManager;
