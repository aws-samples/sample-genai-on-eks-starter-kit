#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Kong";
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
  const requiredEnvVars = ["LITELLM_API_KEY", "LITELLM_UI_USERNAME", "LITELLM_UI_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);
  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const { DOMAIN } = process.env;
  const valuesVars = {
    DOMAIN,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm repo add kong https://charts.konghq.com`;
  await $`helm upgrade --install kong kong/kong --namespace kong --create-namespace -f ${valuesRenderedPath}`;
}

export async function uninstall() {
  await $`helm uninstall kong --namespace kong`;
}
