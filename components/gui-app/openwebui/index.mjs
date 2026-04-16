#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Open WebUI";
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
  const OPENWEBUI_CHART_VERSION = "12.8.1";
  const requiredEnvVars = ["LITELLM_API_KEY", "OPENWEBUI_ADMIN_EMAIL", "OPENWEBUI_ADMIN_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await $`helm repo add open-webui https://open-webui.github.io/helm-charts`;
  await $`helm repo update`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    DOMAIN: process.env.DOMAIN,
    LITELLM_API_KEY: process.env.LITELLM_API_KEY,
    OPENWEBUI_ADMIN_EMAIL: process.env.OPENWEBUI_ADMIN_EMAIL,
    OPENWEBUI_ADMIN_PASSWORD: process.env.OPENWEBUI_ADMIN_PASSWORD,
  };
  // Redis session backend (optional)
  if (process.env.REDIS_PASSWORD) {
    valuesVars.REDIS_URL = `redis://:${process.env.REDIS_PASSWORD}@redis-master.redis:6379/0`;
  }
  // kGateway mode: disable ingress, use trusted email header from gateway
  if (config?.kgateway?.enabled) {
    valuesVars.KGATEWAY_ENABLED = true;
  } else if (process.env.OIDC_CLIENT_ID) {
    // Fallback: OIDC SSO directly in OpenWebUI (no gateway)
    valuesVars.OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
    valuesVars.OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
    valuesVars.OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL;
  }
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm upgrade --install openwebui open-webui/open-webui --version ${OPENWEBUI_CHART_VERSION} --namespace openwebui --create-namespace -f ${valuesRenderedPath}`;
}

export async function uninstall() {
  await $`helm uninstall openwebui --namespace openwebui`;
}
