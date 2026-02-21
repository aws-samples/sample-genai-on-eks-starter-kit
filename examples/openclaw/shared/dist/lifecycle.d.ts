export declare class LifecycleManager {
    private _lastActivity;
    private _shutdown;
    constructor();
    get lastActivityTime(): Date;
    get isShuttingDown(): boolean;
    updateLastActivity(): void;
    gracefulShutdown(): Promise<void>;
}
