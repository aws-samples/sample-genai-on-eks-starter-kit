#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import inquirer from "inquirer";
import { $ } from "zx";
$.verbose = true;

export const name = "Dynamo Platform";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

// Default Dynamo version
const DEFAULT_RELEASE_VERSION = "0.8.0";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

// Check if CRDs are already installed
async function areCRDsInstalled() {
  try {
    const result = await $`kubectl get crd dynamographdeployments.nvidia.com`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Check if Dynamo Platform is already installed
async function isPlatformInstalled(namespace) {
  try {
    const result = await $`helm list -n ${namespace} -q`.quiet();
    return result.stdout.trim().includes("dynamo-platform");
  } catch {
    return false;
  }
}

export async function install() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s 
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  
  const releaseVersion = platformConfig.releaseVersion || DEFAULT_RELEASE_VERSION;
  const namespace = platformConfig.namespace || "dynamo-system";
  
  console.log("\n========================================");
  console.log("Installing Dynamo Kubernetes Platform");
  console.log("========================================\n");
  console.log(`Platform: ${isK8s ? "K8s" : "EKS"}`);
  console.log(`Version: ${releaseVersion}`);
  console.log(`Namespace: ${namespace}`);
  
  // Check if already installed
  const platformInstalled = await isPlatformInstalled(namespace);
  if (platformInstalled) {
    console.log("\nDynamo Platform is already installed.");
    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Upgrade with current config", value: "upgrade" },
        { name: "Skip (keep existing)", value: "skip" },
      ],
    }]);
    
    if (action === "skip") {
      console.log("Skipping Dynamo Platform installation.");
      await printStatus(namespace);
      return;
    }
  }
  
  // Configuration prompts
  const { enableGrove, enableKaiScheduler } = await inquirer.prompt([
    {
      type: "confirm",
      name: "enableGrove",
      message: "Enable Grove for multi-node inference orchestration?",
      default: platformConfig.groveEnabled ?? true,
    },
    {
      type: "confirm",
      name: "enableKaiScheduler",
      message: "Enable KAI Scheduler for AI workload scheduling?",
      default: platformConfig.kaiSchedulerEnabled ?? true,
    },
  ]);
  
  // Step 1: Install CRDs (if not already installed)
  console.log("\n[1/3] Checking CRDs...");
  const crdsInstalled = await areCRDsInstalled();
  if (!crdsInstalled) {
    console.log("Installing Dynamo CRDs...");
    await $`helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-${releaseVersion}.tgz`;
    await $`helm install dynamo-crds dynamo-crds-${releaseVersion}.tgz --namespace default`;
    await $`rm -f dynamo-crds-${releaseVersion}.tgz`;
  } else {
    console.log("CRDs already installed, skipping.");
  }
  
  // Step 2: Render values template
  console.log("\n[2/3] Preparing values...");
  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  
  const valuesVars = {
    IS_K8S: isK8s,
    IS_EKS: !isK8s,
    GROVE_ENABLED: enableGrove,
    KAI_SCHEDULER_ENABLED: enableKaiScheduler,
    // Storage class for etcd/nats persistence
    STORAGE_CLASS: isK8s 
      ? (config?.platform?.k8s?.storageClass || "local-path")
      : (config?.platform?.eks?.storageClass || "gp3"),
  };
  
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  
  // Step 3: Install Platform
  console.log("\n[3/3] Installing Dynamo Platform...");
  console.log(`  Grove: ${enableGrove}`);
  console.log(`  KAI Scheduler: ${enableKaiScheduler}`);
  
  await $`helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-${releaseVersion}.tgz`;
  await $`helm upgrade --install dynamo-platform dynamo-platform-${releaseVersion}.tgz \
    --namespace ${namespace} \
    --create-namespace \
    -f ${valuesRenderedPath} \
    --wait --timeout 10m`;
  await $`rm -f dynamo-platform-${releaseVersion}.tgz`;
  
  console.log("\n✅ Dynamo Platform installed successfully!");
  await printStatus(namespace);
  
  // Next steps
  console.log("\n========================================");
  console.log("Next Steps");
  console.log("========================================");
  console.log("1. Create HuggingFace token secret:");
  console.log(`   kubectl create secret generic hf-token-secret \\`);
  console.log(`     --from-literal=HF_TOKEN=\${HF_TOKEN} \\`);
  console.log(`     -n ${namespace}`);
  console.log("\n2. Deploy a model using Dynamo vLLM or TRT-LLM component");
}

async function printStatus(namespace) {
  console.log("\n========================================");
  console.log("Dynamo Platform Status");
  console.log("========================================\n");
  
  console.log("CRDs:");
  try {
    await $`kubectl get crd | grep dynamo`;
  } catch {
    console.log("  (No Dynamo CRDs found)");
  }
  
  console.log("\nPods:");
  try {
    await $`kubectl get pods -n ${namespace}`;
  } catch {
    console.log("  (No pods found)");
  }
  
  console.log("\nServices:");
  try {
    await $`kubectl get svc -n ${namespace}`;
  } catch {
    console.log("  (No services found)");
  }
}

export async function uninstall() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s 
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  
  const namespace = platformConfig.namespace || "dynamo-system";
  
  console.log("\nUninstalling Dynamo Platform...");
  
  try {
    await $`helm uninstall dynamo-platform --namespace ${namespace}`;
  } catch (e) {
    console.log("Dynamo Platform helm release not found or already removed");
  }
  
  const { deleteCRDs } = await inquirer.prompt([{
    type: "confirm",
    name: "deleteCRDs",
    message: "Also delete Dynamo CRDs? (This will remove all DynamoGraphDeployments)",
    default: false,
  }]);
  
  if (deleteCRDs) {
    console.log("Deleting CRDs...");
    try {
      await $`helm uninstall dynamo-crds --namespace default`;
    } catch {
      // Manual CRD deletion
      const crds = [
        "dynamocheckpoints.nvidia.com",
        "dynamocomponentdeployments.nvidia.com",
        "dynamographdeploymentrequests.nvidia.com",
        "dynamographdeployments.nvidia.com",
        "dynamographdeploymentscalingadapters.nvidia.com",
        "dynamomodels.nvidia.com",
        "dynamoworkermetadatas.nvidia.com",
      ];
      for (const crd of crds) {
        await $`kubectl delete crd ${crd} --ignore-not-found`.quiet();
      }
    }
  }
  
  console.log("Dynamo Platform uninstalled.");
}
