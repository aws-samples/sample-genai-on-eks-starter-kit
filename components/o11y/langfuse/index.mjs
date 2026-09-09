#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Langfuse";
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

export async function install() {
  const requiredEnvVars = ["LANGFUSE_USERNAME", "LANGFUSE_PASSWORD", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await utils.terraform.apply(DIR);
  const tfOutput = await utils.terraform.output(DIR, {});
  const langfuseBucketName = tfOutput.langfuse_bucket_name.value;

  await $`helm repo add langfuse https://langfuse.github.io/langfuse-k8s`;
  await $`helm repo update`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    DOMAIN: process.env.DOMAIN,
    LANGFUSE_USERNAME: process.env.LANGFUSE_USERNAME,
    LANGFUSE_PASSWORD: process.env.LANGFUSE_PASSWORD,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BUCKET_NAME: langfuseBucketName,
    AWS_REGION: process.env.AWS_REGION,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  // Pin the chart version for reproducibility. Chart 1.5.35 ships Langfuse
  // app v3.185.0 — the version the Module 4 evaluation hands-on (Evaluators /
  // LLM-as-a-Judge UI) is written and verified against. Bump deliberately when
  // re-validating the docs, since Langfuse moves the evaluation UI between
  // releases (e.g. the old "LLM-as-a-Judge" sidebar item is now "Evaluators").
  await $`helm upgrade --install langfuse langfuse/langfuse --version 1.5.35 --namespace langfuse --create-namespace -f ${valuesRenderedPath}`;
}

export async function uninstall() {
  await $`helm uninstall langfuse --namespace langfuse`;
  await utils.terraform.destroy(DIR);
}
