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

const KGATEWAY_VERSION = "v2.2.3";
const NAMESPACE = "kgateway-system";

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
    --version ${KGATEWAY_VERSION} kgateway-crds \
    oci://cr.kgateway.dev/kgateway-dev/charts/kgateway-crds`;

  console.log("\nInstalling kGateway...");
  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  fs.writeFileSync(valuesRenderedPath, valuesTemplate({}));

  await $`helm upgrade -i --create-namespace \
    --namespace ${NAMESPACE} \
    --version ${KGATEWAY_VERSION} kgateway \
    oci://cr.kgateway.dev/kgateway-dev/charts/kgateway \
    -f ${valuesRenderedPath}`;

  console.log("  kGateway installed");

  // Step 3: Provision TLS certificate (cert-manager + Let's Encrypt)
  console.log("\n[3/6] Provisioning TLS certificate...");
  try {
    await $`kubectl get namespace cert-manager`.quiet();
    console.log("  cert-manager already installed");
  } catch {
    console.log("  Installing cert-manager...");
    await $`kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.17.2/cert-manager.yaml`;
    await $`kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=120s`;

    // Create IRSA role for cert-manager to access Route53 (DNS-01 challenge)
    console.log("  Creating IRSA role for cert-manager...");
    const clusterName = process.env.EKS_CLUSTER_NAME;
    const region = process.env.REGION;
    const accountId = (await $`aws sts get-caller-identity --query Account --output text`.quiet()).stdout.trim();
    const oidcUrl = (await $`aws eks describe-cluster --name ${clusterName} --region ${region} --query "cluster.identity.oidc.issuer" --output text`.quiet()).stdout.trim();
    const oidcId = oidcUrl.split("/").pop();
    const hostedZoneId = (await $`aws route53 list-hosted-zones-by-name --dns-name ${process.env.DOMAIN} --query "HostedZones[0].Id" --output text`.quiet()).stdout.trim().replace("/hostedzone/", "");
    const roleName = `${clusterName}-cert-manager`;

    const trustPolicy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { Federated: `arn:aws:iam::${accountId}:oidc-provider/oidc.eks.${region}.amazonaws.com/id/${oidcId}` },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: { StringEquals: {
          [`oidc.eks.${region}.amazonaws.com/id/${oidcId}:sub`]: "system:serviceaccount:cert-manager:cert-manager",
          [`oidc.eks.${region}.amazonaws.com/id/${oidcId}:aud`]: "sts.amazonaws.com",
        }},
      }],
    });

    try {
      await $`aws iam create-role --role-name ${roleName} --assume-role-policy-document ${trustPolicy} --region ${region}`.quiet();
    } catch { /* role may already exist */ }

    const route53Policy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: "route53:GetChange", Resource: "arn:aws:route53:::change/*" },
        { Effect: "Allow", Action: ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets"], Resource: `arn:aws:route53:::hostedzone/${hostedZoneId}` },
        { Effect: "Allow", Action: "route53:ListHostedZonesByName", Resource: "*" },
      ],
    });
    await $`aws iam put-role-policy --role-name ${roleName} --policy-name route53-dns01 --policy-document ${route53Policy}`.quiet();

    await $`kubectl annotate serviceaccount cert-manager -n cert-manager eks.amazonaws.com/role-arn=arn:aws:iam::${accountId}:role/${roleName} --overwrite`;
    await $`kubectl rollout restart deployment cert-manager -n cert-manager`;
    await $`kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=60s`;
    console.log("  cert-manager IRSA configured");
  }

  // Create ClusterIssuer + Certificate if not exists
  try {
    await $`kubectl get certificate wildcard-tls -n ${NAMESPACE}`.quiet();
    console.log("  Wildcard TLS certificate already exists");
  } catch {
    console.log("  Creating Let's Encrypt ClusterIssuer + wildcard certificate...");
    const certYaml = `
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@${process.env.DOMAIN}
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
    - dns01:
        route53:
          region: ${process.env.REGION}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wildcard-tls
  namespace: ${NAMESPACE}
spec:
  secretName: wildcard-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - "*.${process.env.DOMAIN}"
  - "${process.env.DOMAIN}"
`;
    await $`echo ${certYaml} | kubectl apply -f -`;
    console.log("  Waiting for certificate issuance (DNS-01 challenge)...");
    await $`kubectl wait --for=condition=Ready certificate/wildcard-tls -n ${NAMESPACE} --timeout=300s`;
    console.log("  TLS certificate issued");
  }

  // Step 4: Apply Gateway resource
  console.log("\n[4/6] Creating Gateway resource...");
  const gatewayTemplatePath = path.join(DIR, "gateway.template.yaml");
  const gatewayRenderedPath = path.join(DIR, "gateway.rendered.yaml");
  utils.renderTemplate(gatewayTemplatePath, gatewayRenderedPath, {
    DOMAIN: process.env.DOMAIN,
  });
  await $`kubectl apply -f ${gatewayRenderedPath}`;

  // Step 5: Apply HTTPRoutes + ReferenceGrants
  console.log("\n[5/6] Creating HTTPRoutes...");
  const routesTemplatePath = path.join(DIR, "httproutes.template.yaml");
  const routesRenderedPath = path.join(DIR, "httproutes.rendered.yaml");
  utils.renderTemplate(routesTemplatePath, routesRenderedPath, {
    DOMAIN: process.env.DOMAIN,
  });
  await $`kubectl apply -f ${routesRenderedPath}`;

  // Enable WebSocket upgrade (required for OpenWebUI Socket.IO)
  console.log("  Enabling WebSocket upgrade support...");
  const wsPolicy = `
apiVersion: gateway.kgateway.dev/v1alpha1
kind: HTTPListenerPolicy
metadata:
  name: enable-websocket
  namespace: ${NAMESPACE}
spec:
  targetRefs:
  - group: gateway.networking.k8s.io
    kind: Gateway
    name: main-gateway
  upgradeConfig:
    enabledUpgrades:
    - websocket
`;
  await $`echo ${wsPolicy} | kubectl apply -f -`;

  // Step 6: Apply OIDC auth (if configured)
  if (process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) {
    console.log("\n[6/6] Configuring OIDC authentication...");
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
    console.log("\n[6/6] OIDC not configured — skipping auth policy");
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
  await $`kubectl delete httplistenerpolicy enable-websocket -n ${NAMESPACE} --ignore-not-found`;
  await $`kubectl delete trafficpolicy increase-timeout -n ${NAMESPACE} --ignore-not-found`;
  const renderedFiles = ["traffic-policy", "secret", "httproutes", "gateway"];
  for (const f of renderedFiles) {
    const renderedPath = path.join(DIR, `${f}.rendered.yaml`);
    if (fs.existsSync(renderedPath)) {
      await $`kubectl delete -f ${renderedPath} --ignore-not-found`;
    }
  }

  // Uninstall Helm
  try {
    await $`helm uninstall kgateway --namespace ${NAMESPACE}`;
  } catch {
    console.log("kGateway Helm release not found.");
  }
  try {
    await $`helm uninstall kgateway-crds --namespace ${NAMESPACE}`;
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
