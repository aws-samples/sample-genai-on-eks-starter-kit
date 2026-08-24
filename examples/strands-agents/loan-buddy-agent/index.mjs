#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

// Loan Buddy (Strands) - Alternative Stack example.
// Pulls a PRE-BUILT MULTI-ARCH image from the shared public ECR registry
// (public.ecr.aws/agentic-ai-platforms-on-k8s), then deploys it wired to:
// Kong /loan-strands -> Bedrock, the 3 MCP tool servers, S3 (image storage via
// Pod Identity), and Arize AX tracing. No per-participant build/push — matches
// the calculator-agent / calculator examples.

export const name = "Loan Buddy Agent (Strands, Kong+Arize)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

// Pre-built public ECR image (published multi-arch by the maintainers via
// examples/build-ecr-images.sh — same pattern as calculator-agent / calculator).
const ECR_REGISTRY_ALIAS = "agentic-ai-platforms-on-k8s";
const IMAGE_NAME = "strands-agents-loan-buddy-agent";
const IMAGE_URL = `public.ecr.aws/${ECR_REGISTRY_ALIAS}/${IMAGE_NAME}:latest`;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

// Verify the workshop-provisioned prerequisites exist BEFORE any work
// (terraform apply for S3 Pod Identity, then deploy). If a prerequisite is missing,
// print clear guidance and exit(1) — a standalone starter-kit user should never
// stumble into a broken half-deploy with no explanation.
async function preflightOrExit() {
  const problems = [];

  // 1. Kong proxy service in the `kong` namespace (created by the workshop's Kong
  //    Operator install — the starter kit's own `ai-gateway/kong` component does not
  //    create a service named `proxy1`).
  let kongOk = false;
  try {
    await $`kubectl get svc -n kong proxy1`.quiet();
    kongOk = true;
  } catch {
    problems.push(
      "Kong proxy service 'proxy1' not found in namespace 'kong'.\n" +
        "     The Kong AI Gateway (DataPlane + /loan-strands route) is provisioned by the workshop's\n" +
        "     alternative-stack track (Kong Operator 2.x + KongService/KongRoute/KongPlugin CRDs)."
    );
  }

  // 2. Arize credentials Secret (created by `./cli o11y arize install`). Not fatal on
  //    its own — the agent still runs with tracing DISABLED — so this is a WARNING,
  //    not a hard stop. We surface it so the user isn't surprised by missing traces.
  let arizeOk = false;
  try {
    await $`kubectl get secret arize-credentials -n arize`.quiet();
    arizeOk = true;
  } catch {
    /* handled as a warning below */
  }

  if (problems.length) {
    console.error("\n❌ Loan Buddy (Kong+Arize) is a workshop-companion example and its prerequisites are not ready.\n");
    problems.forEach((p, i) => console.error(`   ${i + 1}. ${p}`));
    console.error("\n   This example calls Amazon Bedrock THROUGH the Kong AI Gateway (it holds no Bedrock key),");
    console.error("   so the Kong `/loan-strands` route must exist first. It is designed to run as part of the");
    console.error("   EKS Agentic AI workshop, which provisions that gateway for you.");
    console.error("\n   → Complete the workshop's alternative-stack setup (Kong Operator + /loan-strands route),");
    console.error("     then re-run:  ./cli strands-agents loan-buddy-agent install");
    console.error("\n   Workshop: https://github.com/aws-samples/sample-genai-on-eks-starter-kit (EKS Agentic AI workshop, Track B / alternative stack).\n");
    process.exit(1);
  }

  if (!arizeOk) {
    console.log(
      "\n⚠️  arize-credentials Secret not found in the 'arize' namespace.\n" +
        "   The agent will deploy with Arize AX tracing DISABLED (it still works end to end).\n" +
        "   To enable tracing, run `./cli o11y arize install` first, then re-run this example.\n"
    );
  }

  console.log("✅ Preflight passed: Kong /loan-strands gateway present" + (arizeOk ? " + Arize credentials found." : " (Arize tracing will be disabled)."));
}

