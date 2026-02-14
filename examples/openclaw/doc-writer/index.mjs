#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "Document Writer Agent";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
const SHARED_DIR = path.join(DIR, "..", "shared");
let BASE_DIR;
let config;
let utils;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  // Check required environment variables
  const requiredEnvVars = ["REGION", "LITELLM_API_KEY"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  const { REGION } = process.env;
  console.log("Applying Terraform configuration for doc-writer...");
  await utils.terraform.apply(DIR);
  const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });

  // Build Docker image using shared bridge code + doc-writer Dockerfile
  console.log("Building doc-writer agent Docker image...");
  cd(SHARED_DIR);
  try {
    await $`aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ecrRepoUrl.split("/")[0]}`;
    const { useBuildx, arch } = config.docker;
    const dockerfilePath = path.join(DIR, "Dockerfile");

    if (useBuildx) {
      await $`docker buildx build --platform linux/amd64,linux/arm64 -f ${dockerfilePath} -t ${ecrRepoUrl}:latest --push .`;
    } else {
      await $`docker build -f ${dockerfilePath} -t ${ecrRepoUrl}:latest .`;
      await $`docker push ${ecrRepoUrl}:latest`;
    }
  } catch (error) {
    console.error("Docker build/push failed:", error.message || error);
    throw error;
  }

  // Apply namespace and K8s manifests
  console.log("Applying Kubernetes manifests...");
  await $`kubectl apply -f ${path.join(DIR, "..", "namespace.yaml")}`;

  const agentTemplatePath = path.join(DIR, "agent.template.yaml");
  const agentRenderedPath = path.join(DIR, "agent.rendered.yaml");
  const agentTemplateString = fs.readFileSync(agentTemplatePath, "utf8");
  const agentTemplate = handlebars.compile(agentTemplateString);
  const { LITELLM_API_KEY } = process.env;
  const agentVars = {
    useBuildx,
    arch,
    IMAGE: `${ecrRepoUrl}:latest`,
    ...config["examples"]["openclaw"]["doc-writer"].env,
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

  console.log("Destroying Terraform resources...");
  await utils.terraform.destroy(DIR);

  console.log("Document Writer Agent uninstalled successfully!");
}
