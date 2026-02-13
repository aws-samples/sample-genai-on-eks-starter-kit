export class LifecycleManager {
  private _lastActivity: Date;

  constructor() {
    this._lastActivity = new Date();
  }

  get lastActivityTime(): Date {
    return this._lastActivity;
  }

  updateLastActivity(): void {
    this._lastActivity = new Date();
  }

  async gracefulShutdown(): Promise<void> {
    console.log("Lifecycle: graceful shutdown");
  }
}
