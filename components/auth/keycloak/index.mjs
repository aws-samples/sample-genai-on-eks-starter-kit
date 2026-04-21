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
      redirectUris: DOMAIN
        ? [
            `https://auth.${DOMAIN}/oauth2/callback`,
            `https://openwebui.${DOMAIN}/*`,
            `https://litellm.${DOMAIN}/*`,
            `https://langfuse.${DOMAIN}/*`,
            `https://qdrant.${DOMAIN}/*`,
            `https://keycloak.${DOMAIN}/*`,
          ]
        : ["http://localhost:*/*"],
      webOrigins: DOMAIN
        ? [
            `https://auth.${DOMAIN}`,
            `https://openwebui.${DOMAIN}`,
            `https://litellm.${DOMAIN}`,
            `https://langfuse.${DOMAIN}`,
            `https://qdrant.${DOMAIN}`,
            `https://keycloak.${DOMAIN}`,
          ]
        : ["*"],
      attributes: {
        "post.logout.redirect.uris": DOMAIN
          ? `https://openwebui.${DOMAIN}/*##https://litellm.${DOMAIN}/*##https://langfuse.${DOMAIN}/*`
          : "*",
      },
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

    // Create 'groups' client scope with group membership mapper (required by OAuth2-Proxy)
    const groupsScopeConfig = {
      name: "groups",
      protocol: "openid-connect",
      description: "Group membership",
      attributes: { "include.in.token.scope": "true", "display.on.consent.screen": "true" },
      protocolMappers: [{
        name: "groups",
        protocol: "openid-connect",
        protocolMapper: "oidc-group-membership-mapper",
        consentRequired: false,
        config: {
          "full.path": "false",
          "id.token.claim": "true",
          "access.token.claim": "true",
          "claim.name": "groups",
          "userinfo.token.claim": "true",
        },
      }],
    };
    try {
      await $`curl -sf -X POST ${KC_URL}/admin/realms/${REALM}/client-scopes \
        -H "Authorization: Bearer ${adminToken}" \
        -H "Content-Type: application/json" \
        -d ${JSON.stringify(groupsScopeConfig)}`.quiet();
      console.log("  Client scope 'groups' created");
    } catch {
      console.log("  Client scope 'groups' already exists");
    }

    // Get client ID and secret
    const clientsResult = await $`curl -sf "${KC_URL}/admin/realms/${REALM}/clients?clientId=genai-platform" \
      -H "Authorization: Bearer ${adminToken}"`.quiet();
    const clients = JSON.parse(clientsResult.stdout);
    const clientUuid = clients[0].id;

    const secretResult = await $`curl -sf "${KC_URL}/admin/realms/${REALM}/clients/${clientUuid}/client-secret" \
      -H "Authorization: Bearer ${adminToken}"`.quiet();
    clientSecret = JSON.parse(secretResult.stdout).value;

    // Assign 'groups' scope to the client
    const scopesResult = await $`curl -sf "${KC_URL}/admin/realms/${REALM}/client-scopes" \
      -H "Authorization: Bearer ${adminToken}"`.quiet();
    const groupsScope = JSON.parse(scopesResult.stdout).find((s) => s.name === "groups");
    if (groupsScope) {
      try {
        await $`curl -sf -X PUT "${KC_URL}/admin/realms/${REALM}/clients/${clientUuid}/default-client-scopes/${groupsScope.id}" \
          -H "Authorization: Bearer ${adminToken}"`.quiet();
        console.log("  Assigned 'groups' scope to client");
      } catch {
        console.log("  'groups' scope already assigned");
      }
    }

    // Create groups and capture their IDs for user-group assignment
    const groupIds = {};
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
      const groupsResult = await $`curl -sf "${KC_URL}/admin/realms/${REALM}/groups?search=${group}" \
        -H "Authorization: Bearer ${adminToken}"`.quiet();
      const matches = JSON.parse(groupsResult.stdout);
      const found = matches.find((g) => g.name === group);
      if (found) groupIds[group] = found.id;
    }

    // Create demo users (one per group) for RBAC testing
    const pass = process.env.OPENWEBUI_ADMIN_PASSWORD || "Pass@123";
    const domainPart = (process.env.OPENWEBUI_ADMIN_EMAIL || "admin@example.com").split("@")[1] || "example.com";
    const demoUsers = [
      { username: "senior-demo", email: `senior-demo@${domainPart}`, firstName: "Senior", lastName: "Demo", group: "senior-dev" },
      { username: "junior-demo", email: `junior-demo@${domainPart}`, firstName: "Junior", lastName: "Demo", group: "junior-dev" },
    ];
    for (const u of demoUsers) {
      const body = {
        username: u.username,
        email: u.email,
        enabled: true,
        emailVerified: true,
        firstName: u.firstName,
        lastName: u.lastName,
        credentials: [{ type: "password", value: pass, temporary: false }],
      };
      try {
        await $`curl -sf -X POST ${KC_URL}/admin/realms/${REALM}/users \
          -H "Authorization: Bearer ${adminToken}" \
          -H "Content-Type: application/json" \
          -d ${JSON.stringify(body)}`.quiet();
        console.log(`  User '${u.username}' created`);
      } catch {
        console.log(`  User '${u.username}' already exists`);
      }
      // Lookup user id and assign to group
      const userSearch = await $`curl -sf "${KC_URL}/admin/realms/${REALM}/users?username=${u.username}&exact=true" \
        -H "Authorization: Bearer ${adminToken}"`.quiet();
      const userMatches = JSON.parse(userSearch.stdout);
      if (userMatches.length > 0 && groupIds[u.group]) {
        try {
          await $`curl -sf -X PUT "${KC_URL}/admin/realms/${REALM}/users/${userMatches[0].id}/groups/${groupIds[u.group]}" \
            -H "Authorization: Bearer ${adminToken}"`.quiet();
          console.log(`  Assigned '${u.username}' -> '${u.group}'`);
        } catch {
          console.log(`  '${u.username}' already in '${u.group}'`);
        }
      }
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
