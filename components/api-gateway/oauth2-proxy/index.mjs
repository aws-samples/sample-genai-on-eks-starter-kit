#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "OAuth2 Proxy";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "oauth2-proxy";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["DOMAIN", "REDIS_PASSWORD", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_ISSUER_URL"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  console.log("\n========================================");
  console.log("Installing OAuth2 Proxy");
  console.log("(OIDC Authentication + Redis Session)");
  console.log("========================================\n");

  await $`helm repo add oauth2-proxy https://oauth2-proxy.github.io/manifests --force-update`;
  await $`helm repo update oauth2-proxy`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    DOMAIN: process.env.DOMAIN,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_ISSUER_URL: process.env.OIDC_ISSUER_URL,
    OIDC_COOKIE_SECRET: process.env.OIDC_COOKIE_SECRET || "",
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));

  await $`helm upgrade --install oauth2-proxy oauth2-proxy/oauth2-proxy \
    --namespace ${NAMESPACE} \
    --create-namespace \
    -f ${valuesRenderedPath} \
    --wait --timeout 5m`;

  console.log("  OAuth2 Proxy installed");
  console.log(`  Auth endpoint: http://oauth2-proxy.${NAMESPACE}:80/oauth2/auth`);
  console.log(`  Callback URL: https://auth.${process.env.DOMAIN}/oauth2/callback`);
  console.log(`  Redis session store: redis-master.redis:6379/1`);
}

export async function uninstall() {
  console.log("\nUninstalling OAuth2 Proxy...");
  try {
    await $`helm uninstall oauth2-proxy --namespace ${NAMESPACE}`;
    console.log("OAuth2 Proxy uninstalled.");
  } catch {
    console.log("OAuth2 Proxy not found or already removed.");
  }
  try {
    await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
  } catch {
    // ignore
  }
}
