// === Bridge API ===
export interface BridgeMessageRequest {
  message: string;
}

export interface BridgeHealthResponse {
  status: "ok";
}

export interface BridgeStatusResponse {
  status: "running";
  uptime: number;
  lastActivity: string;
}
