interface PatchOptions {
    llmModel?: string;
    llmApiBaseUrl?: string;
}
export declare function patchConfig(configPath: string, options?: PatchOptions): void;
export {};
