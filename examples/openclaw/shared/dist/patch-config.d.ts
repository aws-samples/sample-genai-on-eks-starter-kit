interface PatchOptions {
    llmModel?: string;
    llmApiBaseUrl?: string;
    llmApiKey?: string;
}
export declare function patchConfig(configPath: string, options?: PatchOptions): void;
export {};
