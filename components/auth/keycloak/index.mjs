#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Keycloak";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "keycloak";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["KEYCLOAK_ADMIN_USER", "KEYCLOAK_ADMIN_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  console.log("\n========================================");
  console.log("Installing Keycloak (OIDC Provider)");
  console.log("========================================\n");

  await $`helm repo add bitnami https://charts.bitnami.com/bitnami --force-update`;
  await $`helm repo update bitnami`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    KEYCLOAK_ADMIN_USER: process.env.KEYCLOAK_ADMIN_USER,
    KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));

  await $`helm upgrade --install keycloak bitnami/keycloak \
    --namespace ${NAMESPACE} \
    --create-namespace \
    -f ${valuesRenderedPath} \
    --wait --timeout 10m`;

  console.log("  Keycloak installed");

  // Wait for Keycloak to be ready
  await $`kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=keycloak -n ${NAMESPACE} --timeout=300s`;

  // Configure realm, client, and groups via Keycloak Admin API
  console.log("\nConfiguring Keycloak realm and OIDC client...");
  const KEYCLOAK_URL = `http://keycloak.${NAMESPACE}:80`;
  const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER;
  const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD;
  const DOMAIN = process.env.DOMAIN;
  const REALM = "genai";

  // Get admin token
  const tokenResult = await $`kubectl exec -n ${NAMESPACE} deploy/keycloak -- \
    curl -sf -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=${ADMIN_USER}&password=${ADMIN_PASS}&grant_type=password&client_id=admin-cli"`.quiet();
  const adminToken = JSON.parse(tokenResult.stdout).access_token;

  // Create realm
  try {
    await $`kubectl exec -n ${NAMESPACE} deploy/keycloak -- \
      curl -sf -X POST "${KEYCLOAK_URL}/admin/realms" \
      -H "Authorization: Bearer ${adminToken}" \
      -H "Content-Type: application/json" \
      -d ${JSON.stringify({ realm: REALM, enabled: true, registrationAllowed: false })}`.quiet();
    console.log(`  Realm '${REALM}' created`);
  } catch {
    console.log(`  Realm '${REALM}' already exists`);
  }

  // Create OIDC client
  const clientConfig = {
    clientId: "genai-platform",
    name: "GenAI Platform",
    enabled: true,
    publicClient: false,
    protocol: "openid-connect",
    standardFlowEnabled: true,
    directAccessGrantsEnabled: true,
    redirectUris: DOMAIN ? [`https://*.${DOMAIN}/*`] : ["http://localhost:*/*"],
    webOrigins: DOMAIN ? [`https://*.${DOMAIN}`] : ["*"],
    attributes: { "post.logout.redirect.uris": DOMAIN ? `https://*.${DOMAIN}/*` : "*" },
  };
  try {
    await $`kubectl exec -n ${NAMESPACE} deploy/keycloak -- \
      curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/clients" \
      -H "Authorization: Bearer ${adminToken}" \
      -H "Content-Type: application/json" \
      -d ${JSON.stringify(clientConfig)}`.quiet();
    console.log("  OIDC client 'genai-platform' created");
  } catch {
    console.log("  OIDC client 'genai-platform' already exists");
  }

  // Get client ID and secret
  const clientsResult = await $`kubectl exec -n ${NAMESPACE} deploy/keycloak -- \
    curl -sf "${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=genai-platform" \
    -H "Authorization: Bearer ${adminToken}"`.quiet();
  const clients = JSON.parse(clientsResult.stdout);
  const clientUuid = clients[0].id;

  const secretResult = await $`kubectl exec -n ${NAMESPACE} deploy/keycloak -- \
    curl -sf "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${clientUuid}/client-secret" \
    -H "Authorization: Bearer ${adminToken}"`.quiet();
  const clientSecret = JSON.parse(secretResult.stdout).value;

  // Create groups
  for (const group of ["senior-dev", "junior-dev"]) {
    try {
      await $`kubectl exec -n ${NAMESPACE} deploy/keycloak -- \
        curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/groups" \
        -H "Authorization: Bearer ${adminToken}" \
        -H "Content-Type: application/json" \
        -d ${JSON.stringify({ name: group })}`.quiet();
      console.log(`  Group '${group}' created`);
    } catch {
      console.log(`  Group '${group}' already exists`);
    }
  }

  // Create a demo user
  const demoUser = {
    username: "demo",
    email: process.env.OPENWEBUI_ADMIN_EMAIL || "admin@example.com",
    enabled: true,
    emailVerified: true,
    firstName: "Demo",
    lastName: "User",
    credentials: [{ type: "password", value: process.env.OPENWEBUI_ADMIN_PASSWORD || "Pass@123", temporary: false }],
  };
  try {
    await $`kubectl exec -n ${NAMESPACE} deploy/keycloak -- \
      curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/users" \
      -H "Authorization: Bearer ${adminToken}" \
      -H "Content-Type: application/json" \
      -d ${JSON.stringify(demoUser)}`.quiet();
    console.log("  Demo user created");
  } catch {
    console.log("  Demo user already exists");
  }

  // Save OIDC config
  const issuerUrl = `http://keycloak.${NAMESPACE}:80/realms/${REALM}`;
  const externalIssuerUrl = DOMAIN ? `https://keycloak.${DOMAIN}/realms/${REALM}` : issuerUrl;

  // Save to .env.local
  const envLocalPath = path.join(BASE_DIR, ".env.local");
  let envContent = "";
  if (fs.existsSync(envLocalPath)) {
    envContent = fs.readFileSync(envLocalPath, "utf8");
  }
  const setEnvVar = (content, key, value) => {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) return content.replace(regex, `${key}=${value}`);
    return content.trimEnd() + `\n${key}=${value}\n`;
  };
  envContent = setEnvVar(envContent, "OIDC_CLIENT_ID", "genai-platform");
  envContent = setEnvVar(envContent, "OIDC_CLIENT_SECRET", clientSecret);
  envContent = setEnvVar(envContent, "OIDC_ISSUER_URL", externalIssuerUrl);
  fs.writeFileSync(envLocalPath, envContent);
  process.env.OIDC_CLIENT_ID = "genai-platform";
  process.env.OIDC_CLIENT_SECRET = clientSecret;
  process.env.OIDC_ISSUER_URL = externalIssuerUrl;

  console.log("\n========================================");
  console.log("Keycloak setup complete!");
  console.log("========================================");
  console.log(`  Admin Console: https://keycloak.${DOMAIN}/admin`);
  console.log(`  OIDC Issuer: ${externalIssuerUrl}`);
  console.log(`  OIDC Client ID: genai-platform`);
  console.log(`  OIDC Client Secret: ****${clientSecret.slice(-4)}`);
  console.log(`  OIDC Discovery: ${externalIssuerUrl}/.well-known/openid-configuration`);
  console.log(`  Demo user: demo / ${process.env.OPENWEBUI_ADMIN_PASSWORD || "Pass@123"}`);
  console.log(`  Groups: senior-dev, junior-dev`);
  console.log("  OIDC credentials saved to .env.local");
}

export async function uninstall() {
  console.log("\nUninstalling Keycloak...");
  try {
    await $`helm uninstall keycloak --namespace ${NAMESPACE}`;
    console.log("Keycloak uninstalled.");
  } catch {
    console.log("Keycloak not found or already removed.");
  }
  try {
    await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
  } catch {}
}
