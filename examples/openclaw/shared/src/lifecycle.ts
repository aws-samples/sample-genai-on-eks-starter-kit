export class LifecycleManager {
  private _lastActivity: Date;
  private _shutdown = false;

  constructor() {
    this._lastActivity = new Date();
  }

  get lastActivityTime(): Date {
    return this._lastActivity;
  }

  get isShuttingDown(): boolean {
    return this._shutdown;
  }

  updateLastActivity(): void {
    this._lastActivity = new Date();
  }

  async gracefulShutdown(): Promise<void> {
    console.log("Lifecycle: initiating graceful shutdown");
    this._shutdown = true;
    console.log("Lifecycle: shutdown flag set, cleanup complete");
  }
}
