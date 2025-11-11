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

  const { GUARDRAILS_AI_API_KEY } = process.env;

  // Use pre-built public ECR image instead of building locally
  const publicEcrImage = "public.ecr.aws/agentic-ai-platforms-on-k8s/guardrails-ai:latest";
  
  const appTemplatePath = path.join(DIR, "app.template.yaml");
  const appRenderedPath = path.join(DIR, "app.rendered.yaml");
  const { arch } = config.docker;
  const appVars = {
    arch,
    IMAGE: publicEcrImage,
    GUARDRAILS_TOKEN: GUARDRAILS_AI_API_KEY,
  };
  utils.renderTemplate(appTemplatePath, appRenderedPath, appVars);
  await $`kubectl apply -f ${DIR}/app.rendered.yaml`;
}

export async function uninstall() {
  await $`kubectl delete -f ${DIR}/app.rendered.yaml --ignore-not-found`;
}
