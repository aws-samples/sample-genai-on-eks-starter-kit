#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Beyla (eBPF auto-instrumentation)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "beyla";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  // Beyla exports OTEL traces to Tempo (for the unified service map / TTFT
  // drill-down) and RED metrics to the kube-prometheus-stack Prometheus via a
  // ServiceMonitor. Both destinations are in-cluster services, so no external
  // credentials are required.
  const beylaConfig = config?.o11y?.beyla || {};
  // OTLP traces receiver of the Tempo distributor (http, port 4318). Overridable
  // via config.json so a different trace backend can be targeted.
  const otelTracesEndpoint =
    beylaConfig.otelTracesEndpoint || "http://tempo-distributor.tempo.svc.cluster.local:4318";

  console.log("\n========================================");
  console.log("Installing Beyla (eBPF auto-instrumentation)");
  console.log("========================================\n");
  console.log(`  Traces export (OTLP): ${otelTracesEndpoint}`);

  await $`helm repo add grafana https://grafana.github.io/helm-charts --force-update`;
  await $`helm repo update`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    OTEL_TRACES_ENDPOINT: otelTracesEndpoint,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));

  // Pin the chart version for reproducibility. Bump deliberately after
  // re-validating the values schema (Beyla renames config keys between
  // releases). Chart 1.16.10 ships app v3.25.0, which uses the
  // `discovery.instrument` schema + OTEL semconv metric names this component's
  // values and the Grafana dashboard rely on. (Older charts pin app v1.9.0,
  // which only understands the legacy `discovery.services` key and rejects the
  // instrument config with "missing BEYLA_EXECUTABLE_NAME/BEYLA_OPEN_PORT".)
  await $`helm upgrade --install beyla grafana/beyla --version 1.16.10 --namespace ${NAMESPACE} --create-namespace -f ${valuesRenderedPath}`;

  console.log("\n✅ Beyla installed.");
  console.log("   Verify spans reach Tempo: Grafana → Explore → Tempo (search recent traces).");
}

export async function uninstall() {
  await $`helm uninstall beyla --namespace ${NAMESPACE}`;
  await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
}
