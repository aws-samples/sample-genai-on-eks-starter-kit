#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "Calculator Agent";
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
  const { REGION } = process.env;
  await utils.terraform.apply(DIR);
  const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });
  cd(DIR);
  await $`aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ecrRepoUrl.split("/")[0]}`;
  const { useBuildx, arch } = config.docker;
  if (useBuildx) {
    await $`docker buildx build --platform linux/amd64,linux/arm64 -t ${ecrRepoUrl}:latest --push .`;
  } else {
    await $`docker build -t ${ecrRepoUrl}:latest .`;
    await $`docker push ${ecrRepoUrl}:latest`;
  }
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
    ...config["examples"]["strands-agents"]["calculator-agent"].env,
    LITELLM_BASE_URL: `http://litellm.litellm:4000/v1`,
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
  await utils.terraform.destroy(DIR);
}
