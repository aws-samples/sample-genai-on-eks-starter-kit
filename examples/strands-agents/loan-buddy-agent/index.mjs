#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

// Loan Buddy (Strands) - Alternative Stack example.
// Builds + pushes the agent image to its own ECR repo (created by main.tf),
// then deploys it wired to: Kong /loan-strands -> Bedrock, the 3 MCP tool
// servers, S3 (image storage via Pod Identity), and Arize AX tracing.

export const name = "Loan Buddy Agent (Strands, Kong+Arize)";
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
  // region/name come from config.terraform.vars (populated from .env / .env.local:
  // REGION, EKS_CLUSTER_NAME). We read them here ONLY for the AWS CLI calls below.
  // NOTE: do NOT pass them again via terraform options.vars — utils.terraform.apply
  // already writes config.terraform.vars into the tfvars file, and passing them a
  // second time causes "Attribute redefined" (region/name written twice).
  const REGION = process.env.REGION || process.env.AWS_REGION || "us-east-1";

  // 1. Terraform: ECR repo + S3 Pod Identity for the agent SA. Idempotent — a
  //    re-run reconciles existing resources (no-op if already present).
  await utils.terraform.apply(DIR);
  // utils.terraform.output expects the output name in options.outputName; with it,
  // it returns the RAW string (terraform output -raw). Without it, it returns the
  // full JSON object — so we must pass { outputName } to get a usable string.
  const ecrUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });
  if (!ecrUrl || typeof ecrUrl !== "string") {
    throw new Error("terraform did not return ecr_repository_url as a string — check the apply output above");
  }

  // 2. Build + push a MULTI-ARCH image (amd64 + arm64) so the pod runs on any node.
  //    The v2 cluster has mixed-arch nodes (Graviton arm64 + x86 amd64). A single-arch
  //    image causes "no match for platform in manifest" -> ImagePullBackOff when the
  //    pod lands on the other arch. buildx builds both and pushes a manifest list.
  const registry = ecrUrl.substring(0, ecrUrl.indexOf("/"));
  await $`aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${registry}`;
  await $`docker buildx build --platform linux/amd64,linux/arm64 -t ${ecrUrl}:latest --push ${DIR}`;

  // 3. Ensure namespace (idempotent).
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
    // We build a MULTI-ARCH image, so the pod must NOT be pinned to one arch.
    // The template renders the arch nodeSelector only under {{#unless useBuildx}},
    // so useBuildx:true => no nodeSelector => schedules on amd64 OR arm64 nodes.
    useBuildx: true,
    arch: "multi",
    IMAGE: `${ecrUrl}:latest`,
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
