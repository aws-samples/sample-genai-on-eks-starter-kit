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
  const requiredEnvVars = ["DOMAIN", "LITELLM_API_KEY", "LITELLM_UI_USERNAME", "LITELLM_UI_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await utils.terraform.apply(DIR);

  const integration = { "llm-model": {}, "embedding-model": {}, o11y: {} };
  integration["bedrock"] = {
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
  let result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
  if (result.stdout.includes("langfuse")) {
    integration.o11y["langfuse"] = true;
  }
  result = await $`kubectl get pod -n phoenix -l app=phoenix --ignore-not-found`;
  if (result.stdout.includes("phoenix")) {
    integration.o11y["phoenix"] = true;
  }
  integration.o11y.config = {};
  if (integration.o11y["langfuse"] && integration.o11y["phoenix"]) {
    integration.o11y.config["callbacks"] = '["langfuse", "arize_phoenix"]';
    integration.o11y.config["success_callback"] = '["langfuse"]';
    integration.o11y.config["failure_callback"] = '["langfuse"]';
  } else if (integration.o11y["langfuse"]) {
    integration.o11y.config["callbacks"] = '["langfuse"]';
    integration.o11y.config["success_callback"] = '["langfuse"]';
    integration.o11y.config["failure_callback"] = '["langfuse"]';
  } else if (integration.o11y["phoenix"]) {
    integration.o11y.config["callbacks"] = '["arize_phoenix"]';
  }
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
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm upgrade --install litellm oci://ghcr.io/berriai/litellm-helm --namespace litellm --create-namespace -f ${valuesRenderedPath}`;
}

export async function uninstall() {
  await $`helm uninstall litellm --namespace litellm`;
}
