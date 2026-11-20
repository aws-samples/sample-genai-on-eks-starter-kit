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
  // KONG_POSTGRES_PASSWORD backs Kong's bundled PostgreSQL. It was the literal
  // "Pass@123" in values.template.yaml, shared by every deployment of this
  // public repo.
  const requiredEnvVars = ["KONG_API_KEY", "KONG_API_KEY_HEADER", "KONG_POSTGRES_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);
  const { DOMAIN, KONG_API_KEY, KONG_API_KEY_HEADER, KONG_POSTGRES_PASSWORD } = process.env;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesVars = {
    DOMAIN,
    KONG_POSTGRES_PASSWORD,
  };
  utils.renderTemplate(valuesTemplatePath, valuesRenderedPath, valuesVars);
  await $`helm repo add kong https://charts.konghq.com`;
  await $`helm upgrade --install kong kong/kong --namespace kong --create-namespace -f ${valuesRenderedPath}`;

  const kongTemplatePath = path.join(DIR, "kong.template.yaml");
  const kongRenderedPath = path.join(DIR, "kong.rendered.yaml");
  const kongVars = {
    DOMAIN,
    KONG_API_KEY,
    KONG_API_KEY_HEADER,
  };
  utils.renderTemplate(kongTemplatePath, kongRenderedPath, kongVars);
  await $`kubectl apply -f ${kongRenderedPath}`;
}

export async function uninstall() {
  const { DOMAIN, KONG_API_KEY, KONG_API_KEY_HEADER } = process.env;
  const kongTemplatePath = path.join(DIR, "kong.template.yaml");
  const kongRenderedPath = path.join(DIR, "kong.rendered.yaml");
  const kongVars = {
    DOMAIN,
    KONG_API_KEY,
    KONG_API_KEY_HEADER,
  };
  utils.renderTemplate(kongTemplatePath, kongRenderedPath, kongVars);
  await $`kubectl delete -f ${kongRenderedPath} --ignore-not-found`;
  await $`helm uninstall kong --namespace kong`;
}
