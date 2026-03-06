#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Document Writer Agent";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

// Pre-built public ECR image
const ECR_REGISTRY_ALIAS = "agentic-ai-platforms-on-k8s";
const IMAGE_NAME = "openclaw-doc-writer";
const IMAGE_URL = `public.ecr.aws/${ECR_REGISTRY_ALIAS}/${IMAGE_NAME}:latest`;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  // Check required environment variables
  const requiredEnvVars = ["LITELLM_API_KEY"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  // Apply namespace and K8s manifests
  console.log("Applying Kubernetes manifests...");
  await $`kubectl apply -f ${path.join(DIR, "..", "namespace.yaml")}`;

  const agentTemplatePath = path.join(DIR, "agent.template.yaml");
  const agentRenderedPath = path.join(DIR, "agent.rendered.yaml");
  const agentTemplateString = fs.readFileSync(agentTemplatePath, "utf8");
  const agentTemplate = handlebars.compile(agentTemplateString);
  const { LITELLM_API_KEY, OPENCLAW_DOC_WRITER_GIT_USERNAME, OPENCLAW_DOC_WRITER_GIT_TOKEN } = process.env;
  const agentVars = {
    IMAGE: IMAGE_URL,
    ...config["examples"]["openclaw"]["doc-writer"].env,
    LITELLM_BASE_URL: "http://litellm.litellm:4000",
    LITELLM_API_KEY: LITELLM_API_KEY,
  };

  // Wire git credentials if provided
  if (OPENCLAW_DOC_WRITER_GIT_USERNAME) {
    agentVars.GIT_USERNAME = OPENCLAW_DOC_WRITER_GIT_USERNAME;
  }
  if (OPENCLAW_DOC_WRITER_GIT_TOKEN) {
    agentVars.GIT_TOKEN = OPENCLAW_DOC_WRITER_GIT_TOKEN;
  }

  // Check if Langfuse is available
  const result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
  if (result.stdout.includes("langfuse")) {
    console.log("Langfuse detected, enabling observability integration...");
    if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
      console.warn("Warning: Langfuse detected but LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set in .env. Skipping Langfuse integration.");
    } else {
      agentVars.LANGFUSE_HOST = "http://langfuse-web.langfuse:3000";
      agentVars.LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
      agentVars.LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
    }
  }

  fs.writeFileSync(agentRenderedPath, agentTemplate(agentVars));
  await $`kubectl apply -f ${agentRenderedPath}`;

  console.log("Document Writer Agent installed successfully!");
  console.log(`Agent will be available at: http://doc-writer.openclaw:8080`);
}

export async function uninstall() {
  console.log("Uninstalling Document Writer Agent...");
  await $`kubectl delete -f ${DIR}/agent.rendered.yaml --ignore-not-found`;
  console.log("Document Writer Agent uninstalled successfully!");
}
