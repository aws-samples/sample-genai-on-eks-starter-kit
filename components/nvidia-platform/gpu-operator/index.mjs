#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import inquirer from "inquirer";
import { $ } from "zx";
$.verbose = true;

export const name = "NVIDIA GPU Operator";
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

// Check if GPU Operator is already installed
async function isGpuOperatorInstalled() {
  try {
    const result = await $`helm list -n gpu-operator -q`.quiet();
    return result.stdout.trim().includes("gpu-operator");
  } catch {
    return false;
  }
}

// Check if Prometheus is installed (for ServiceMonitor)
async function isPrometheusInstalled() {
  try {
    // Check for prometheus-operator or kube-prometheus-stack
    const result = await $`kubectl get crd servicemonitors.monitoring.coreos.com`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function install() {
  const isK8s = utils.isK8sMode();
  
  // K8s mode: Skip installation (assume GPU Operator is pre-installed)
  if (isK8s) {
    console.log("K8s mode: GPU Operator is assumed to be pre-installed.");
    console.log("Skipping installation. Checking status...\n");
    
    const alreadyInstalled = await isGpuOperatorInstalled();
    if (alreadyInstalled) {
      await printStatus();
    } else {
      console.log("⚠️  GPU Operator not found. Please install it manually:");
      console.log("   helm repo add nvidia https://helm.ngc.nvidia.com/nvidia");
      console.log("   helm install gpu-operator nvidia/gpu-operator -n gpu-operator --create-namespace");
    }
    return;
  }
  
  // EKS mode: Install/Upgrade GPU Operator
  const alreadyInstalled = await isGpuOperatorInstalled();
  if (alreadyInstalled) {
    console.log("GPU Operator is already installed.");
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
      console.log("Skipping GPU Operator installation.");
      await printStatus();
      return;
    }
  }
  
  // Check Prometheus for monitoring
  const prometheusInstalled = await isPrometheusInstalled();
  if (!prometheusInstalled) {
    console.log("\n⚠️  Prometheus ServiceMonitor CRD not found.");
    console.log("   DCGM Exporter metrics will still be exposed, but ServiceMonitor won't work.");
    console.log("\n   For EKS, you have two options:\n");
    console.log("   Option 1: Amazon Managed Prometheus (AMP)");
    console.log("   - Create AMP workspace in AWS Console");
    console.log("   - Install ADOT Collector with GPU metrics scraping");
    console.log("   - See: https://docs.aws.amazon.com/prometheus/latest/userguide/\n");
    console.log("   Option 2: Self-managed Prometheus");
    console.log("   helm repo add prometheus-community https://prometheus-community.github.io/helm-charts");
    console.log("   helm install prometheus prometheus-community/kube-prometheus-stack -n monitoring --create-namespace\n");
  }
  
  // EKS-specific info
  console.log("\n📋 EKS Environment Detected");
  const eksMode = process.env.EKS_MODE || "auto";
  console.log(`   EKS Mode: ${eksMode}`);
  
  if (eksMode === "auto") {
    console.log("   ℹ️  EKS Auto Mode: Driver, Toolkit, Device Plugin are pre-installed");
    console.log("      GPU Operator will only add: GFD, DCGM Exporter, GDS");
  } else {
    console.log("   ℹ️  EKS Standard Mode (Karpenter): Check if GPU AMI includes NVIDIA stack");
  }
  
  // Add NVIDIA Helm repo
  await $`helm repo add nvidia https://helm.ngc.nvidia.com/nvidia --force-update`;
  await $`helm repo update`;

  // Create namespace
  await $`kubectl apply -f ${path.join(DIR, "namespace.yaml")}`;

  // Render values template
  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  
  // Get EKS config
  const platformConfig = config?.platform?.eks?.gpuOperator || {};
  
  const valuesVars = {
    // Driver: disabled on EKS (pre-installed by AMI/Auto Mode)
    DRIVER_ENABLED: platformConfig.driverEnabled ?? false,
    // Toolkit: disabled on EKS Auto (pre-installed)
    TOOLKIT_ENABLED: platformConfig.toolkitEnabled ?? false,
    // Device Plugin
    DEVICE_PLUGIN_ENABLED: platformConfig.devicePluginEnabled ?? false,
    // GFD: always enabled for detailed GPU labeling
    GFD_ENABLED: platformConfig.gfdEnabled ?? true,
    // DCGM Exporter: enabled for GPU monitoring (works without Prometheus too)
    DCGM_EXPORTER_ENABLED: platformConfig.dcgmExporterEnabled ?? true,
    // ServiceMonitor: only if Prometheus is installed
    SERVICE_MONITOR_ENABLED: prometheusInstalled,
    // GDS: enabled for Dynamo NIXL support
    GDS_ENABLED: platformConfig.gdsEnabled ?? true,
    // NFD: disabled on EKS (use existing labels), enabled on K8s
    NFD_ENABLED: platformConfig.nfdEnabled ?? isK8s,
    // MIG Manager: optional, disabled by default
    MIG_MANAGER_ENABLED: platformConfig.migManagerEnabled ?? false,
  };
  
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));

  console.log("\nInstalling GPU Operator with config:");
  console.log(`  Platform: ${isK8s ? "K8s" : "EKS"}`);
  console.log(`  Driver: ${valuesVars.DRIVER_ENABLED}`);
  console.log(`  Toolkit: ${valuesVars.TOOLKIT_ENABLED}`);
  console.log(`  Device Plugin: ${valuesVars.DEVICE_PLUGIN_ENABLED}`);
  console.log(`  GFD: ${valuesVars.GFD_ENABLED}`);
  console.log(`  DCGM Exporter: ${valuesVars.DCGM_EXPORTER_ENABLED}`);
  console.log(`  ServiceMonitor: ${valuesVars.SERVICE_MONITOR_ENABLED}`);
  console.log(`  GDS: ${valuesVars.GDS_ENABLED}`);
  console.log(`  NFD: ${valuesVars.NFD_ENABLED}`);
  console.log("");

  // Install/Upgrade GPU Operator
  await $`helm upgrade --install gpu-operator nvidia/gpu-operator \
    --namespace gpu-operator \
    -f ${valuesRenderedPath} \
    --wait --timeout 10m`;
  
  console.log("\n✅ GPU Operator installed successfully!");
  
  // Wait for operator to be ready
  console.log("Waiting for GPU Operator pods to be ready...");
  try {
    await $`kubectl wait --for=condition=ready pod -l app=gpu-operator -n gpu-operator --timeout=300s`;
  } catch (e) {
    console.log("Note: GPU Operator pods may still be initializing.");
  }
  
  await printStatus();
}

