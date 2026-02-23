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
  
  // Configuration prompts
  const defaults = {
    grafanaPassword: monitoringConfig.grafanaAdminPassword || "admin",
    retention: monitoringConfig.retention || "7d",
    enablePersistentStorage: monitoringConfig.enablePersistentStorage ?? false,
    prometheusStorageSize: monitoringConfig.prometheusStorageSize || "50Gi",
    alertmanagerEnabled: monitoringConfig.alertmanagerEnabled ?? false,
  };
  
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "grafanaPassword",
      message: "Grafana admin password:",
      default: defaults.grafanaPassword,
      validate: (input) => input.length > 0 ? true : "Password cannot be empty",
    },
    {
      type: "input",
      name: "retention",
      message: "Prometheus data retention period:",
      default: defaults.retention,
    },
    {
      type: "confirm",
      name: "enablePersistentStorage",
      message: "Enable persistent storage for Prometheus?",
      default: defaults.enablePersistentStorage,
    },
    {
      type: "confirm",
      name: "alertmanagerEnabled",
      message: "Enable Alertmanager?",
      default: defaults.alertmanagerEnabled,
    },
  ]);
  
  let storageSize = defaults.prometheusStorageSize;
  if (answers.enablePersistentStorage) {
    const { inputStorageSize } = await inquirer.prompt([{
      type: "input",
      name: "inputStorageSize",
      message: "Prometheus storage size:",
      default: storageSize,
    }]);
    storageSize = inputStorageSize;
  }
  
  // Ingress configuration
  let enableIngress = false;
  let ingressClass = "";
  let ingressHost = "";
  
  const detectedIngressClass = await detectIngressClass();
  if (detectedIngressClass) {
    console.log(`\n✅ Ingress controller detected: ${detectedIngressClass}`);
    const { wantIngress } = await inquirer.prompt([{
      type: "confirm",
      name: "wantIngress",
      message: "Enable Ingress for Grafana and Prometheus? (no port-forward needed)",
      default: true,
    }]);
    enableIngress = wantIngress;
    
    if (enableIngress) {
      const ingressAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "ingressClass",
          message: "Ingress class:",
          default: detectedIngressClass,
        },
        {
          type: "input",
          name: "ingressHost",
          message: "Ingress host (IP or domain, empty for any):",
          default: "",
        },
      ]);
      ingressClass = ingressAnswers.ingressClass;
      ingressHost = ingressAnswers.ingressHost;
    }
  } else {
    console.log("\n⚠️  No Ingress controller found. Skipping Ingress setup.");
    console.log("   You can use port-forward to access Grafana/Prometheus.");
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
    RETENTION: answers.retention,
    ENABLE_PERSISTENT_STORAGE: answers.enablePersistentStorage,
    STORAGE_CLASS: storageClass,
    PROMETHEUS_STORAGE_SIZE: storageSize,
    GRAFANA_ADMIN_PASSWORD: answers.grafanaPassword,
    ALERTMANAGER_ENABLED: answers.alertmanagerEnabled,
    ENABLE_INGRESS: enableIngress,
    INGRESS_CLASS: ingressClass,
    INGRESS_HOST: ingressHost,
  };
  
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  
  // Step 3: Install/Upgrade kube-prometheus-stack
  console.log("\n[3/4] Installing kube-prometheus-stack...");
  console.log(`  Namespace: ${MONITORING_NAMESPACE}`);
  console.log(`  Retention: ${answers.retention}`);
  console.log(`  Persistent Storage: ${answers.enablePersistentStorage}`);
  console.log(`  Alertmanager: ${answers.alertmanagerEnabled}`);
  console.log(`  Ingress: ${enableIngress ? `${ingressClass} (host: ${ingressHost || "*"})` : "disabled"}`);
  
  await $`helm upgrade --install prometheus \
    prometheus-community/kube-prometheus-stack \
    --namespace ${MONITORING_NAMESPACE} \
    --create-namespace \
    -f ${valuesRenderedPath} \
    --wait --timeout 10m`;
  
  console.log("\n✅ kube-prometheus-stack installed successfully!");
  
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
    const host = ingressHost || "<node-ip>";
    console.log("2. Access Grafana:");
    console.log(`   http://${host}/grafana`);
    console.log(`   User: admin / Password: ${answers.grafanaPassword}`);
    console.log("");
    console.log("3. Access Prometheus:");
    console.log(`   http://${host}/prometheus`);
  } else {
    console.log("2. Access Grafana:");
    console.log(`   kubectl port-forward svc/prometheus-grafana 3000:80 -n ${MONITORING_NAMESPACE} --address 0.0.0.0`);
    console.log(`   Open: http://localhost:3000`);
    console.log(`   User: admin / Password: ${answers.grafanaPassword}`);
    console.log("");
    console.log("3. Access Prometheus:");
    console.log(`   kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090 -n ${MONITORING_NAMESPACE} --address 0.0.0.0`);
    console.log(`   Open: http://localhost:9090`);
  }
}

// Apply all Grafana dashboard ConfigMaps
async function applyGrafanaDashboards() {
  const dashboards = [
    { file: "dynamo-dashboard.json", name: "grafana-dynamo-dashboard", label: "Dynamo Dashboard" },
    { file: "dcgm-metrics.json", name: "grafana-dcgm-dashboard", label: "DCGM GPU Monitoring" },
    { file: "kvbm.json", name: "grafana-kvbm-dashboard", label: "KVBM KV Cache" },
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
    const dashboardCMs = ["grafana-dynamo-dashboard", "grafana-dcgm-dashboard", "grafana-kvbm-dashboard"];
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
