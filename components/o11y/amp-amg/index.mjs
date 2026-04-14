import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Amazon Managed Prometheus & Grafana (AMP/AMG)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "opentelemetry";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["REGION", "EKS_CLUSTER_NAME"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  console.log("\n========================================");
  console.log("Installing AMP/AMG Monitoring Stack");
  console.log("(Amazon Managed Prometheus + Grafana + ADOT Collector)");
  console.log("========================================\n");

  // Step 1: Provision AMP workspace, AMG workspace, IAM roles via Terraform
  console.log("[1/3] Provisioning AMP/AMG infrastructure (Terraform)...");
  await utils.terraform.apply(DIR);
  const tfOutput = await utils.terraform.output(DIR, {});

  const ampRemoteWriteEndpoint = tfOutput.amp_remote_write_endpoint.value;
  const ampQueryEndpoint = tfOutput.amp_query_endpoint.value;
  const amgEndpoint = tfOutput.amg_endpoint.value;
  const ampWorkspaceId = tfOutput.amp_workspace_id.value;

  console.log(`  AMP Workspace: ${ampWorkspaceId}`);
  console.log(`  AMP Remote Write: ${ampRemoteWriteEndpoint}`);
  console.log(`  AMG Endpoint: ${amgEndpoint}`);

  // Step 2: Add ADOT Helm repo and deploy collector
  console.log("\n[2/3] Deploying ADOT Collector...");
  await $`helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts --force-update`;
  await $`helm repo update`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    AMP_REMOTE_WRITE_ENDPOINT: ampRemoteWriteEndpoint,
    AWS_REGION: process.env.REGION,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));

  await $`helm upgrade --install adot-collector \
    open-telemetry/opentelemetry-collector \
    --namespace ${NAMESPACE} \
    --create-namespace \
    -f ${valuesRenderedPath} \
    --wait --timeout 5m`;

  console.log("  ✅ ADOT Collector deployed");

  // Step 3: Print status and next steps
  console.log("\n[3/3] Verifying deployment...");
  await printStatus(ampQueryEndpoint, amgEndpoint);

  console.log("\n========================================");
  console.log("Next Steps");
  console.log("========================================");
  console.log(`1. Access AMG: ${amgEndpoint}`);
  console.log("2. Add AMP as a data source in Grafana:");
  console.log(`   - Type: Prometheus`);
  console.log(`   - URL: ${ampQueryEndpoint}`);
  console.log("   - Auth: SigV4 (auto-configured via AMG role)");
  console.log("3. Import GenAI dashboards for vLLM/LiteLLM metrics");
}

async function printStatus(ampEndpoint, amgEndpoint) {
  console.log("\n--- ADOT Collector Pods ---");
  try {
    await $`kubectl get pods -n ${NAMESPACE}`;
  } catch {
    console.log("  (No pods found)");
  }

  console.log("\n--- Endpoints ---");
  console.log(`  AMP Query: ${ampEndpoint}`);
  console.log(`  AMG Dashboard: ${amgEndpoint}`);
}

export async function uninstall() {
  console.log("\nUninstalling AMP/AMG Monitoring Stack...");

  // Remove ADOT collector
  try {
    await $`helm uninstall adot-collector --namespace ${NAMESPACE}`;
    console.log("ADOT Collector uninstalled.");
  } catch {
    console.log("ADOT Collector not found or already removed.");
  }

  // Delete namespace
  try {
    await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
  } catch {
    // ignore
  }

  // Destroy Terraform resources (AMP, AMG, IAM)
  await utils.terraform.destroy(DIR);
  console.log("AMP/AMG infrastructure destroyed.");
}
