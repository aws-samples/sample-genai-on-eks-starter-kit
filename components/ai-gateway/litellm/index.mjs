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

// LiteLLM Helm **chart** version, pinned for reproducibility so two deploys
// never silently differ and a broken upstream chart cannot reach every event.
//
// Chart 1.100.4 has appVersion 1.100.4, matching image.tag in
// values.template.yaml. Old 0.1.x charts hardcode a db-ready init container on
// docker.io/bitnami/postgresql:16.1.0-debian-11-r20, which no longer exists.
// Override with LITELLM_CHART_VERSION to test a newer chart.
const LITELLM_CHART_VERSION = process.env.LITELLM_CHART_VERSION || "1.100.4";

export async function install() {
  const requiredEnvVars = ["LITELLM_API_KEY", "LITELLM_UI_USERNAME", "LITELLM_UI_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  const { enableBedrockGuardrail, enableGuardrailsAI } = config["litellm"];
  const bedrockRegion = config["bedrock"]["region"] || process.env.REGION;
  // Scope the pod role to exactly the Bedrock models this deployment serves.
  // Anything not listed in config.json cannot be invoked, even by someone who
  // holds the LiteLLM master key.
  const bedrockModelIds = [
    ...(config["bedrock"]["llm"]["models"] ?? []),
    ...(config["bedrock"]["embedding"]["models"] ?? []),
  ]
    .map((m) => m.model)
    .filter(Boolean);
  const bedrockAllowedRegions = [...new Set([bedrockRegion, process.env.REGION].filter(Boolean))];
  await utils.terraform.apply(DIR, {
    vars: {
      bedrock_region: bedrockRegion,
      enable_bedrock_guardrail: enableBedrockGuardrail,
      bedrock_model_ids: bedrockModelIds,
      bedrock_allowed_regions: bedrockAllowedRegions,
    },
  });

  const integration = { "llm-model": {}, "embedding-model": {}, "mcp-servers": [], o11y: {}, guardrail: {} };
  integration["bedrock"] = {
    region: config["bedrock"]["region"],
    llm: config["bedrock"]["llm"]["models"],
    embedding: config["bedrock"]["embedding"]["models"],
  };
  for (const [key, value] of Object.entries(config["llm-model"])) {
    integration["llm-model"][key] = {};
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
  }
  for (const [key, value] of Object.entries(config["embedding-model"])) {
    integration["embedding-model"][key] = {};
    for (const model of value.models) {
      if (model.deploy) {
        const result = await $`kubectl get pod -n ${key} -l app=${model.name} --ignore-not-found`;
        if (result.stdout.includes(model.name)) {
          integration["embedding-model"][key][model.name] = true;
        }
      }
    }
  }
  const mcpServices =
    await $`kubectl get services -n mcp-server --no-headers -o custom-columns=":metadata.name" --ignore-not-found`;
  if (mcpServices.stdout.trim()) {
    const serviceNames = mcpServices.stdout
      .trim()
      .split("\n")
      .filter((name) => name.trim());
    for (const serviceName of serviceNames) {
      integration["mcp-servers"].push(serviceName.trim());
    }
  }
  const callbacks = [],
    successCallback = [],
    failureCallback = [];
  let result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
  if (result.stdout.includes("langfuse")) {
    integration.o11y.langfuse = true;
    callbacks.push("langfuse");
    successCallback.push("langfuse");
    failureCallback.push("langfuse");
  }
  result = await $`kubectl get pod -n  mlflow -l app=mlflow --ignore-not-found`;
  if (result.stdout.includes("mlflow")) {
    integration.o11y.mlflow = true;
    successCallback.push("mlflow");
    failureCallback.push("mlflow");
  }
  result = await $`kubectl get pod -n phoenix -l app=phoenix --ignore-not-found`;
  if (result.stdout.includes("phoenix")) {
    integration.o11y.phoenix = true;
    callbacks.push("arize_phoenix");
  }
  integration.o11y.config = {
    callbacks: JSON.stringify(callbacks),
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
    integration,
  };
  if (integration.o11y.mlflow) {
    const requiredEnvVars = ["MLFLOW_USERNAME", "MLFLOW_PASSWORD"];
    utils.checkRequiredEnvVars(requiredEnvVars);
    valuesVars.MLFLOW_USERNAME = process.env.MLFLOW_USERNAME;
    valuesVars.MLFLOW_PASSWORD = process.env.MLFLOW_PASSWORD;
  }
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  // Install the latest chart by default; add --version only when pinned.
  const versionArgs = LITELLM_CHART_VERSION ? ["--version", LITELLM_CHART_VERSION] : [];
  await $`helm upgrade --install litellm oci://ghcr.io/berriai/litellm-helm ${versionArgs} --namespace litellm --create-namespace -f ${valuesRenderedPath}`;
}

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