export async function install() {
  // --- Preflight: WORKSHOP COMPANION guard ---------------------------------
  // This example depends on the Kong AI Gateway `/loan-strands` route (KongService/
  // KongRoute/KongPlugin/KongConsumer + ai-proxy -> Bedrock) that the EKS Agentic AI
  // workshop's alternative-stack track provisions. The starter kit does NOT create
  // that route, so a standalone user would otherwise fail deep inside the multi-arch
  // build/deploy with a confusing error. Check the prerequisites FIRST and, if they
  // are missing, exit in seconds with clear guidance instead.
  await preflightOrExit();

  // region/name come from config.terraform.vars (populated from .env / .env.local:
  // REGION, EKS_CLUSTER_NAME). We read them here ONLY for the AWS CLI calls below.
  // NOTE: do NOT pass them again via terraform options.vars — utils.terraform.apply
  // already writes config.terraform.vars into the tfvars file, and passing them a
  // second time causes "Attribute redefined" (region/name written twice).
  const REGION = process.env.REGION || process.env.AWS_REGION || "us-east-1";

  // 1. Terraform: S3 Pod Identity for the agent SA. No ECR repo — the agent runs
  //    a pre-built multi-arch PUBLIC image (IMAGE_URL, pulled at deploy time), so
  //    there is nothing to build or push here. Idempotent — a re-run reconciles
  //    existing resources (no-op if already present).
  await utils.terraform.apply(DIR);

  // 2. Ensure namespace (idempotent).
  await $`kubectl create namespace strands-agents --dry-run=client -o yaml | kubectl apply -f -`;

  // 4. Resolve the Kong proxy LoadBalancer hostname (the /loan-strands route).
  let kongHost = "";
  try {
    const r = await $`kubectl get svc -n kong proxy1 -o jsonpath={.status.loadBalancer.ingress[0].hostname}`;
    kongHost = r.stdout.trim();
  } catch {
    console.log("WARN: kong proxy1 svc not found; set KONG_BASE_URL manually in the rendered yaml.");
  }
  const KONG_BASE_URL =
    process.env.KONG_BASE_URL ||
    (kongHost ? `http://${kongHost}/loan-strands` : "http://kong-proxy/loan-strands");

  // 5. S3 bucket for image storage. Reuse THIS cluster's langfuse bucket.
  //    Match on the cluster name (e.g. genai-on-eks-v2-bucket-langfuse-...) so we don't
  //    accidentally grab a different stack's langfuse bucket (v1 vs v2).
  const CLUSTER = process.env.EKS_CLUSTER_NAME || "genai-on-eks";
  let s3Bucket = process.env.S3_BUCKET_NAME || "";
  if (!s3Bucket) {
    try {
      const r = await $`aws s3 ls --region ${REGION}`;
      const buckets = r.stdout.split("\n").map((l) => l.trim().split(/\s+/).pop()).filter(Boolean);
      // prefer "<cluster>-bucket-langfuse-*"; fall back to any langfuse bucket.
      s3Bucket =
        buckets.find((b) => b.startsWith(`${CLUSTER}-bucket-langfuse`)) ||
        buckets.find((b) => b.includes(`${CLUSTER}`) && b.includes("langfuse")) ||
        buckets.find((b) => b.includes("langfuse")) ||
        "";
    } catch {
      /* ignore */
    }
  }

  // 6. Copy the arize-credentials Secret into strands-agents (Secrets are namespaced).
  //    Idempotent: the apply upserts. Skips gracefully if the source Secret is absent.
  let arizeEnabled = false;
  try {
    await $`kubectl get secret arize-credentials -n arize`.quiet();
    await $`kubectl get secret arize-credentials -n arize -o json \
      | jq '.metadata.namespace="strands-agents" | del(.metadata.resourceVersion,.metadata.uid,.metadata.creationTimestamp,.metadata.ownerReferences)' \
      | kubectl apply -f -`;
    arizeEnabled = true;
  } catch {
    console.log("WARN: arize-credentials Secret not found in 'arize' ns; run `./cli o11y arize install` first. Tracing DISABLED (agent still works).");
  }

  // 7. Render + apply the deployment.
  const agentTemplatePath = path.join(DIR, "agent.template.yaml");
  const agentRenderedPath = path.join(DIR, "agent.rendered.yaml");
  const agentTemplate = handlebars.compile(fs.readFileSync(agentTemplatePath, "utf8"));
  const envCfg = config.examples["strands-agents"]["loan-buddy-agent"].env;
  const agentVars = {
    // Pre-built multi-arch public image → runs on any node arch, no nodeSelector needed.
    IMAGE: IMAGE_URL,
    KONG_BASE_URL,
    KONG_API_KEY: process.env.LOAN_STRANDS_KONG_KEY || "loan-strands-key-123",
    KONG_MODEL_ID: envCfg.KONG_MODEL_ID || "openai/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    // MCP servers are deployed by the default Loan Buddy (Module 3) in the `workshop`
    // namespace on port 8000. Reference them cross-namespace via their FQDN.
    MCP_IMAGE_PROCESSOR: "http://mcp-image-processor.workshop:8000",
    MCP_ADDRESS_VALIDATOR: "http://mcp-address-validator.workshop:8000",
    MCP_EMPLOYMENT_VALIDATOR: "http://mcp-employment-validator.workshop:8000",
    S3_BUCKET_NAME: s3Bucket,
    AWS_REGION: REGION,
    ARIZE_ENABLED: arizeEnabled,
    ARIZE_PROJECT_NAME: envCfg.ARIZE_PROJECT_NAME || "loan-strands",
  };
  fs.writeFileSync(agentRenderedPath, agentTemplate(agentVars));
  await $`kubectl apply -f ${agentRenderedPath}`;

  // 8. Wait for rollout (idempotent; safe on re-run).
  try {
    await $`kubectl rollout status deployment/loan-buddy-agent -n strands-agents --timeout=300s`;
  } catch {
    console.log("WARN: rollout did not complete within timeout — check: kubectl get pods -n strands-agents");
  }

  console.log(
    `\nLoan Buddy (Strands) deployed to namespace 'strands-agents'.` +
      `\n  LLM:   ${KONG_BASE_URL} (Kong ai-proxy -> Bedrock)` +
      `\n  Arize: ${arizeEnabled ? "enabled (project loan-strands)" : "DISABLED"}` +
      `\n  S3:    ${s3Bucket || "(unset - set S3_BUCKET_NAME)"}`
  );
}

export async function uninstall() {
  // Idempotent: --ignore-not-found on the k8s delete; terraform.destroy is a no-op
  // if nothing exists. region/name come from config.terraform.vars (do NOT pass again).
  const agentRenderedPath = path.join(DIR, "agent.rendered.yaml");
  if (fs.existsSync(agentRenderedPath)) {
    await $`kubectl delete -f ${agentRenderedPath} --ignore-not-found`;
  } else {
    // fall back to deleting by name so uninstall works even without the rendered file
    await $`kubectl delete deployment,service,serviceaccount loan-buddy-agent -n strands-agents --ignore-not-found`;
  }
  await utils.terraform.destroy(DIR);
}
