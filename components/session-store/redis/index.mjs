#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Redis";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const NAMESPACE = "redis";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  const requiredEnvVars = ["REDIS_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await $`helm repo add bitnami https://charts.bitnami.com/bitnami --force-update`;
  await $`helm repo update bitnami`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm upgrade --install redis bitnami/redis --namespace ${NAMESPACE} --create-namespace -f ${valuesRenderedPath} --wait --timeout 5m`;

  console.log("Redis installed successfully!");
  console.log(`Redis endpoint: redis-master.${NAMESPACE}:6379`);
}

export async function uninstall() {
  try {
    await $`helm uninstall redis --namespace ${NAMESPACE}`;
    console.log("Redis uninstalled.");
  } catch {
    console.log("Redis not found or already removed.");
  }
  try {
    await $`kubectl delete namespace ${NAMESPACE} --ignore-not-found`;
  } catch {
    // ignore
  }
}
