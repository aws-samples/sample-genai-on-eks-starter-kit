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
  const requiredEnvVars = [
    "LANGFUSE_USERNAME",
    "LANGFUSE_PASSWORD",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    // Cryptographic secrets -- no defaults are shipped, so a deployment fails
    // closed rather than reusing values published in this repo.
    "LANGFUSE_SALT",
    "LANGFUSE_NEXTAUTH_SECRET",
    "LANGFUSE_ENCRYPTION_KEY",
    // Backing datastores (PostgreSQL / ClickHouse / Valkey). Previously the
    // literal "password123" in values.template.yaml, shared by every deployment.
    "LANGFUSE_POSTGRES_PASSWORD",
    "LANGFUSE_CLICKHOUSE_PASSWORD",
    "LANGFUSE_REDIS_PASSWORD",
  ];
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
    LANGFUSE_SALT: process.env.LANGFUSE_SALT,
    LANGFUSE_NEXTAUTH_SECRET: process.env.LANGFUSE_NEXTAUTH_SECRET,
    LANGFUSE_ENCRYPTION_KEY: process.env.LANGFUSE_ENCRYPTION_KEY,
    LANGFUSE_POSTGRES_PASSWORD: process.env.LANGFUSE_POSTGRES_PASSWORD,
    LANGFUSE_CLICKHOUSE_PASSWORD: process.env.LANGFUSE_CLICKHOUSE_PASSWORD,
    LANGFUSE_REDIS_PASSWORD: process.env.LANGFUSE_REDIS_PASSWORD,
    LANGFUSE_BUCKET_NAME: langfuseBucketName,
    AWS_REGION: process.env.AWS_REGION,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm upgrade --install langfuse langfuse/langfuse --namespace langfuse --create-namespace -f ${valuesRenderedPath}`;
}

export async function uninstall() {
  await $`helm uninstall langfuse --namespace langfuse`;
  await utils.terraform.destroy(DIR);
}
