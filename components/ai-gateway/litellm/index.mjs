#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "LiteLLM";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["LITELLM_API_KEY", "LITELLM_UI_USERNAME", "LITELLM_UI_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  const { enableBedrockGuardrail, enableGuardrailsAI } = config["litellm"];
  await utils.terraform.apply(DIR, {
    vars: {
      bedrock_region: config["bedrock"]["region"] || process.env.REGION,
      enable_bedrock_guardrail: enableBedrockGuardrail,
    },
  });

  const integration = { "llm-model": {}, "embedding-model": {}, "mcp-servers": [], o11y: {}, guardrail: {} };
  integration["bedrock"] = {
    region: config["bedrock"]["region"],
    llm: config["bedrock"]["llm"]["models"].filter((m) => m.deploy !== false),
    embedding: config["bedrock"]["embedding"]["models"].filter((m) => m.deploy !== false),
  };
  for (const [key, value] of Object.entries(config["llm-model"])) {
    integration["llm-model"][key] = {};
    try {
      if (key !== "ollama") {
        for (const model of value.models) {
          if (model.deploy) {
            const result = await $`kubectl get pod -n ${key} -l app=${model.name} --ignore-not-found`;
            if (result.stdout.includes(model.name)) {
              integration["llm-model"][key][model.name] = true;
            }
          }
        }
      } else {
        const result = await $`kubectl get pod -n ollama -l app=ollama --ignore-not-found`;
        if (result.stdout.includes("ollama")) {
          for (const model of value.models) {
            integration["llm-model"][key][model] = true;
          }
        }
      }
    } catch {
      // namespace may not exist if this component is not installed — skip
    }
  }
  for (const [key, value] of Object.entries(config["embedding-model"])) {
    integration["embedding-model"][key] = {};
    try {
      for (const model of value.models) {
        if (model.deploy) {
          const result = await $`kubectl get pod -n ${key} -l app=${model.name} --ignore-not-found`;
          if (result.stdout.includes(model.name)) {
            integration["embedding-model"][key][model.name] = true;
          }
        }
      }
    } catch {
      // namespace may not exist if this component is not installed — skip
    }
  }
  try {
    const mcpServices =
      await $`kubectl get services -n mcp-server --no-headers -o custom-columns=":metadata.name" --ignore-not-found`;
    if (mcpServices.stdout.trim()) {
      const serviceNames = mcpServices.stdout
        .trim()
        .split("\n")
        .filter((name) => name.trim());
      for (const serviceName of serviceNames) {
        const name = serviceName.trim();
        integration["mcp-servers"].push({ name, alias: name.replace(/-/g, "_") });
      }
    }
  } catch {
    // mcp-server namespace may not exist yet — skip MCP integration
  }
  const callbacks = [],
    successCallback = [],
    failureCallback = [];
  try {
    let result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
    if (result.stdout.includes("langfuse")) {
      integration.o11y.langfuse = true;
      callbacks.push("langfuse");
      successCallback.push("langfuse");
      failureCallback.push("langfuse");
    }
  } catch {
    // langfuse namespace may not exist — skip
  }
  try {
    let result = await $`kubectl get pod -n mlflow -l app=mlflow --ignore-not-found`;
    if (result.stdout.includes("mlflow")) {
      integration.o11y.mlflow = true;
      successCallback.push("mlflow");
      failureCallback.push("mlflow");
    }
  } catch {
    // mlflow namespace may not exist — skip
  }
  try {
    let result = await $`kubectl get pod -n phoenix -l app=phoenix --ignore-not-found`;
    if (result.stdout.includes("phoenix")) {
      integration.o11y.phoenix = true;
      callbacks.push("arize_phoenix");
    }
  } catch {
    // phoenix namespace may not exist — skip
  }
  // Include the OpenWebUI metadata hook as a callback (pre_call + success/failure events)
  const callbacksWithHook = [...callbacks, "custom_callbacks.openwebui_metadata_hook.instance"];
  integration.o11y.config = {
    callbacks: JSON.stringify(callbacks),
    callbacks_with_hook: JSON.stringify(callbacksWithHook),
    success_callback: JSON.stringify(successCallback),
    failure_callback: JSON.stringify(failureCallback),
  };
  if (enableBedrockGuardrail) {
    const id = await utils.terraform.output(DIR, { outputName: "bedrock_guardrail_id" });
    const version = await utils.terraform.output(DIR, { outputName: "bedrock_guardrail_version" });
    integration.guardrail["bedrock"] = { id, version };
  }
  integration.guardrail["guardrailsAI"] = enableGuardrailsAI;
  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    DOMAIN: process.env.DOMAIN,
    LITELLM_API_KEY: process.env.LITELLM_API_KEY,
    LITELLM_UI_USERNAME: process.env.LITELLM_UI_USERNAME,
    LITELLM_UI_PASSWORD: process.env.LITELLM_UI_PASSWORD,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    PHOENIX_API_KEY: process.env.PHOENIX_API_KEY,
    KGATEWAY_ENABLED: config?.kgateway?.enabled || false,
    integration,
  };
  if (integration.o11y.mlflow) {
    const requiredEnvVars = ["MLFLOW_USERNAME", "MLFLOW_PASSWORD"];
    utils.checkRequiredEnvVars(requiredEnvVars);
    valuesVars.MLFLOW_USERNAME = process.env.MLFLOW_USERNAME;
    valuesVars.MLFLOW_PASSWORD = process.env.MLFLOW_PASSWORD;
  }
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));

  // Create ConfigMap for the OpenWebUI metadata hook (maps forwarded headers → Langfuse metadata)
  await $`kubectl create namespace litellm --dry-run=client -o yaml | kubectl apply -f -`;
  await $`kubectl -n litellm create configmap litellm-custom-callbacks \
    --from-file=__init__.py=/dev/null \
    --from-file=openwebui_metadata_hook.py=${path.join(DIR, "openwebui-metadata-hook.py")} \
    --dry-run=client -o yaml | kubectl apply -f -`;

  await $`helm upgrade --install litellm oci://ghcr.io/berriai/litellm-helm --namespace litellm --create-namespace -f ${valuesRenderedPath}`;
}

export { setupRBAC } from "./setup-rbac.mjs";

export async function uninstall() {
  await $`helm uninstall litellm --namespace litellm`;
  const { enableBedrockGuardrail } = config["litellm"];
  await utils.terraform.destroy(DIR, {
    vars: {
      bedrock_region: config["bedrock"]["region"] || process.env.REGION,
      enable_bedrock_guardrail: enableBedrockGuardrail,
    },
  });
}
