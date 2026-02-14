import { readFileSync, writeFileSync } from "node:fs";
import { GATEWAY_PORT } from "./constants.js";

interface PatchOptions {
  llmModel?: string;
  llmApiBaseUrl?: string;
}

export function patchConfig(configPath: string, options?: PatchOptions): void {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as Record<string, Record<string, unknown>>;

  // Set gateway port
  config.gateway = { ...config.gateway, port: GATEWAY_PORT };

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

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
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
