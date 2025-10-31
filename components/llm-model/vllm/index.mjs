#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "vLLM";
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
  const requiredEnvVars = ["HF_TOKEN"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await $`kubectl apply -f ${path.join(DIR, "namespace.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "pvc-huggingface-cache.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "pvc-neuron-cache.yaml")}`;
  const secretTemplatePath = path.join(DIR, "secret.template.yaml");
  const secretRenderedPath = path.join(DIR, "secret.rendered.yaml");
  const secretTemplateString = fs.readFileSync(secretTemplatePath, "utf8");
  const secretTemplate = handlebars.compile(secretTemplateString);
  const secretVars = {
    HF_TOKEN: process.env.HF_TOKEN,
  };
  fs.writeFileSync(secretRenderedPath, secretTemplate(secretVars));
  await $`kubectl apply -f ${secretRenderedPath}`;
  await utils.model.addModels(models, "llm-model", "vllm");
}

export async function uninstall() {
  const { models } = config["llm-model"]["vllm"];
  await utils.model.removeAllModels(models, "llm-model", "vllm");
  await $`kubectl delete -f ${path.join(DIR, "secret.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc-huggingface-cache.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc-neuron-cache.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "namespace.yaml")} --ignore-not-found`;
}
