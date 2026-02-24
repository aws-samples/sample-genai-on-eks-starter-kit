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
    // Set auth to env-based (gateway auth uses OPENCLAW_GATEWAY_TOKEN env var)
    config.auth = { ...config.auth, method: "env" };
    delete config.auth.token;
    // Remove Telegram section entirely
    delete config.telegram;
    // Configure LLM section — keep apiKey in config for Gateway to use
    config.llm = { ...config.llm };
    if (options?.llmApiBaseUrl) {
        config.llm.apiBaseUrl = options.llmApiBaseUrl;
    }
    if (options?.llmModel) {
        config.llm.model = options.llmModel;
    }
    if (options?.llmApiKey) {
        config.llm.apiKey = options.llmApiKey;
    }
    (0, node_fs_1.writeFileSync)(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log("[patch-config] Final config:", JSON.stringify(config, null, 2));
}
// CLI entry point: node patch-config.js <configPath>
const configPath = process.argv[2];
if (configPath) {
    const llmApiBaseUrl = process.env.LITELLM_BASE_URL || "http://litellm.litellm:4000";
    const llmModel = process.env.LITELLM_MODEL_NAME;
    const llmApiKey = process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY;
    patchConfig(configPath, { llmApiBaseUrl, llmModel, llmApiKey });
    console.log(`[patch-config] Patched ${configPath}`);
}
