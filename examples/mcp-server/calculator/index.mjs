#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Calculator MCP Server";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

// Pre-built public ECR image
const ECR_REGISTRY_ALIAS = "agentic-ai-platforms-on-k8s";
const IMAGE_NAME = "mcp-server-calculator";
const IMAGE_URL = `public.ecr.aws/${ECR_REGISTRY_ALIAS}/${IMAGE_NAME}:latest`;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  await $`kubectl apply -f ${path.join(DIR, "..", "namespace.yaml")}`;
  const mcpServerTemplatePath = path.join(DIR, "mcp-server.template.yaml");
  const mcpServerRenderedPath = path.join(DIR, "mcp-server.rendered.yaml");
  const mcpServerTemplateString = fs.readFileSync(mcpServerTemplatePath, "utf8");
  const mcpServerTemplate = handlebars.compile(mcpServerTemplateString);
  const { useBuildx, arch } = config.docker;
  const mcpServerVars = {
    useBuildx,
    arch,
    IMAGE: IMAGE_URL,
  };
  fs.writeFileSync(mcpServerRenderedPath, mcpServerTemplate(mcpServerVars));
  await $`kubectl apply -f ${DIR}/mcp-server.rendered.yaml`;
}

export async function uninstall() {
  await $`kubectl delete -f ${DIR}/mcp-server.rendered.yaml --ignore-not-found`;
}