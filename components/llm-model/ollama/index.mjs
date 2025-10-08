#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
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
  // const requiredEnvVars = [];
  // utils.checkRequiredEnvVars(requiredEnvVars);
  await $`kubectl apply -f ${path.join(DIR, "namespace.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "pvc.yaml")}`;
  const configmapTemplatePath = path.join(DIR, "configmap.template.yaml");
  const configmapRenderedPath = path.join(DIR, "configmap.rendered.yaml");
  const { models } = config["llm-model"]["ollama"];
  const configmapVars = {
    models: models.map((model) => `"${model}"`).join(" "),
  };
  utils.renderTemplate(configmapTemplatePath, configmapRenderedPath, configmapVars);
  await $`kubectl apply -f ${configmapRenderedPath}`;
  const deploymentTemplatePath = path.join(DIR, "deployment.template.yaml");
  const deploymentRenderedPath = path.join(DIR, "deployment.rendered.yaml");
  const { EKS_MODE } = process.env;
  const deploymentVars = {
    KARPENTER_PREFIX: EKS_MODE === "auto" ? "eks.amazonaws.com" : "karpenter.k8s.aws",
  };
  utils.renderTemplate(deploymentTemplatePath, deploymentRenderedPath, deploymentVars);
  await $`kubectl apply -f ${deploymentRenderedPath}`;
  await $`kubectl apply -f ${path.join(DIR, "service.yaml")}`;
  const ingressTemplatePath = path.join(DIR, "ingress.template.yaml");
  const ingressRenderedPath = path.join(DIR, "ingress.rendered.yaml");
  const ingressVars = {
    DOMAIN: process.env.DOMAIN,
  };
  utils.renderTemplate(ingressTemplatePath, ingressRenderedPath, ingressVars);
  await $`kubectl apply -f ${ingressRenderedPath}`;
}

export async function uninstall() {
  await $`kubectl delete -f ${path.join(DIR, "ingress.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "service.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "deployment.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "configmap.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "namespace.yaml")} --ignore-not-found`;
}
