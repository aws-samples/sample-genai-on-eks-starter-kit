#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "OpenClaw";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
const SHARED_DIR = path.join(DIR, "..", "..", "..", "examples", "openclaw", "shared");
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
  console.log("Applying Terraform configuration...");
  await utils.terraform.apply(DIR);
  const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });

  // Build Docker image from shared bridge code
  console.log("Building OpenClaw bridge server Docker image...");
  cd(SHARED_DIR);
  try {
    await $`aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ecrRepoUrl.split("/")[0]}`;
    const { useBuildx, arch } = config.docker;

    // Use component Dockerfile with shared context
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
    useBuildx,
    arch,
    IMAGE: `${ecrRepoUrl}:latest`,
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

  console.log("Destroying Terraform resources...");
  await utils.terraform.destroy(DIR);

  console.log("OpenClaw component uninstalled successfully!");
}
