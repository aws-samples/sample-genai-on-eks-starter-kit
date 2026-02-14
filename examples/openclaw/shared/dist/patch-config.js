"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchConfig = patchConfig;
const node_fs_1 = require("node:fs");
const constants_js_1 = require("./constants.js");
function patchConfig(configPath, options) {
    const raw = (0, node_fs_1.readFileSync)(configPath, "utf-8");
    const config = JSON.parse(raw);
    // Set gateway port
    config.gateway = { ...config.gateway, port: constants_js_1.GATEWAY_PORT };
    // Set auth to env-based (no secrets in config)
    config.auth = { ...config.auth, method: "env" };
    delete config.auth.token;
    // Remove Telegram section entirely
    delete config.telegram;
    // Configure LLM section
    config.llm = { ...config.llm };
    delete config.llm.apiKey;
    if (options?.llmApiBaseUrl) {
        config.llm.apiBaseUrl = options.llmApiBaseUrl;
    }
    if (options?.llmModel) {
        config.llm.model = options.llmModel;
    }
    (0, node_fs_1.writeFileSync)(configPath, JSON.stringify(config, null, 2), "utf-8");
}
// CLI entry point: node patch-config.js <configPath>
// Only run when executed directly, not when imported as a module
if (require.main === module) {
    const configPath = process.argv[2];
    if (configPath) {
        const llmApiBaseUrl = process.env.LITELLM_BASE_URL || "http://litellm.litellm:4000";
        const llmModel = process.env.LITELLM_MODEL_NAME;
        patchConfig(configPath, { llmApiBaseUrl, llmModel });
        console.log(`[patch-config] Patched ${configPath}`);
    }
}
