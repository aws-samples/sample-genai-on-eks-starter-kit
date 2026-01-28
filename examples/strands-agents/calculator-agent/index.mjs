#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Calculator Agent";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

// Pre-built public ECR image
const ECR_REGISTRY_ALIAS = "agentic-ai-platforms-on-k8s";
const IMAGE_NAME = "strands-agents-calculator-agent";
const IMAGE_URL = `public.ecr.aws/${ECR_REGISTRY_ALIAS}/${IMAGE_NAME}:latest`;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  await $`kubectl apply -f ${path.join(DIR, "..", "namespace.yaml")}`;
  const agentTemplatePath = path.join(DIR, "agent.template.yaml");
  const agentRenderedPath = path.join(DIR, "agent.rendered.yaml");
  const agentTemplateString = fs.readFileSync(agentTemplatePath, "utf8");
  const agentTemplate = handlebars.compile(agentTemplateString);
  const { useBuildx, arch } = config.docker;
  const { LITELLM_API_KEY } = process.env;
  const agentVars = {
    useBuildx,
    arch,
    IMAGE: IMAGE_URL,
    ...config["examples"]["strands-agents"]["calculator-agent"].env,
    LITELLM_BASE_URL: `http://litellm.litellm:4000`,
    LITELLM_API_KEY: LITELLM_API_KEY,
  };
  const result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
  if (result.stdout.includes("langfuse")) {
    agentVars.LANGFUSE_HOST = "http://langfuse-web.langfuse:3000";
    agentVars.LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
    agentVars.LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
  }
  fs.writeFileSync(agentRenderedPath, agentTemplate(agentVars));
  await $`kubectl apply -f ${DIR}/agent.rendered.yaml`;
}

export async function uninstall() {
  await $`kubectl delete -f ${DIR}/agent.rendered.yaml --ignore-not-found`;
}