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
  const { REGION } = process.env;
  await utils.terraform.apply(DIR);
  const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });

  // Build Docker image from shared bridge code
  cd(SHARED_DIR);
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

  // Apply K8s manifests
  const nsPath = path.join(DIR, "..", "..", "..", "examples", "openclaw", "namespace.yaml");
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
  const result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
  if (result.stdout.includes("langfuse")) {
    vars.LANGFUSE_HOST = "http://langfuse-web.langfuse:3000";
    vars.LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
    vars.LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
  }
  fs.writeFileSync(renderedPath, template(vars));
  await $`kubectl apply -f ${renderedPath}`;
}

export async function uninstall() {
  const renderedPath = path.join(DIR, "openclaw.rendered.yaml");
  await $`kubectl delete -f ${renderedPath} --ignore-not-found`;
  await utils.terraform.destroy(DIR);
}
