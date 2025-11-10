#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "Guardrails AI";
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
  const requiredEnvVars = ["GUARDRAILS_AI_API_KEY"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  const { REGION, GUARDRAILS_AI_API_KEY } = process.env;
  await utils.terraform.apply(DIR);
  const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });
  cd(DIR);
  await $`aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ecrRepoUrl.split("/")[0]}`;
  const { useBuildx, arch } = config.docker;
  if (useBuildx) {
    await $`docker buildx build --platform linux/amd64,linux/arm64 -t ${ecrRepoUrl}:latest --push --build-arg GUARDRAILS_TOKEN=${GUARDRAILS_AI_API_KEY} .`;
  } else {
    await $`docker build -t ${ecrRepoUrl}:latest --build-arg GUARDRAILS_TOKEN=${GUARDRAILS_AI_API_KEY} .`;
    await $`docker push ${ecrRepoUrl}:latest`;
  }
  const appTemplatePath = path.join(DIR, "app.template.yaml");
  const appRenderedPath = path.join(DIR, "app.rendered.yaml");
  const appVars = {
    useBuildx,
    arch,
    IMAGE: `${ecrRepoUrl}:latest`,
  };
  utils.renderTemplate(appTemplatePath, appRenderedPath, appVars);
  await $`kubectl apply -f ${DIR}/app.rendered.yaml`;
}

export async function uninstall() {
  await $`kubectl delete -f ${DIR}/app.rendered.yaml --ignore-not-found`;
  await utils.terraform.destroy(DIR);
}
