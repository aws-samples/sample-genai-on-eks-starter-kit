#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
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

  const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER;
  const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD;
  const DOMAIN = process.env.DOMAIN;

  await $`kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`;

  // Deploy PostgreSQL via Helm (Bitnami standalone)
  console.log("  Installing PostgreSQL for Keycloak...");
  await $`helm repo add bitnami https://charts.bitnami.com/bitnami --force-update`;
  await $`helm repo update bitnami`;
  await $`helm upgrade --install keycloak-postgresql bitnami/postgresql \
    --namespace ${NAMESPACE} \
    --set global.security.allowInsecureImages=true \
    --set image.registry=public.ecr.aws \
    --set image.repository=agentic-ai-platforms-on-k8s/postgresql \
    --set image.tag=17.5.0-debian-12-r8 \
    --set auth.postgresPassword=keycloak-pg-pass \
    --set auth.database=keycloak \
    --set primary.resources.requests.cpu=125m \
    --set primary.resources.requests.memory=256Mi \
    --set primary.resources.limits.memory=256Mi \
    --wait --timeout 5m`;

  // Deploy Keycloak using official image (not Bitnami chart)
  console.log("  Deploying Keycloak...");
  const kcHostname = DOMAIN ? `https://keycloak.${DOMAIN}` : "";
  const deployYaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  namespace: ${NAMESPACE}
  labels:
    app: keycloak
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:26.3
        args: ["start-dev"]
        ports:
        - containerPort: 8080
        env:
        - name: KC_BOOTSTRAP_ADMIN_USERNAME
          value: "${ADMIN_USER}"
        - name: KC_BOOTSTRAP_ADMIN_PASSWORD
          value: "${ADMIN_PASS}"
        - name: KC_DB
          value: "postgres"
        - name: KC_DB_URL
          value: "jdbc:postgresql://keycloak-postgresql.${NAMESPACE}:5432/keycloak"
        - name: KC_DB_USERNAME
          value: "postgres"
        - name: KC_DB_PASSWORD
          value: "keycloak-pg-pass"
        - name: KC_PROXY_HEADERS
          value: "xforwarded"
        - name: KC_HOSTNAME_BACKCHANNEL_DYNAMIC
          value: "true"
        ${kcHostname ? `- name: KC_HOSTNAME\n          value: "${kcHostname}"` : ""}
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            memory: 1Gi
        readinessProbe:
          httpGet:
            path: /realms/master
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: ${NAMESPACE}
spec:
  selector:
    app: keycloak
  ports:
  - port: 80
    targetPort: 8080
`;
  await $`echo ${deployYaml} | kubectl apply -f -`;

  // Wait for Keycloak to be ready
  console.log("  Waiting for Keycloak to be ready...");
  await $`kubectl wait --for=condition=Available deploy/keycloak -n ${NAMESPACE} --timeout=300s`;
  // Extra wait for readiness probe
  await $`kubectl wait --for=condition=Ready pod -l app=keycloak -n ${NAMESPACE} --timeout=120s`;

  console.log("  Keycloak deployed");

  // Configure realm, client, and groups via Keycloak Admin API
  // Use kubectl port-forward + local curl since official Keycloak image doesn't include curl
  console.log("\nConfiguring Keycloak realm and OIDC client...");
  const REALM = "genai";
  const LOCAL_PORT = 18080;

  // Start port-forward in background
  const pf = $`kubectl port-forward -n ${NAMESPACE} svc/keycloak ${LOCAL_PORT}:80`.quiet().nothrow();
  await new Promise((r) => setTimeout(r, 3000)); // wait for port-forward to establish

  const KC_URL = `http://localhost:${LOCAL_PORT}`;
  let clientSecret;
  try {
    // Get admin token
    const tokenResult = await $`curl -sf -X POST ${KC_URL}/realms/master/protocol/openid-connect/token \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "username=${ADMIN_USER}&password=${ADMIN_PASS}&grant_type=password&client_id=admin-cli"`.quiet();
    const adminToken = JSON.parse(tokenResult.stdout).access_token;

    // Create realm
    try {
      await $`curl -sf -X POST ${KC_URL}/admin/realms \
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
      await $`curl -sf -X POST ${KC_URL}/admin/realms/${REALM}/clients \
        -H "Authorization: Bearer ${adminToken}" \
        -H "Content-Type: application/json" \
        -d ${JSON.stringify(clientConfig)}`.quiet();
      console.log("  OIDC client 'genai-platform' created");
    } catch {
      console.log("  OIDC client 'genai-platform' already exists");
    }

    // Get client ID and secret
    const clientsResult = await $`curl -sf "${KC_URL}/admin/realms/${REALM}/clients?clientId=genai-platform" \
      -H "Authorization: Bearer ${adminToken}"`.quiet();
    const clients = JSON.parse(clientsResult.stdout);
    const clientUuid = clients[0].id;

    const secretResult = await $`curl -sf "${KC_URL}/admin/realms/${REALM}/clients/${clientUuid}/client-secret" \
      -H "Authorization: Bearer ${adminToken}"`.quiet();
    clientSecret = JSON.parse(secretResult.stdout).value;

    // Create groups
    for (const group of ["senior-dev", "junior-dev"]) {
      try {
        await $`curl -sf -X POST ${KC_URL}/admin/realms/${REALM}/groups \
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
      await $`curl -sf -X POST ${KC_URL}/admin/realms/${REALM}/users \
        -H "Authorization: Bearer ${adminToken}" \
        -H "Content-Type: application/json" \
        -d ${JSON.stringify(demoUser)}`.quiet();
      console.log("  Demo user created");
    } catch {
      console.log("  Demo user already exists");
    }
  } finally {
    pf.kill();
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
    await $`kubectl delete deploy keycloak -n ${NAMESPACE} --ignore-not-found`;
    await $`kubectl delete svc keycloak -n ${NAMESPACE} --ignore-not-found`;
    await $`helm uninstall keycloak-postgresql --namespace ${NAMESPACE}`;
    console.log("Keycloak uninstalled.");
  } catch {
    console.log("Keycloak not found or already removed.");
  }
  try {
    await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
  } catch {}
}
