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
  const { REGION } = process.env;
  await utils.terraform.apply(DIR);
  const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });

  // Build Docker image using shared bridge code + doc-writer Dockerfile
  cd(SHARED_DIR);
  await $`aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ecrRepoUrl.split("/")[0]}`;
  const { useBuildx, arch } = config.docker;
  const dockerfilePath = path.join(DIR, "Dockerfile");

  if (useBuildx) {
    await $`docker buildx build --platform linux/amd64,linux/arm64 -f ${dockerfilePath} -t ${ecrRepoUrl}:latest --push .`;
  } else {
    await $`docker build -f ${dockerfilePath} -t ${ecrRepoUrl}:latest .`;
    await $`docker push ${ecrRepoUrl}:latest`;
  }

  // Apply namespace and K8s manifests
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
  const result = await $`kubectl get pod -n langfuse -l app=web --ignore-not-found`;
  if (result.stdout.includes("langfuse")) {
    agentVars.LANGFUSE_HOST = "http://langfuse-web.langfuse:3000";
    agentVars.LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
    agentVars.LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
  }
  fs.writeFileSync(agentRenderedPath, agentTemplate(agentVars));
  await $`kubectl apply -f ${agentRenderedPath}`;
}

export async function uninstall() {
  await $`kubectl delete -f ${DIR}/agent.rendered.yaml --ignore-not-found`;
  await utils.terraform.destroy(DIR);
}
