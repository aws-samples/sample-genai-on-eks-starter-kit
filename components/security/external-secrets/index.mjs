import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "External Secrets Operator";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "external-secrets";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["REGION", "EKS_CLUSTER_NAME"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  console.log("\n========================================");
  console.log("Installing External Secrets Operator");
  console.log("(ESO + AWS Secrets Manager / Parameter Store)");
  console.log("========================================\n");

  // Step 1: Provision IAM role and Pod Identity via Terraform
  console.log("[1/4] Provisioning IAM role for ESO (Terraform)...");
  await utils.terraform.apply(DIR);
  const tfOutput = await utils.terraform.output(DIR, {});
  const esoRoleArn = tfOutput.eso_role_arn.value;
  console.log(`  IAM Role: ${esoRoleArn}`);

  // Step 2: Add Helm repo and install ESO
  console.log("\n[2/4] Installing External Secrets Operator (Helm)...");
  await $`helm repo add external-secrets https://charts.external-secrets.io --force-update`;
  await $`helm repo update`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  fs.writeFileSync(valuesRenderedPath, valuesTemplate({}));

  await $`helm upgrade --install external-secrets \
    external-secrets/external-secrets \
    --namespace ${NAMESPACE} \
    --create-namespace \
    -f ${valuesRenderedPath} \
    --wait --timeout 5m`;

  console.log("  ✅ External Secrets Operator installed");

  // Step 3: Wait for CRDs and webhook to be ready
  console.log("\n[3/4] Waiting for ESO webhook to be ready...");
  await $`kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=external-secrets-webhook -n ${NAMESPACE} --timeout=120s`;

  // Step 4: Create ClusterSecretStores for AWS backends
  console.log("\n[4/4] Creating ClusterSecretStores...");
  const cssTemplatePath = path.join(DIR, "cluster-secret-store.template.yaml");
  const cssRenderedPath = path.join(DIR, "cluster-secret-store.rendered.yaml");
  const cssTemplateString = fs.readFileSync(cssTemplatePath, "utf8");
  const cssTemplate = handlebars.compile(cssTemplateString);
  fs.writeFileSync(cssRenderedPath, cssTemplate({ AWS_REGION: process.env.REGION }));

  await $`kubectl apply -f ${cssRenderedPath}`;
  console.log("  ✅ ClusterSecretStore 'aws-secrets-manager' created");
  console.log("  ✅ ClusterSecretStore 'aws-parameter-store' created");

  // Print status
  await printStatus();

  console.log("\n========================================");
  console.log("Next Steps");
  console.log("========================================");
  console.log("Create ExternalSecret resources to sync secrets from AWS:");
  console.log("  apiVersion: external-secrets.io/v1beta1");
  console.log("  kind: ExternalSecret");
  console.log("  spec:");
  console.log("    secretStoreRef:");
  console.log("      name: aws-secrets-manager");
  console.log("      kind: ClusterSecretStore");
  console.log("    target:");
  console.log("      name: my-k8s-secret");
  console.log("    data:");
  console.log("      - secretKey: api-key");
  console.log("        remoteRef:");
  console.log("          key: my-aws-secret-name");
}

async function printStatus() {
  console.log("\n--- ESO Pods ---");
  try {
    await $`kubectl get pods -n ${NAMESPACE}`;
  } catch {
    console.log("  (No pods found)");
  }

  console.log("\n--- ClusterSecretStores ---");
  try {
    await $`kubectl get clustersecretstores`;
  } catch {
    console.log("  (No ClusterSecretStores found)");
  }
}

export async function uninstall() {
  console.log("\nUninstalling External Secrets Operator...");

  // Remove ClusterSecretStores
  try {
    await $`kubectl delete clustersecretstore aws-secrets-manager aws-parameter-store --ignore-not-found`;
    console.log("ClusterSecretStores removed.");
  } catch {
    // ignore
  }

  // Uninstall Helm release
  try {
    await $`helm uninstall external-secrets --namespace ${NAMESPACE}`;
    console.log("ESO Helm release uninstalled.");
  } catch {
    console.log("ESO not found or already removed.");
  }

  // Delete namespace
  try {
    await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
  } catch {
    // ignore
  }

  // Destroy Terraform resources (IAM role, Pod Identity)
  await utils.terraform.destroy(DIR);
  console.log("ESO infrastructure destroyed.");
}
