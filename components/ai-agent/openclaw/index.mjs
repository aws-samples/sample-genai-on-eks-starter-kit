#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "OpenClaw";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

// Pre-built public ECR image
const ECR_REGISTRY_ALIAS = "agentic-ai-platforms-on-k8s";
const IMAGE_NAME = "openclaw-bridge-server";
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

  // Apply K8s manifests
  console.log("Applying Kubernetes manifests...");
  const nsPath = path.join(DIR, "namespace.yaml");
  await $`kubectl apply -f ${nsPath}`;

  const templatePath = path.join(DIR, "openclaw.template.yaml");
  const renderedPath = path.join(DIR, "openclaw.rendered.yaml");
  const templateString = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateString);
  const { LITELLM_API_KEY } = process.env;
  const vars = {
    IMAGE: IMAGE_URL,
    ...config["ai-agent"]["openclaw"].env,
    LITELLM_BASE_URL: "http://litellm.litellm:4000",
    LITELLM_API_KEY: LITELLM_API_KEY,
  };

  // Check if Langfuse is available
  const result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
  if (result.stdout.includes("langfuse")) {
    console.log("Langfuse detected, enabling observability integration...");
    if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
      console.warn("Warning: Langfuse detected but LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set in .env. Skipping Langfuse integration.");
    } else {
      vars.LANGFUSE_HOST = "http://langfuse-web.langfuse:3000";
      vars.LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
      vars.LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
    }
  }

  fs.writeFileSync(renderedPath, template(vars));
  await $`kubectl apply -f ${renderedPath}`;

  console.log("OpenClaw component installed successfully!");
  console.log(`Bridge server will be available at: http://openclaw.openclaw.svc.cluster.local:8080`);
}

export async function uninstall() {
  console.log("Uninstalling OpenClaw component...");
  const renderedPath = path.join(DIR, "openclaw.rendered.yaml");
  await $`kubectl delete -f ${renderedPath} --ignore-not-found`;
  console.log("OpenClaw component uninstalled successfully!");
}
