import type { Response } from "express";

export class SseSender {
  private res: Response;

  constructor(res: Response) {
    this.res = res;
    this.res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  }

  sendChunk(content: string): void {
    this.res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }

  sendError(error: string): void {
    this.res.write(`data: ${JSON.stringify({ error })}\n\n`);
  }

  sendDone(): void {
    this.res.write("data: [DONE]\n\n");
    this.res.end();
  }
}
