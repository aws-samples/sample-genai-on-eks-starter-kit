#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Keycloak (OIDC identity provider)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "keycloak";
const REALM = "genai";
const DASHBOARD_CLIENT_ID = "traffic-dashboard";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

// The dashboard client is confidential, so its secret has to exist before both
// Keycloak's realm import and the dashboard's Deployment are rendered. Generate
// one on first install and persist it to .env.local so the traffic-dashboard
// component (and any re-install) picks up the same value.
function resolveDashboardClientSecret() {
  if (process.env.KEYCLOAK_DASHBOARD_CLIENT_SECRET) {
    return process.env.KEYCLOAK_DASHBOARD_CLIENT_SECRET;
  }
  const secret = crypto.randomBytes(24).toString("base64url");
  const envLocalPath = path.join(BASE_DIR, ".env.local");
  const line = `KEYCLOAK_DASHBOARD_CLIENT_SECRET=${secret}\n`;
  if (fs.existsSync(envLocalPath)) {
    const existing = fs.readFileSync(envLocalPath, "utf8");
    fs.appendFileSync(envLocalPath, existing.endsWith("\n") ? line : `\n${line}`);
  } else {
    fs.writeFileSync(envLocalPath, line);
  }
  process.env.KEYCLOAK_DASHBOARD_CLIENT_SECRET = secret;
  console.log(`  Generated KEYCLOAK_DASHBOARD_CLIENT_SECRET and appended it to ${envLocalPath}`);
  return secret;
}

export async function install() {
  const requiredEnvVars = ["DOMAIN", "KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  console.log("\n========================================");
  console.log("Installing Keycloak (OIDC identity provider)");
  console.log("========================================\n");

  const keycloakConfig = config?.auth?.keycloak || {};
  const storageClass = keycloakConfig.storageClass || (utils.isK8sMode() ? config?.platform?.k8s?.storageClass || "local-path" : config?.platform?.eks?.storageClass || "efs");
  const clientSecret = resolveDashboardClientSecret();

  await utils.setK8sContext();

  const templatePath = path.join(DIR, "keycloak.template.yaml");
  const renderedPath = path.join(DIR, "keycloak.rendered.yaml");
  const templateString = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateString);
  const vars = {
    DOMAIN: process.env.DOMAIN,
    STORAGE_CLASS: storageClass,
    KEYCLOAK_ADMIN: process.env.KEYCLOAK_ADMIN,
    KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD,
    KEYCLOAK_DASHBOARD_CLIENT_SECRET: clientSecret,
  };
  fs.writeFileSync(renderedPath, template(vars));
  await $`kubectl apply -f ${renderedPath}`;

  console.log("\nWaiting for Keycloak to become ready (first start imports the realm)...");
  try {
    await $`kubectl rollout status statefulset/keycloak --namespace ${NAMESPACE} --timeout=600s`;
  } catch {
    console.warn("  ⚠️  Keycloak did not report ready in time. Check: kubectl logs -n keycloak statefulset/keycloak");
  }

  const issuer = `https://keycloak.${process.env.DOMAIN}/realms/${REALM}`;
  console.log("\n✅ Keycloak installed.");
  console.log(`   Admin console: https://keycloak.${process.env.DOMAIN}/admin/`);
  console.log(`   Realm:         ${REALM}`);
  console.log(`   OIDC issuer:   ${issuer}`);
  console.log(`   Client:        ${DASHBOARD_CLIENT_ID} (confidential)`);
  console.log("\n   Set these in .env.local for the Traffic Dashboard component:");
  console.log(`     AUTH_KEYCLOAK_ISSUER=${issuer}`);
  console.log(`     AUTH_KEYCLOAK_ID=${DASHBOARD_CLIENT_ID}`);
  console.log("     AUTH_KEYCLOAK_SECRET=$KEYCLOAK_DASHBOARD_CLIENT_SECRET");
}

export async function uninstall() {
  await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
}
