#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "Calculator MCP Server";
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
  const mcpServerTemplatePath = path.join(DIR, "mcp-server.template.yaml");
  const mcpServerRenderedPath = path.join(DIR, "mcp-server.rendered.yaml");
  const mcpServerTemplateString = fs.readFileSync(mcpServerTemplatePath, "utf8");
  const mcpServerTemplate = handlebars.compile(mcpServerTemplateString);
  const mcpServerVars = {
    useBuildx,
    arch,
    IMAGE: `${ecrRepoUrl}:latest`,
  };
  fs.writeFileSync(mcpServerRenderedPath, mcpServerTemplate(mcpServerVars));
  await $`kubectl apply -f ${DIR}/mcp-server.rendered.yaml`;
}

export async function uninstall() {
  await $`kubectl delete -f ${DIR}/mcp-server.rendered.yaml`;
  await utils.terraform.destroy(DIR);
}
