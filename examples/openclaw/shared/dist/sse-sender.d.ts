import type { Response } from "express";
export declare class SseSender {
    private res;
    constructor(res: Response);
    sendChunk(content: string): void;
    sendError(error: string): void;
    sendDone(): void;
}
