"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SseSender = void 0;
class SseSender {
    res;
    constructor(res) {
        this.res = res;
        this.res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
    }
    sendChunk(content) {
        this.res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
    sendError(error) {
        this.res.write(`data: ${JSON.stringify({ error })}\n\n`);
    }
    sendDone() {
        this.res.write("data: [DONE]\n\n");
        this.res.end();
    }
}
exports.SseSender = SseSender;
