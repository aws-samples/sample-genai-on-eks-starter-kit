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

// NGC Helm chart URL
const NGC_HELM_REPO = "https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts";

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
  
  const releaseVersion = platformConfig.releaseVersion || "0.8.1";
  const namespace = platformConfig.namespace || "dynamo-system";
  
  console.log("\n========================================");
  console.log("Installing Dynamo Kubernetes Platform");
  console.log("========================================\n");
  console.log(`Platform: ${isK8s ? "K8s" : "EKS"}`);
  console.log(`Version: ${releaseVersion}`);
  console.log(`Namespace: ${namespace}`);
  
  // Check StorageClass based on platform
  const storageClass = isK8s 
    ? (config?.platform?.k8s?.storageClass || "local-path")
    : (config?.platform?.eks?.storageClass || "efs");
  
  console.log(`\nChecking StorageClass: ${storageClass}`);
  
  try {
    await $`kubectl get storageclass ${storageClass}`.quiet();
    console.log(`StorageClass '${storageClass}' found.`);
  } catch {
    if (isK8s && storageClass === "local-path") {
      // K8s mode: Auto-install local-path-provisioner
      console.log(`StorageClass '${storageClass}' not found. Installing local-path-provisioner...`);
      await $`kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/master/deploy/local-path-storage.yaml`;
      await $`kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'`;
      console.log("local-path-provisioner installed successfully.");
    } else if (!isK8s && storageClass === "efs") {
      // EKS mode: EFS not configured - auto setup
      console.log(`\n⚠️  EFS StorageClass '${storageClass}' not found. Setting up EFS...`);
      
      const clusterName = process.env.EKS_CLUSTER_NAME;
      const region = process.env.REGION;
      
      if (!clusterName || !region) {
        console.error("Error: EKS_CLUSTER_NAME and REGION must be set in .env for EFS setup.");
        process.exit(1);
      }
      
      // Step 1: Check/Install EFS CSI Driver
      console.log("\n[EFS 1/3] Checking EFS CSI Driver addon...");
      try {
        const addonStatus = await $`aws eks describe-addon --cluster-name ${clusterName} --addon-name aws-efs-csi-driver --region ${region} --query "addon.status" --output text`.quiet();
        if (addonStatus.stdout.trim() === "ACTIVE") {
          console.log("✅ EFS CSI Driver addon is active.");
        } else {
          console.log(`⚠️  EFS CSI Driver status: ${addonStatus.stdout.trim()}`);
        }
      } catch {
        console.log("EFS CSI Driver addon not found. Installing...");
        try {
          await $`aws eks create-addon --cluster-name ${clusterName} --addon-name aws-efs-csi-driver --region ${region}`;
          console.log("✅ EFS CSI Driver addon installation initiated. Waiting for it to become active...");
          // Wait for addon to be active (max 2 minutes)
          for (let i = 0; i < 12; i++) {
            await $`sleep 10`.quiet();
            const status = await $`aws eks describe-addon --cluster-name ${clusterName} --addon-name aws-efs-csi-driver --region ${region} --query "addon.status" --output text`.quiet();
            if (status.stdout.trim() === "ACTIVE") {
              console.log("✅ EFS CSI Driver addon is now active.");
              break;
            }
            console.log(`   Waiting... (${status.stdout.trim()})`);
          }
        } catch (e) {
          console.error("Failed to install EFS CSI Driver. Please install manually via EKS Console.");
          console.error("EKS Console > Add-ons > Amazon EFS CSI Driver");
          process.exit(1);
        }
      }
      
      // Step 2: List existing EFS file systems
      console.log("\n[EFS 2/3] Checking existing EFS file systems...");
      let efsFileSystems = [];
      try {
        const efsResult = await $`aws efs describe-file-systems --region ${region} --query "FileSystems[*].[FileSystemId,Name,LifeCycleState]" --output json`.quiet();
        efsFileSystems = JSON.parse(efsResult.stdout);
      } catch {
        console.log("No EFS file systems found or unable to list.");
      }
      
      let selectedEfsId = "";
      
      if (efsFileSystems.length > 0) {
        // Show existing EFS and let user select
        const efsChoices = efsFileSystems
          .filter(efs => efs[2] === "available")
          .map(efs => ({
            name: `${efs[0]} (${efs[1] || "No name"})`,
            value: efs[0],
          }));
        
        efsChoices.push({ name: "Enter EFS ID manually", value: "__manual__" });
        efsChoices.push({ name: "Skip EFS setup (exit)", value: "__skip__" });
        
        const { efsChoice } = await inquirer.prompt([{
          type: "list",
          name: "efsChoice",
          message: "Select an EFS file system for Dynamo:",
          choices: efsChoices,
        }]);
        
        if (efsChoice === "__skip__") {
          console.log("EFS setup skipped. Please configure EFS manually before using Dynamo.");
          process.exit(1);
        } else if (efsChoice === "__manual__") {
          const { manualEfsId } = await inquirer.prompt([{
            type: "input",
            name: "manualEfsId",
            message: "Enter EFS File System ID (fs-xxxxxxxx):",
            validate: (input) => input.startsWith("fs-") ? true : "Must start with 'fs-'",
          }]);
          selectedEfsId = manualEfsId;
        } else {
          selectedEfsId = efsChoice;
        }
      } else {
        // No EFS found, ask for manual input or show creation guide
        console.log("No existing EFS file systems found in this region.");
        const { createOption } = await inquirer.prompt([{
          type: "list",
          name: "createOption",
          message: "What would you like to do?",
          choices: [
            { name: "Enter EFS ID manually (if you have one)", value: "manual" },
            { name: "Show EFS creation guide and exit", value: "guide" },
          ],
        }]);
        
        if (createOption === "guide") {
          console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EFS Creation Guide
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Create EFS via AWS Console:
   https://console.aws.amazon.com/efs/home?region=${region}#/file-systems

2. Or via AWS CLI:
   aws efs create-file-system --region ${region} --performance-mode generalPurpose --tags Key=Name,Value=dynamo-efs

3. Configure mount targets for your VPC subnets

4. Re-run this installer after EFS is created

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
          process.exit(1);
        } else {
          const { manualEfsId } = await inquirer.prompt([{
            type: "input",
            name: "manualEfsId",
            message: "Enter EFS File System ID (fs-xxxxxxxx):",
            validate: (input) => input.startsWith("fs-") ? true : "Must start with 'fs-'",
          }]);
          selectedEfsId = manualEfsId;
        }
      }
      
      // Step 3: Create StorageClass
      console.log(`\n[EFS 3/3] Creating EFS StorageClass with FileSystemId: ${selectedEfsId}...`);
      const storageClassYaml = `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: efs
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: efs.csi.aws.com
parameters:
  fileSystemId: ${selectedEfsId}
  provisioningMode: efs-ap
  directoryPerms: "777"
  uid: "1000"
  gid: "1000"
`;
      
      try {
        await $`echo ${storageClassYaml} | kubectl apply -f -`;
        console.log("✅ EFS StorageClass 'efs' created successfully.");
      } catch (e) {
        console.error("Failed to create StorageClass:", e.message);
        process.exit(1);
      }
    } else {
      console.error(`Error: StorageClass '${storageClass}' not found. Please install it first.`);
      process.exit(1);
    }
  }
  
  // EKS mode: Check for EFA-enabled nodes (recommended for multi-node)
  if (!isK8s) {
    try {
      const efaNodes = await $`kubectl get nodes -l vpc.amazonaws.com/efa.present=true -o name`.quiet();
      if (efaNodes.stdout.trim()) {
        console.log("✅ EFA-enabled nodes found (recommended for high-performance KV cache transfer)");
      } else {
        console.log("⚠️  No EFA-enabled nodes found. Consider using EFA for multi-node disaggregated serving.");
      }
    } catch {
      // EFA label check failed, not critical
    }
  }
  
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
  // Grove and KAI Scheduler are downloaded from ghcr.io (public) in v0.8.1+
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
  
  // NGC API Key (optional, for future versions that may require it)
  let ngcApiKey = "";
  const { needNgcKey } = await inquirer.prompt([{
    type: "confirm",
    name: "needNgcKey",
    message: "Do you have an NGC API Key? (optional, for private images)",
    default: false,
  }]);
  
  if (needNgcKey) {
    const { inputNgcKey } = await inquirer.prompt([{
      type: "password",
      name: "inputNgcKey",
      message: "Enter NGC API Key:",
      mask: "*",
    }]);
    ngcApiKey = inputNgcKey;
  }
  
  // Create NGC imagePullSecret if provided
  if (ngcApiKey) {
    console.log("\nCreating NGC imagePullSecret...");
    await $`kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -`.quiet();
    try {
      await $`kubectl create secret docker-registry ngc-secret \
        --namespace ${namespace} \
        --docker-server=nvcr.io \
        --docker-username='$oauthtoken' \
        --docker-password=${ngcApiKey} \
        --dry-run=client -o yaml | kubectl apply -f -`.quiet();
      console.log("NGC imagePullSecret created/updated.");
    } catch (e) {
      console.error("Warning: Failed to create NGC secret:", e.message);
    }
  }
  
  // Step 1: Install CRDs (if not already installed)
  console.log("\n[1/3] Checking CRDs...");
  const crdsInstalled = await areCRDsInstalled();
  if (!crdsInstalled) {
    console.log(`Downloading CRDs from NGC (v${releaseVersion})...`);
    await $`helm fetch ${NGC_HELM_REPO}/dynamo-crds-${releaseVersion}.tgz`;
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
    NGC_SECRET_ENABLED: !!ngcApiKey,
    // Storage class for etcd/nats persistence
    STORAGE_CLASS: isK8s 
      ? (config?.platform?.k8s?.storageClass || "local-path")
      : (config?.platform?.eks?.storageClass || "efs"),
  };
  
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  
  // Step 3: Install Platform from NGC
  console.log("\n[3/3] Installing Dynamo Platform from NGC...");
  console.log(`  Version: ${releaseVersion}`);
  console.log(`  Grove: ${enableGrove}`);
  console.log(`  KAI Scheduler: ${enableKaiScheduler}`);
  
  await $`helm fetch ${NGC_HELM_REPO}/dynamo-platform-${releaseVersion}.tgz`;
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
  
  // Clean up leftover webhook jobs (not deleted by helm uninstall)
  console.log("Cleaning up leftover resources...");
  await $`kubectl delete jobs -n ${namespace} -l app.kubernetes.io/instance=dynamo-platform --ignore-not-found`.quiet();
  
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
