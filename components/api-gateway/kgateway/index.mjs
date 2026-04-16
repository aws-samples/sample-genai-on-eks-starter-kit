#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "kGateway";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const KGATEWAY_VERSION = "2.0.2";
const NAMESPACE = "gloo-system";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["REGION", "EKS_CLUSTER_NAME", "DOMAIN"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  console.log("\n========================================");
  console.log("Installing kGateway (2-Tier API Gateway)");
  console.log("========================================\n");

  // Step 1: Install Gateway API CRDs
  console.log("[1/5] Installing Gateway API CRDs...");
  await $`kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/standard-install.yaml`;

  // Step 2: Install kGateway via Helm
  console.log("\n[2/5] Installing kGateway CRDs...");
  await $`helm upgrade -i --create-namespace \
    --namespace ${NAMESPACE} \
    --version ${KGATEWAY_VERSION} gloo-gateway-crds \
    oci://us-docker.pkg.dev/solo-public/gloo-gateway/charts/gloo-gateway-crds`;

  console.log("\nInstalling kGateway...");
  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  fs.writeFileSync(valuesRenderedPath, valuesTemplate({}));

  await $`helm upgrade -i --create-namespace \
    --namespace ${NAMESPACE} \
    --version ${KGATEWAY_VERSION} gloo-gateway \
    oci://us-docker.pkg.dev/solo-public/gloo-gateway/charts/gloo-gateway \
    -f ${valuesRenderedPath}`;

  console.log("  kGateway installed");

  // Step 3: Apply Gateway resource
  console.log("\n[3/5] Creating Gateway resource...");
  const gatewayTemplatePath = path.join(DIR, "gateway.template.yaml");
  const gatewayRenderedPath = path.join(DIR, "gateway.rendered.yaml");
  utils.renderTemplate(gatewayTemplatePath, gatewayRenderedPath, {
    DOMAIN: process.env.DOMAIN,
  });
  await $`kubectl apply -f ${gatewayRenderedPath}`;

  // Step 4: Apply HTTPRoutes + ReferenceGrants
  console.log("\n[4/5] Creating HTTPRoutes...");
  const routesTemplatePath = path.join(DIR, "httproutes.template.yaml");
  const routesRenderedPath = path.join(DIR, "httproutes.rendered.yaml");
  utils.renderTemplate(routesTemplatePath, routesRenderedPath, {
    DOMAIN: process.env.DOMAIN,
  });
  await $`kubectl apply -f ${routesRenderedPath}`;

  // Step 5: Apply OIDC auth (if configured)
  if (process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) {
    console.log("\n[5/5] Configuring OIDC authentication...");
    const secretTemplatePath = path.join(DIR, "secret.template.yaml");
    const secretRenderedPath = path.join(DIR, "secret.rendered.yaml");
    utils.renderTemplate(secretTemplatePath, secretRenderedPath, {
      OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    });
    await $`kubectl apply -f ${secretRenderedPath}`;

    const policyTemplatePath = path.join(DIR, "traffic-policy.template.yaml");
    const policyRenderedPath = path.join(DIR, "traffic-policy.rendered.yaml");
    utils.renderTemplate(policyTemplatePath, policyRenderedPath, {});
    await $`kubectl apply -f ${policyRenderedPath}`;
    console.log("  OIDC ext_authz TrafficPolicy applied");
  } else {
    console.log("\n[5/5] OIDC not configured — skipping auth policy");
    console.log("  Set OIDC_CLIENT_ID, OIDC_CLIENT_SECRET in .env.local to enable");
  }

  // Step 6: Provision CloudFront + WAF + Shield (Terraform)
  console.log("\nProvisioning CloudFront + WAF (Terraform)...");
  const kgatewayConfig = config?.kgateway || {};
  await utils.terraform.apply(DIR, {
    vars: {
      enable_shield_advanced: kgatewayConfig.enableShieldAdvanced || false,
      waf_rate_limit_per_ip: kgatewayConfig.waf?.rateLimitPerIP || 2000,
      enable_geo_restriction: kgatewayConfig.waf?.enableGeoRestriction || false,
      allowed_countries: JSON.stringify(kgatewayConfig.waf?.allowedCountries || []),
    },
  });

  const tfOutput = await utils.terraform.output(DIR, {});
  console.log(`\n  CloudFront: ${tfOutput.cloudfront_domain_name.value}`);
  console.log(`  NLB: ${tfOutput.nlb_dns_name.value}`);
  console.log(`  WAF: ${tfOutput.waf_web_acl_arn.value}`);

  console.log("\n========================================");
  console.log("kGateway installation complete!");
  console.log("========================================");
  console.log(`All services accessible via *.${process.env.DOMAIN}`);
  console.log(`  OpenWebUI:  https://openwebui.${process.env.DOMAIN}`);
  console.log(`  LiteLLM:    https://litellm.${process.env.DOMAIN}`);
  console.log(`  Langfuse:   https://langfuse.${process.env.DOMAIN}`);
  console.log(`  Qdrant:     https://qdrant.${process.env.DOMAIN}`);
}

export async function uninstall() {
  console.log("\nUninstalling kGateway...");

  // Remove K8s resources
  const renderedFiles = ["traffic-policy", "secret", "httproutes", "gateway"];
  for (const f of renderedFiles) {
    const renderedPath = path.join(DIR, `${f}.rendered.yaml`);
    if (fs.existsSync(renderedPath)) {
      await $`kubectl delete -f ${renderedPath} --ignore-not-found`;
    }
  }

  // Uninstall Helm
  try {
    await $`helm uninstall gloo-gateway --namespace ${NAMESPACE}`;
  } catch {
    console.log("kGateway Helm release not found.");
  }
  try {
    await $`helm uninstall gloo-gateway-crds --namespace ${NAMESPACE}`;
  } catch {
    console.log("kGateway CRDs Helm release not found.");
  }

  // Destroy Terraform (CloudFront, WAF, Shield)
  const kgatewayConfig = config?.kgateway || {};
  await utils.terraform.destroy(DIR, {
    vars: {
      enable_shield_advanced: kgatewayConfig.enableShieldAdvanced || false,
      waf_rate_limit_per_ip: kgatewayConfig.waf?.rateLimitPerIP || 2000,
      enable_geo_restriction: kgatewayConfig.waf?.enableGeoRestriction || false,
      allowed_countries: JSON.stringify(kgatewayConfig.waf?.allowedCountries || []),
    },
  });

  console.log("kGateway uninstalled.");
}
