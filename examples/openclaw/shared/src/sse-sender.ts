import type { Response } from "express";

export class SseSender {
  private res: Response;
  private chunkCount = 0;

  constructor(res: Response) {
    this.res = res;
    this.res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Flush headers immediately so the client knows the SSE stream is open
    if (typeof this.res.flushHeaders === "function") {
      this.res.flushHeaders();
    }
  }

  sendChunk(content: string): void {
    this.chunkCount++;
    this.res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }

  sendError(error: string): void {
    console.error("[sse] Sending error to client:", error);
    this.res.write(`data: ${JSON.stringify({ error })}\n\n`);
  }

  sendDone(): void {
    console.log(`[sse] Stream complete, sent ${this.chunkCount} chunks`);
    this.res.write("data: [DONE]\n\n");
    this.res.end();
  }
}
