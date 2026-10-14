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

// cert-manager is a hard prerequisite of the ADOT EKS add-on: the ADOT
// Operator's admission webhook needs a TLS certificate that cert-manager
// provisions. Pin both to avoid non-reproducible `latest` deployments.
const CERT_MANAGER_VERSION = "v1.16.2";
// EKS ADOT managed add-on. We intentionally use the managed add-on rather than
// the community opentelemetry-collector Helm chart with an image override:
// EKS pins and lifecycle-manages the ADOT Operator image for us, so there is no
// `tag: latest` to drift. `aws eks describe-addon-versions` resolves the
// default version compatible with the cluster's Kubernetes version.
const ADOT_ADDON_NAME = "adot";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["REGION", "EKS_CLUSTER_NAME"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  const region = process.env.REGION;
  const clusterName = process.env.EKS_CLUSTER_NAME;

  console.log("\n========================================");
  console.log("Installing AMP/AMG Monitoring Stack");
  console.log("(Amazon Managed Prometheus + Grafana + ADOT Collector)");
  console.log("========================================\n");

  // Step 0: Verify prerequisites before provisioning anything, so failures are
  // explained up front rather than surfacing cryptically mid-`terraform apply`.
  await checkPrerequisites(region);

  // Step 1: Provision AMP workspace, AMG workspace, IAM roles via Terraform
  console.log("[1/4] Provisioning AMP/AMG infrastructure (Terraform)...");
  await utils.terraform.apply(DIR);
  const tfOutput = await utils.terraform.output(DIR, {});

  const ampRemoteWriteEndpoint = tfOutput.amp_remote_write_endpoint.value;
  const ampQueryEndpoint = tfOutput.amp_query_endpoint.value;
  const amgEndpoint = tfOutput.amg_endpoint.value;
  const ampWorkspaceId = tfOutput.amp_workspace_id.value;

  console.log(`  AMP Workspace: ${ampWorkspaceId}`);
  console.log(`  AMP Remote Write: ${ampRemoteWriteEndpoint}`);
  console.log(`  AMG Endpoint: ${amgEndpoint}`);

  // Step 2: Install cert-manager (ADOT add-on prerequisite)
  console.log("\n[2/4] Ensuring cert-manager is installed (ADOT prerequisite)...");
  await ensureCertManager();

  // Step 3: Install the EKS ADOT managed add-on (installs the ADOT Operator)
  console.log("\n[3/4] Installing EKS ADOT managed add-on...");
  await ensureAdotAddon(clusterName, region);

  // Step 4: Deploy the ADOT Collector via an OpenTelemetryCollector CR
  console.log("\n[4/4] Deploying ADOT Collector (OpenTelemetryCollector CR)...");
  await $`kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`;

  const manifestTemplatePath = path.join(DIR, "collector.template.yaml");
  const manifestRenderedPath = path.join(DIR, "collector.rendered.yaml");
  const manifestTemplateString = fs.readFileSync(manifestTemplatePath, "utf8");
  const manifestTemplate = handlebars.compile(manifestTemplateString);
  const manifestVars = {
    NAMESPACE,
    AMP_REMOTE_WRITE_ENDPOINT: ampRemoteWriteEndpoint,
    AWS_REGION: region,
  };
  fs.writeFileSync(manifestRenderedPath, manifestTemplate(manifestVars));

  await $`kubectl apply -f ${manifestRenderedPath}`;
  console.log("  Waiting for the collector to roll out...");
  try {
    await $`kubectl rollout status deployment/adot-collector-collector -n ${NAMESPACE} --timeout=5m`;
    console.log("  ✅ ADOT Collector deployed");
  } catch {
    console.log("  ⚠️  Collector not ready yet — check `kubectl get pods -n opentelemetry`");
  }

  // Print status and next steps
  console.log("\nVerifying deployment...");
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

// Fail fast with an actionable message when the account prerequisites for
// `authentication_providers = ["AWS_SSO"]` are not met. AMG with AWS_SSO
// requires IAM Identity Center (which in turn requires AWS Organizations) to be
// enabled in the account; otherwise `terraform apply` of the Grafana workspace
// fails with an opaque error.
async function checkPrerequisites(region) {
  console.log("[0/4] Checking prerequisites...");
  try {
    const result =
      await $`aws sso-admin list-instances --region ${region} --query "Instances[0].InstanceArn" --output text`.quiet();
    const instanceArn = result.stdout.trim();
    if (!instanceArn || instanceArn === "None") {
      throw new Error("no Identity Center instance");
    }
    console.log(`  ✅ IAM Identity Center is enabled (${instanceArn})`);
  } catch {
    console.error("\n❌ Prerequisite not met: IAM Identity Center is not enabled.");
    console.error("   Amazon Managed Grafana is configured with AWS IAM Identity Center (AWS_SSO)");
    console.error("   authentication, which requires IAM Identity Center (and AWS Organizations)");
    console.error("   to be enabled in this account first.");
    console.error("\n   Enable it, then re-run this installer:");
    console.error("     - Console: IAM Identity Center > Enable  (https://console.aws.amazon.com/singlesignon)");
    console.error("     - Docs: https://docs.aws.amazon.com/singlesignon/latest/userguide/get-set-up-for-idc.html");
    process.exit(1);
  }
}

async function ensureCertManager() {
  // Skip if cert-manager is already present (another component or the cluster
  // owner may have installed it).
  try {
    await $`kubectl get deployment cert-manager -n cert-manager`.quiet();
    console.log("  ✅ cert-manager already installed.");
    return;
  } catch {
    // not installed — continue
  }

  await $`helm repo add jetstack https://charts.jetstack.io --force-update`;
  await $`helm repo update jetstack`;
  await $`helm upgrade --install cert-manager jetstack/cert-manager \
    --namespace cert-manager \
    --create-namespace \
    --version ${CERT_MANAGER_VERSION} \
    --set crds.enabled=true \
    --wait --timeout 5m`;
  console.log(`  ✅ cert-manager ${CERT_MANAGER_VERSION} installed.`);
}

async function ensureAdotAddon(clusterName, region) {
  try {
    const status =
      await $`aws eks describe-addon --cluster-name ${clusterName} --addon-name ${ADOT_ADDON_NAME} --region ${region} --query "addon.status" --output text`.quiet();
    if (status.stdout.trim() === "ACTIVE") {
      console.log("  ✅ ADOT add-on is already active.");
      return;
    }
    console.log(`  ⚠️  ADOT add-on status: ${status.stdout.trim()} — waiting for it to become active...`);
  } catch {
    console.log("  ADOT add-on not found. Installing (resolving default compatible version)...");
    try {
      // Resolve the add-on version the cluster's Kubernetes version defaults to,
      // so the ADOT Operator image is pinned by EKS rather than floating.
      const k8sVersion =
        await $`aws eks describe-cluster --name ${clusterName} --region ${region} --query "cluster.version" --output text`.quiet();
      const addonVersion =
        await $`aws eks describe-addon-versions --addon-name ${ADOT_ADDON_NAME} --kubernetes-version ${k8sVersion.stdout.trim()} --region ${region} --query "addons[0].addonVersions[?compatibilities[0].defaultVersion].addonVersion | [0]" --output text`.quiet();
      const version = addonVersion.stdout.trim();
      console.log(`  Using ADOT add-on version ${version}`);
      await $`aws eks create-addon --cluster-name ${clusterName} --addon-name ${ADOT_ADDON_NAME} --addon-version ${version} --resolve-conflicts OVERWRITE --region ${region}`;
    } catch (e) {
      console.error("  Failed to install the ADOT add-on. Please install it manually via the EKS Console.");
      console.error("  EKS Console > Add-ons > AWS Distro for OpenTelemetry (adot)");
      process.exit(1);
    }
  }

  // Wait for the add-on to be ACTIVE (max ~3 minutes)
  for (let i = 0; i < 18; i++) {
    await $`sleep 10`.quiet();
    try {
      const status =
        await $`aws eks describe-addon --cluster-name ${clusterName} --addon-name ${ADOT_ADDON_NAME} --region ${region} --query "addon.status" --output text`.quiet();
      if (status.stdout.trim() === "ACTIVE") {
        console.log("  ✅ ADOT add-on is now active.");
        return;
      }
      console.log(`   Waiting... (${status.stdout.trim()})`);
    } catch {
      // transient — keep polling
    }
  }
  console.log("  ⚠️  ADOT add-on did not reach ACTIVE within the timeout; continuing.");
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

  const region = process.env.REGION;
  const clusterName = process.env.EKS_CLUSTER_NAME;

  // Remove the ADOT Collector CR
  try {
    const manifestRenderedPath = path.join(DIR, "collector.rendered.yaml");
    if (fs.existsSync(manifestRenderedPath)) {
      await $`kubectl delete -f ${manifestRenderedPath} --ignore-not-found`;
    } else {
      await $`kubectl delete opentelemetrycollector adot-collector -n ${NAMESPACE} --ignore-not-found`;
    }
    console.log("ADOT Collector removed.");
  } catch {
    console.log("ADOT Collector not found or already removed.");
  }

  // Remove the EKS ADOT managed add-on (ADOT Operator)
  if (clusterName && region) {
    try {
      await $`aws eks delete-addon --cluster-name ${clusterName} --addon-name ${ADOT_ADDON_NAME} --region ${region}`;
      console.log("ADOT add-on deletion initiated.");
    } catch {
      console.log("ADOT add-on not found or already removed.");
    }
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

  console.log(
    "\nNote: cert-manager was left installed (it may be shared by other components). Remove it manually if unused: `helm uninstall cert-manager -n cert-manager`",
  );
}
