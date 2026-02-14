export type ServerMessageType = "stream_chunk" | "stream_end" | "error";
export interface ServerMessage {
    type: ServerMessageType;
    content?: string;
    error?: string;
}
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
