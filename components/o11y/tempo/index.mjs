#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Tempo (distributed traces store)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "tempo";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  console.log("\n========================================");
  console.log("Installing Tempo (trace store + metrics-generator)");
  console.log("========================================\n");

  // Provision S3 bucket + Pod Identity for trace block storage.
  await utils.terraform.apply(DIR);
  const tfOutput = await utils.terraform.output(DIR, {});
  const tempoBucketName = tfOutput.tempo_bucket_name.value;

  await $`helm repo add grafana https://grafana.github.io/helm-charts --force-update`;
  await $`helm repo update`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    TEMPO_BUCKET_NAME: tempoBucketName,
    AWS_REGION: process.env.AWS_REGION,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));

  // Pin the chart version for reproducibility. tempo-distributed renames
  // metricsGenerator keys between majors (e.g. storage_remote_write →
  // storage.remote_write); re-validate the values schema before bumping.
  await $`helm upgrade --install tempo grafana/tempo-distributed --version 1.51.0 --namespace ${NAMESPACE} --create-namespace -f ${valuesRenderedPath}`;

  console.log("\n✅ Tempo installed.");
  console.log(`   S3 bucket: ${tempoBucketName}`);
  console.log("   OTLP receiver (for Beyla): tempo-distributor.tempo.svc.cluster.local:4318");
  console.log("   Add a Tempo datasource in Grafana pointing to");
  console.log("   http://tempo-query-frontend.tempo.svc.cluster.local:3100");
}

export async function uninstall() {
  await $`helm uninstall tempo --namespace ${NAMESPACE}`;
  await $`kubectl delete pvc --all -n ${NAMESPACE} --ignore-not-found`.catch(() => {});
  await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
  await utils.terraform.destroy(DIR);
}
