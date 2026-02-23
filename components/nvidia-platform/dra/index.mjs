#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import inquirer from "inquirer";
import { $ } from "zx";
$.verbose = true;

export const name = "DRA (Dynamic Resource Allocation)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const DRA_NAMESPACE = "nvidia-dra-driver-gpu";
const DRA_VERSION = "25.12.0";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

async function isDRAInstalled() {
  try {
    const result = await $`helm list -n ${DRA_NAMESPACE} -q`.quiet();
    return result.stdout.trim().includes("nvidia-dra-driver-gpu");
  } catch {
    return false;
  }
}

async function isDevicePluginEnabled() {
  try {
    const result = await $`kubectl get daemonset -n gpu-operator nvidia-device-plugin-daemonset --no-headers`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function install() {
  console.log("\n========================================");
  console.log("Installing DRA (Dynamic Resource Allocation)");
  console.log("========================================\n");
  
  // Prerequisites check
  console.log("Checking prerequisites...");
  
  // K8s version
  try {
    const ver = await $`kubectl version -o json`.quiet();
    const serverVer = JSON.parse(ver.stdout).serverVersion;
    const minor = parseInt(serverVer.minor);
    console.log(`  K8s version: ${serverVer.major}.${serverVer.minor} ${minor >= 33 ? "✅" : "⚠️  DRA requires 1.33+ (1.34+ recommended)"}`);
  } catch {
    console.log("  K8s version: unable to determine");
  }
  
  // GPU Operator
  try {
    await $`helm list -n gpu-operator -q`.quiet();
    console.log("  GPU Operator: ✅ installed");
  } catch {
    console.log("  GPU Operator: ⚠️  not found. Install GPU Operator first.");
    return;
  }
  
  // Check if already installed
  const alreadyInstalled = await isDRAInstalled();
  if (alreadyInstalled) {
    console.log("\nDRA Driver is already installed.");
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
      await printStatus();
      return;
    }
  }
  
  // Check device plugin status
  const devicePluginEnabled = await isDevicePluginEnabled();
  if (devicePluginEnabled) {
    console.log("\n⚠️  NVIDIA Device Plugin is currently enabled.");
    console.log("   DRA replaces the device plugin for GPU allocation.");
    console.log("   The device plugin will be disabled via GPU Operator upgrade.\n");
    
    const { proceed } = await inquirer.prompt([{
      type: "confirm",
      name: "proceed",
      message: "Disable Device Plugin and enable DRA?",
      default: true,
    }]);
    
    if (!proceed) {
      console.log("Aborted.");
      return;
    }
    
    // Disable device plugin via GPU Operator
    console.log("\n[1/3] Disabling Device Plugin in GPU Operator...");
    await $`helm upgrade gpu-operator nvidia/gpu-operator \
      --namespace gpu-operator \
      --reuse-values \
      --set devicePlugin.enabled=false \
      --set 'driver.manager.env[0].name=NODE_LABEL_FOR_GPU_POD_EVICTION' \
      --set 'driver.manager.env[0].value=nvidia.com/dra-kubelet-plugin' \
      --wait --timeout 10m`;
    console.log("  ✅ Device Plugin disabled.");
  } else {
    console.log("\n[1/3] Device Plugin already disabled. ✅");
  }
  
  // Label nodes for DRA
  console.log("\n[2/3] Labeling nodes for DRA...");
  try {
    const nodes = await $`kubectl get nodes -o name`.quiet();
    for (const node of nodes.stdout.trim().split("\n").filter(Boolean)) {
      await $`kubectl label ${node} nvidia.com/dra-kubelet-plugin=true --overwrite`.quiet();
    }
    console.log("  ✅ Nodes labeled.");
  } catch (e) {
    console.log("  ⚠️  Node labeling failed:", e.message);
  }
  
  // Install DRA Driver
  console.log("\n[3/3] Installing DRA Driver for GPUs...");
  await $`helm repo add nvidia https://helm.ngc.nvidia.com/nvidia --force-update`;
  await $`helm repo update`;
  
  await $`helm upgrade --install nvidia-dra-driver-gpu nvidia/nvidia-dra-driver-gpu \
    --version="${DRA_VERSION}" \
    --namespace ${DRA_NAMESPACE} \
    --create-namespace \
    --set nvidiaDriverRoot=/ \
    --set gpuResourcesEnabledOverride=true \
    --set-string 'kubeletPlugin.nodeSelector.nvidia\\.com/dra-kubelet-plugin=true' \
    --wait --timeout 5m`;
  
  console.log("\n✅ DRA Driver installed successfully!");
  await printStatus();
  
  console.log("\n========================================");
  console.log("Next Steps");
  console.log("========================================");
  console.log("1. Deploy a model using DRA:");
  console.log("   ./cli nvidia-platform dra-dynamo-vllm install");
  console.log("\n2. Verify GPU allocation:");
  console.log("   kubectl get resourceslice");
}

async function printStatus() {
  console.log("\n========================================");
  console.log("DRA Status");
  console.log("========================================\n");
  
  console.log("DRA Driver Pods:");
  try {
    await $`kubectl get pods -n ${DRA_NAMESPACE}`;
  } catch {
    console.log("  (Not installed)");
  }
  
  console.log("\nDeviceClasses:");
  try {
    await $`kubectl get deviceclass`;
  } catch {
    console.log("  (No DeviceClasses found)");
  }
  
  console.log("\nResourceSlices:");
  try {
    await $`kubectl get resourceslice --no-headers`;
  } catch {
    console.log("  (No ResourceSlices found)");
  }
}

export async function uninstall() {
  console.log("\nUninstalling DRA...");
  
  // Uninstall DRA Driver
  try {
    await $`helm uninstall nvidia-dra-driver-gpu --namespace ${DRA_NAMESPACE}`;
    console.log("DRA Driver uninstalled.");
  } catch {
    console.log("DRA Driver not found or already removed.");
  }
  
  // Re-enable device plugin
  const { reEnableDP } = await inquirer.prompt([{
    type: "confirm",
    name: "reEnableDP",
    message: "Re-enable NVIDIA Device Plugin in GPU Operator?",
    default: true,
  }]);
  
  if (reEnableDP) {
    try {
      await $`helm upgrade gpu-operator nvidia/gpu-operator \
        --namespace gpu-operator \
        --reuse-values \
        --set devicePlugin.enabled=true \
        --wait --timeout 10m`;
      console.log("✅ Device Plugin re-enabled.");
    } catch (e) {
      console.log("⚠️  Failed to re-enable device plugin:", e.message);
    }
  }
  
  // Clean up namespace
  await $`kubectl delete namespace ${DRA_NAMESPACE} --ignore-not-found`;
  
  // Remove node labels
  try {
    const nodes = await $`kubectl get nodes -o name`.quiet();
    for (const node of nodes.stdout.trim().split("\n").filter(Boolean)) {
      await $`kubectl label ${node} nvidia.com/dra-kubelet-plugin- --overwrite`.quiet();
    }
  } catch {
    // ignore
  }
  
  console.log("DRA uninstalled.");
}
