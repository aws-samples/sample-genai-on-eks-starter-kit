export declare class OpenClawClient {
    readonly gatewayUrl: string;
    private ws;
    private token;
    private nextId;
    private sessionKey;
    private pendingRequests;
    private activeRuns;
    private readyResolve;
    private readyReject;
    private readyPromise;
    private reconnectAttempts;
    private maxReconnectAttempts;
    constructor(baseUrl: string, token: string);
    waitForReady(): Promise<void>;
    private connect;
    sendMessage(message: string): AsyncGenerator<string>;
    close(): void;
}
