#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import inquirer from "inquirer";
import { $ } from "zx";
$.verbose = true;

export const name = "Monitoring (Prometheus + Grafana)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const MONITORING_NAMESPACE = "monitoring";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

// Check if kube-prometheus-stack is already installed
async function isPrometheusInstalled() {
  try {
    const result = await $`helm list -n ${MONITORING_NAMESPACE} -q`.quiet();
    return result.stdout.trim().includes("prometheus");
  } catch {
    return false;
  }
}

// Check if Ingress controller is available
async function detectIngressClass() {
  try {
    const result = await $`kubectl get ingressclass -o jsonpath='{.items[0].metadata.name}'`.quiet();
    return result.stdout.trim().replace(/'/g, "") || "";
  } catch {
    return "";
  }
}

// Check if Prometheus CRDs exist
async function hasPrometheusCRDs() {
  try {
    const result = await $`kubectl get crd servicemonitors.monitoring.coreos.com`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Get Prometheus service endpoint
function getPrometheusEndpoint() {
  return `http://prometheus-kube-prometheus-prometheus.${MONITORING_NAMESPACE}.svc.cluster.local:9090`;
}

export async function install() {
  const isK8s = utils.isK8sMode();
  const monitoringConfig = config?.platform?.monitoring || {};
  
  console.log("\n========================================");
  console.log("Installing Monitoring Stack");
  console.log("(kube-prometheus-stack + Dynamo Dashboard)");
  console.log("========================================\n");
  console.log(`Platform: ${isK8s ? "K8s" : "EKS"}`);
  
  // Check if already installed
  const alreadyInstalled = await isPrometheusInstalled();
  if (alreadyInstalled) {
    console.log("\nkube-prometheus-stack is already installed.");
    const { action } = await inquirer.prompt([{
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Upgrade with current config", value: "upgrade" },
        { name: "Apply Dynamo dashboard only", value: "dashboard" },
        { name: "Skip (keep existing)", value: "skip" },
      ],
    }]);
    
    if (action === "skip") {
      console.log("Skipping monitoring installation.");
      await printStatus();
      return;
    }
    
    if (action === "dashboard") {
      await applyGrafanaDashboards();
      await printStatus();
      return;
    }
  }
  
  // Use defaults from config.json (no interactive prompts)
  const grafanaPassword = monitoringConfig.grafanaAdminPassword || "admin";
  const retention = monitoringConfig.retention || "7d";
  const enablePersistentStorage = monitoringConfig.enablePersistentStorage ?? false;
  const storageSize = monitoringConfig.prometheusStorageSize || "50Gi";
  const alertmanagerEnabled = monitoringConfig.alertmanagerEnabled ?? false;
  
  // Auto-detect Ingress controller
  let enableIngress = false;
  let ingressClass = "";
  let ingressHost = "";
  
  const detectedIngressClass = await detectIngressClass();
  if (detectedIngressClass) {
    enableIngress = true;
    ingressClass = detectedIngressClass;
    console.log(`✅ Ingress controller detected: ${detectedIngressClass} → Ingress enabled`);
  } else {
    console.log("⚠️  No Ingress controller found. Use port-forward to access Grafana/Prometheus.");
  }
  
  // Determine storage class
  const storageClass = isK8s 
    ? (config?.platform?.k8s?.storageClass || "local-path")
    : (config?.platform?.eks?.storageClass || "efs");
  
  // Step 1: Add Helm repo
  console.log("\n[1/4] Adding prometheus-community Helm repo...");
  await $`helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update`;
  await $`helm repo update`;
  
  // Step 2: Render values template
  console.log("\n[2/4] Preparing values...");
  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  
  const valuesVars = {
    IS_K8S: isK8s,
    IS_EKS: !isK8s,
    RETENTION: retention,
    ENABLE_PERSISTENT_STORAGE: enablePersistentStorage,
    STORAGE_CLASS: storageClass,
    PROMETHEUS_STORAGE_SIZE: storageSize,
    GRAFANA_ADMIN_PASSWORD: grafanaPassword,
    ALERTMANAGER_ENABLED: alertmanagerEnabled,
    ENABLE_INGRESS: enableIngress,
    INGRESS_CLASS: ingressClass,
    INGRESS_HOST: ingressHost,
  };
  
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  
  // Step 3: Install/Upgrade kube-prometheus-stack
  console.log("\n[3/4] Installing kube-prometheus-stack...");
  console.log(`  Namespace: ${MONITORING_NAMESPACE}`);
  console.log(`  Grafana password: ${grafanaPassword}`);
  console.log(`  Retention: ${retention}`);
  console.log(`  Alertmanager: ${alertmanagerEnabled}`);
  console.log(`  Ingress: ${enableIngress ? ingressClass : "disabled"}`);
  
  await $`helm upgrade --install prometheus \
    prometheus-community/kube-prometheus-stack \
    --namespace ${MONITORING_NAMESPACE} \
    --create-namespace \
    -f ${valuesRenderedPath} \
    --wait --timeout 10m`;
  
  console.log("\n✅ kube-prometheus-stack installed successfully!");
  
  // Step 3.5: Install Pushgateway (for benchmark metrics)
  console.log("\n[3.5/4] Installing Prometheus Pushgateway...");
  try {
    const pgwInstalled = await $`helm list -n ${MONITORING_NAMESPACE} -q`.quiet();
    if (pgwInstalled.stdout.includes("pushgateway")) {
      console.log("  Pushgateway already installed, upgrading...");
    }
    await $`helm upgrade --install pushgateway \
      prometheus-community/prometheus-pushgateway \
      --namespace ${MONITORING_NAMESPACE} \
      --set serviceMonitor.enabled=true \
      --set serviceMonitor.additionalLabels.release=prometheus \
      --wait --timeout 3m`.quiet();
    console.log("  ✅ Pushgateway installed");
  } catch (e) {
    console.log(`  ⚠️  Pushgateway install failed: ${e.message}`);
    console.log("  Benchmark dashboard metrics push will not work.");
  }
  
  // Step 4: Apply Grafana dashboards (Dynamo, DCGM, KVBM)
  console.log("\n[4/4] Applying Grafana dashboards...");
  await applyGrafanaDashboards();
  
  await printStatus();
  
  // Next steps
  console.log("\n========================================");
  console.log("Next Steps");
  console.log("========================================");
  console.log("1. When installing Dynamo Platform, monitoring will be auto-detected");
  console.log("   and --set prometheusEndpoint will be configured automatically.");
  console.log("");
  
  if (enableIngress) {
    console.log("2. Access (via Ingress):");
    console.log(`   Grafana:    http://<node-ip>:<node-port>/grafana`);
    console.log(`   Prometheus: http://<node-ip>:<node-port>/prometheus`);
    console.log(`   User: admin / Password: ${grafanaPassword}`);
  } else {
    console.log("2. Access (port-forward):");
    console.log(`   kubectl port-forward svc/prometheus-grafana 3000:80 -n ${MONITORING_NAMESPACE} --address 0.0.0.0`);
    console.log(`   User: admin / Password: ${grafanaPassword}`);
  }
}

// Apply all Grafana dashboard ConfigMaps
async function applyGrafanaDashboards() {
  const dashboards = [
    { file: "dynamo-dashboard.json", name: "grafana-dynamo-dashboard", label: "Dynamo Dashboard" },
    { file: "dcgm-metrics.json", name: "grafana-dcgm-dashboard", label: "DCGM GPU Monitoring" },
    { file: "kvbm.json", name: "grafana-kvbm-dashboard", label: "KVBM KV Cache" },
    { file: "benchmark-dashboard.json", name: "grafana-benchmark-dashboard", label: "Benchmark Pareto" },
  ];
  
  for (const dashboard of dashboards) {
    const jsonPath = path.join(DIR, "dashboards", dashboard.file);
    if (!fs.existsSync(jsonPath)) {
      console.log(`  ⚠️  ${dashboard.file} not found, skipping.`);
      continue;
    }
    
    const dashboardJson = fs.readFileSync(jsonPath, "utf8");
    const indentedJson = dashboardJson
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    
    const configMap = `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${dashboard.name}
  namespace: ${MONITORING_NAMESPACE}
  labels:
    grafana_dashboard: "1"
data:
  ${dashboard.file}: |-
${indentedJson}`;
    
    const renderedPath = path.join(DIR, "dashboards", `${dashboard.name}.rendered.yaml`);
    fs.writeFileSync(renderedPath, configMap);
    
    await $`kubectl apply -f ${renderedPath}`;
    fs.unlinkSync(renderedPath);
    console.log(`  ✅ ${dashboard.label}`);
  }
}

async function printStatus() {
  console.log("\n========================================");
  console.log("Monitoring Stack Status");
  console.log("========================================\n");
  
  console.log("Pods:");
  try {
    await $`kubectl get pods -n ${MONITORING_NAMESPACE}`;
  } catch {
    console.log("  (No pods found or namespace doesn't exist)");
  }
  
  console.log("\nServices:");
  try {
    await $`kubectl get svc -n ${MONITORING_NAMESPACE}`;
  } catch {
    console.log("  (No services found)");
  }
  
  console.log("\nPrometheus Endpoint (for Dynamo Platform):");
  console.log(`  ${getPrometheusEndpoint()}`);
  
  // Check if Ingress exists
  console.log("\nIngress:");
  try {
    const ingResult = await $`kubectl get ingress -n ${MONITORING_NAMESPACE} -o wide --no-headers`.quiet();
    if (ingResult.stdout.trim()) {
      console.log(ingResult.stdout.trim());
    } else {
      console.log("  (No Ingress configured)");
    }
  } catch {
    console.log("  (No Ingress configured)");
  }
  
  console.log("\nAccess (port-forward fallback):");
  console.log(`  Grafana:    kubectl port-forward svc/prometheus-grafana 3000:80 -n ${MONITORING_NAMESPACE} --address 0.0.0.0`);
  console.log(`  Prometheus: kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090 -n ${MONITORING_NAMESPACE} --address 0.0.0.0`);
}

export async function uninstall() {
  console.log("\nUninstalling Monitoring Stack...");
  
  // Remove dashboard ConfigMaps
  try {
    const dashboardCMs = ["grafana-dynamo-dashboard", "grafana-dcgm-dashboard", "grafana-kvbm-dashboard", "grafana-benchmark-dashboard"];
    for (const cm of dashboardCMs) {
      await $`kubectl delete configmap ${cm} -n ${MONITORING_NAMESPACE} --ignore-not-found`.quiet();
    }
    console.log("Dashboard ConfigMaps removed.");
  } catch {
    // ignore
  }
  
  // Uninstall kube-prometheus-stack
  try {
    await $`helm uninstall prometheus --namespace ${MONITORING_NAMESPACE}`;
    console.log("kube-prometheus-stack uninstalled.");
  } catch (e) {
    console.log("kube-prometheus-stack helm release not found or already removed.");
  }
  
  // Ask about CRDs
  const { deleteCRDs } = await inquirer.prompt([{
    type: "confirm",
    name: "deleteCRDs",
    message: "Also delete Prometheus Operator CRDs? (ServiceMonitor, PodMonitor, etc.)",
    default: false,
  }]);
  
  if (deleteCRDs) {
    console.log("Deleting Prometheus Operator CRDs...");
    const crds = [
      "alertmanagerconfigs.monitoring.coreos.com",
      "alertmanagers.monitoring.coreos.com",
      "podmonitors.monitoring.coreos.com",
      "probes.monitoring.coreos.com",
      "prometheusagents.monitoring.coreos.com",
      "prometheuses.monitoring.coreos.com",
      "prometheusrules.monitoring.coreos.com",
      "scrapeconfigs.monitoring.coreos.com",
      "servicemonitors.monitoring.coreos.com",
      "thanosrulers.monitoring.coreos.com",
    ];
    for (const crd of crds) {
      await $`kubectl delete crd ${crd} --ignore-not-found`.quiet();
    }
    console.log("Prometheus CRDs deleted.");
  }
  
  // Ask about namespace
  const { deleteNamespace } = await inquirer.prompt([{
    type: "confirm",
    name: "deleteNamespace",
    message: `Delete namespace '${MONITORING_NAMESPACE}'?`,
    default: false,
  }]);
  
  if (deleteNamespace) {
    await $`kubectl delete namespace ${MONITORING_NAMESPACE} --ignore-not-found`;
  }
  
  console.log("Monitoring stack uninstalled.");
}

// Export for use by dynamo-platform installer
export { getPrometheusEndpoint, MONITORING_NAMESPACE, hasPrometheusCRDs };