async function printStatus() {
  console.log("\n========================================");
  console.log("GPU Operator Status");
  console.log("========================================\n");
  
  // Show pods
  console.log("Pods:");
  try {
    await $`kubectl get pods -n gpu-operator`;
  } catch {
    console.log("  (No pods found or namespace doesn't exist)");
  }
  
  // Show GPU nodes
  console.log("\nGPU Nodes:");
  try {
    await $`kubectl get nodes -L nvidia.com/gpu.present,nvidia.com/gpu.product`;
  } catch {
    console.log("  (GPU labels may take a moment to appear)");
  }
  
  // Show monitoring endpoint
  console.log("\nMonitoring:");
  console.log("  DCGM Exporter metrics: kubectl port-forward -n gpu-operator svc/gpu-operator-dcgm-exporter 9400:9400");
  console.log("  Then access: http://localhost:9400/metrics");
  
  // Useful commands
  console.log("\nUseful Commands:");
  console.log("  kubectl describe nodes | grep -A5 'nvidia.com'  # Check GPU resources");
  console.log("  kubectl logs -n gpu-operator -l app=gpu-feature-discovery  # GFD logs");
  console.log("  kubectl logs -n gpu-operator -l app=nvidia-dcgm-exporter  # DCGM logs");
}

export async function uninstall() {
  try {
    await $`helm uninstall gpu-operator --namespace gpu-operator`;
  } catch (e) {
    console.log("GPU Operator helm release not found or already removed");
  }
  
  // Clean up CRDs (optional, uncomment if needed)
  // await $`kubectl delete crd clusterpolicies.nvidia.com --ignore-not-found`;
  
  await $`kubectl delete -f ${path.join(DIR, "namespace.yaml")} --ignore-not-found`;
}
