import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { $ } from "zx";
$.verbose = true;

// Arize AX (SaaS) observability backend.
//
// Unlike Langfuse/Phoenix (self-hosted in-cluster), Arize AX is a hosted SaaS
// platform (app.arize.com). There is nothing to `helm install`. This component
// instead provisions the credentials that in-cluster agents use to export
// OpenInference / OpenTelemetry traces to Arize AX:
//   - a Kubernetes Secret `arize-credentials` in the shared `arize` namespace
//     holding ARIZE_API_KEY + ARIZE_SPACE_ID (read from env at install time).
// Agents (e.g. the Strands loan-buddy example) reference this Secret via
// envFrom / secretKeyRef to send app-level spans to Arize AX.
//
// Required env (in .env / .env.local):
//   ARIZE_API_KEY   - the Arize AX *Service* API key (ak-... , 72 char)
//   ARIZE_SPACE_ID  - the Arize AX Space ID (base64-ish, e.g. U3BhY2U6...)
// Optional:
//   ARIZE_OTLP_ENDPOINT - defaults to https://otlp.arize.com (gRPC)

export const name = "Arize AX (SaaS)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
const NAMESPACE = "arize";
let BASE_DIR;
let config;
let utils;

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  // Preflight: this is a WORKSHOP COMPANION component. It expects the Arize AX
  // (SaaS) Space + Service key that the EKS Agentic AI workshop's alternative-stack
  // module walks you through creating. If those aren't set, fail fast with guidance
  // instead of a half-created Secret.
  const missing = ["ARIZE_API_KEY", "ARIZE_SPACE_ID"].filter((v) => !process.env[v]);
  if (missing.length) {
    console.error("\n❌ Arize AX is a workshop-companion component and its prerequisites are not set.");
    console.error(`   Missing: ${missing.join(", ")}`);
    console.error("\n   This component provisions the in-cluster credentials that agents use to send");
    console.error("   OpenInference traces to Arize AX (SaaS). It expects an Arize AX Space + *Service*");
    console.error("   API key, which the EKS Agentic AI workshop's alternative-stack track walks you");
    console.error("   through creating.");
    console.error("\n   To use it standalone:");
    console.error("     1. Create a free Space at https://app.arize.com and copy the Service API key + Space ID");
    console.error("     2. Set them in .env / .env.local:");
    console.error("          ARIZE_API_KEY=ak-...      # 72-char Service key (NOT the 40-char user key)");
    console.error("          ARIZE_SPACE_ID=...        # from Space Settings");
    console.error("     3. Re-run this component.");
    console.error("\n   Workshop setup: https://github.com/aws-samples/sample-genai-on-eks-starter-kit (see the EKS Agentic AI workshop, Track B / alternative stack).\n");
    process.exit(1);
  }
  const {
    ARIZE_API_KEY,
    ARIZE_SPACE_ID,
    ARIZE_OTLP_ENDPOINT = "https://otlp.arize.com",
  } = process.env;

  // Ensure the shared namespace exists (idempotent).
  await $`kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`;

  // Create/refresh the credentials Secret (idempotent via apply).
  await $`kubectl create secret generic arize-credentials \
    --namespace ${NAMESPACE} \
    --from-literal=ARIZE_API_KEY=${ARIZE_API_KEY} \
    --from-literal=ARIZE_SPACE_ID=${ARIZE_SPACE_ID} \
    --from-literal=ARIZE_OTLP_ENDPOINT=${ARIZE_OTLP_ENDPOINT} \
    --dry-run=client -o yaml | kubectl apply -f -`;

  console.log(
    `\nArize AX (SaaS) configured. Traces will be sent to ${ARIZE_OTLP_ENDPOINT}.` +
      `\nSecret 'arize-credentials' created in namespace '${NAMESPACE}'.` +
      `\nAgents export OpenInference spans directly to Arize AX (app.arize.com).`
  );
}

export async function uninstall() {
  await $`kubectl delete secret arize-credentials --namespace ${NAMESPACE} --ignore-not-found`;
  await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
}
