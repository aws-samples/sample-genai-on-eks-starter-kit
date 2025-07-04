#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Ollama";
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
  const requiredEnvVars = ["DOMAIN"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await $`kubectl apply -f ${path.join(DIR, "namespace.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "pvc.yaml")}`;
  const configmapTemplatePath = path.join(DIR, "configmap.template.yaml");
  const configmapRenderedPath = path.join(DIR, "configmap.rendered.yaml");
  const configmapTemplateString = fs.readFileSync(configmapTemplatePath, "utf8");
  const configmapTemplate = handlebars.compile(configmapTemplateString);
  const { models } = config["llm-model"]["ollama"];
  const configmapVars = {
    models: models.map((model) => `"${model}"`).join(" "),
  };
  fs.writeFileSync(configmapRenderedPath, configmapTemplate(configmapVars));
  await $`kubectl apply -f ${configmapRenderedPath}`;
  await $`kubectl apply -f ${path.join(DIR, "deployment.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "service.yaml")}`;
  const ingressTemplatePath = path.join(DIR, "ingress.template.yaml");
  const ingressRenderedPath = path.join(DIR, "ingress.rendered.yaml");
  const ingressTemplateString = fs.readFileSync(ingressTemplatePath, "utf8");
  const ingressTemplate = handlebars.compile(ingressTemplateString);
  const ingressVars = {
    DOMAIN: process.env.DOMAIN,
  };
  fs.writeFileSync(ingressRenderedPath, ingressTemplate(ingressVars));
  await $`kubectl apply -f ${ingressRenderedPath}`;
}

export async function uninstall() {
  await $`kubectl delete -f ${path.join(DIR, "ingress.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "service.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "deployment.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "configmap.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "namespace.yaml")} --ignore-not-found`;
}
