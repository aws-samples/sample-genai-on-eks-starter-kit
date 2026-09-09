#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import { $ } from "zx";
$.verbose = true;

export const name = "Neuron Monitor (Inferentia / Trainium telemetry)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "neuron-monitor";
const MANIFEST = path.join(DIR, "neuron-monitor.yaml");

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  console.log("\n========================================");
  console.log("Installing Neuron Monitor (DaemonSet on Neuron nodes)");
  console.log("========================================\n");
  console.log("  Exposes NeuronCore utilisation, device memory and execution latency");
  console.log("  as Prometheus metrics; scraped by kube-prometheus-stack via PodMonitor.");

  // The DaemonSet only lands on nodes carrying a Neuron accelerator label, so
  // applying it on a cluster without inf/trn nodes is a no-op until one joins.
  // kubectl applies every document it can; a missing PodMonitor CRD (monitoring
  // component not installed) only fails that one object.
  await $`kubectl apply -f ${MANIFEST}`.catch(() =>
    console.log("  (PodMonitor CRD not present — exporter installed without scrape config)"),
  );

  await $`kubectl rollout status daemonset/neuron-monitor -n ${NAMESPACE} --timeout=120s`.catch(() =>
    console.log("  (no Neuron nodes are Ready yet — the DaemonSet schedules when one joins)"),
  );

  console.log("\n✅ Neuron Monitor installed.");
  console.log("   Verify: kubectl -n neuron-monitor get pods -o wide");
  console.log("   Prometheus: neuroncore_utilization_ratio, neuron_runtime_memory_used_bytes, execution_latency_seconds");
}

export async function uninstall() {
  await $`kubectl delete -f ${MANIFEST} --ignore-not-found`;
}
