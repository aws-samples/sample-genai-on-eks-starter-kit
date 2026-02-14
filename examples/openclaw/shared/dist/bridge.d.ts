import express from "express";
import type { OpenClawClient } from "./openclaw-client.js";
import type { LifecycleManager } from "./lifecycle.js";
export interface BridgeDeps {
    openclawClient: OpenClawClient;
    lifecycle: LifecycleManager;
    authToken?: string;
}
export declare function createApp(deps: BridgeDeps): express.Express;
