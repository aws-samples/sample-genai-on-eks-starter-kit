#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Traffic Dashboard (Agentic Traffic Studio)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "traffic-dashboard";
const IMAGE_NAME = "traffic-dashboard";
const IMAGE_TAG = "latest";
const KEYCLOAK_REALM = "genai";
const KEYCLOAK_CLIENT_ID = "traffic-dashboard";
// kube-prometheus-stack installed by components/nvidia-platform/monitoring with
// release name `prometheus` in the `monitoring` namespace.
// The kube-prometheus-stack Prometheus is served under routePrefix /prometheus
// (see components/nvidia-platform/monitoring values: routePrefix: /prometheus).
const DEFAULT_PROMETHEUS_URL = "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090/prometheus";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

// Persist a generated secret to .env.local so re-installs reuse it — rotating
// AUTH_SECRET on every install would invalidate every live session cookie.
function persistEnvVar(key, value) {
  const envLocalPath = path.join(BASE_DIR, ".env.local");
  const line = `${key}=${value}\n`;
  if (fs.existsSync(envLocalPath)) {
    const existing = fs.readFileSync(envLocalPath, "utf8");
    fs.appendFileSync(envLocalPath, existing.endsWith("\n") ? line : `\n${line}`);
  } else {
    fs.writeFileSync(envLocalPath, line);
  }
  process.env[key] = value;
  console.log(`  Generated ${key} and appended it to ${envLocalPath}`);
}

function resolveAuthSecret() {
  if (!process.env.AUTH_SECRET) {
    persistEnvVar("AUTH_SECRET", crypto.randomBytes(32).toString("base64"));
  }
  return process.env.AUTH_SECRET;
}

// The confidential client secret is created by components/auth/keycloak, which
// writes KEYCLOAK_DASHBOARD_CLIENT_SECRET to .env.local. AUTH_KEYCLOAK_SECRET
// wins when set explicitly (e.g. an externally managed Keycloak).
function resolveClientSecret() {
  const secret = process.env.AUTH_KEYCLOAK_SECRET || process.env.KEYCLOAK_DASHBOARD_CLIENT_SECRET;
  if (!secret) {
    console.error("Error: neither AUTH_KEYCLOAK_SECRET nor KEYCLOAK_DASHBOARD_CLIENT_SECRET is set in .env or .env.local");
    console.error("       Install the Keycloak component first (it generates the client secret), or set AUTH_KEYCLOAK_SECRET manually.");
    process.exit(1);
  }
  return secret;
}

async function ensureEcrRepository(region) {
  try {
    await $`aws ecr describe-repositories --repository-names ${IMAGE_NAME} --region ${region}`.quiet();
    console.log(`  ECR repository exists: ${IMAGE_NAME}`);
  } catch {
    console.log(`  Creating ECR repository: ${IMAGE_NAME}`);
    await $`aws ecr create-repository --repository-name ${IMAGE_NAME} --region ${region}`;
  }
}

async function buildAndPushImage(region) {
  const accountId = (await $`aws sts get-caller-identity --query Account --output text`.quiet()).stdout.trim();
  const registry = `${accountId}.dkr.ecr.${region}.amazonaws.com`;
  const imageUrl = `${registry}/${IMAGE_NAME}:${IMAGE_TAG}`;

  await ensureEcrRepository(region);

  console.log(`\nBuilding and pushing ${imageUrl} ...`);
  await $`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`;
  // Multi-arch: the cluster mixes amd64 and arm64 (Graviton) general-purpose
  // nodes, so the pod can be scheduled onto either.
  await $`docker buildx build --platform linux/amd64,linux/arm64 --tag ${imageUrl} --push ${DIR}`;

  return imageUrl;
}

export async function install() {
  const requiredEnvVars = ["DOMAIN", "REGION"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  const { DOMAIN, REGION } = process.env;
  const dashboardConfig = config?.["gui-app"]?.["traffic-dashboard"] || {};

  console.log("\n========================================");
  console.log("Installing Traffic Dashboard (Agentic Traffic Studio)");
  console.log("========================================\n");

  const authSecret = resolveAuthSecret();
  const clientSecret = resolveClientSecret();
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER || `https://keycloak.${DOMAIN}/realms/${KEYCLOAK_REALM}`;
  const prometheusUrl = dashboardConfig.prometheusUrl || process.env.PROMETHEUS_URL || DEFAULT_PROMETHEUS_URL;

  const imageUrl = await buildAndPushImage(REGION);

  await utils.setK8sContext();

  const templatePath = path.join(DIR, "traffic-dashboard.template.yaml");
  const renderedPath = path.join(DIR, "traffic-dashboard.rendered.yaml");
  const templateString = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateString);
  const vars = {
    DOMAIN,
    IMAGE: imageUrl,
    DEPLOYED_AT: new Date().toISOString(),
    PROMETHEUS_URL: prometheusUrl,
    AUTH_SECRET: authSecret,
    AUTH_KEYCLOAK_ID: process.env.AUTH_KEYCLOAK_ID || KEYCLOAK_CLIENT_ID,
    AUTH_KEYCLOAK_SECRET: clientSecret,
    AUTH_KEYCLOAK_ISSUER: issuer,
  };
  fs.writeFileSync(renderedPath, template(vars));
  await $`kubectl apply -f ${renderedPath}`;

  try {
    await $`kubectl rollout status deployment/traffic-dashboard --namespace ${NAMESPACE} --timeout=300s`;
  } catch {
    console.warn("  ⚠️  Rollout did not complete in time. Check: kubectl logs -n traffic-dashboard deployment/traffic-dashboard");
  }

  console.log("\n✅ Traffic Dashboard installed.");
  console.log(`   URL:            https://dashboard.${DOMAIN}`);
  console.log(`   OIDC issuer:    ${issuer}`);
  console.log(`   Prometheus:     ${prometheusUrl}`);
  console.log("\n   Sign in with the Keycloak bootstrap user (KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD).");
}

export async function uninstall() {
  await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
}
