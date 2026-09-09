#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Open-Sora (video generation)";
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

// Deployed into the vllm namespace to reuse the huggingface-cache PVC and
// hf-token secret created by the vLLM component — install that first.
export async function install() {
  await utils.setK8sContext();
  const templatePath = path.join(DIR, "model-opensora-v2.template.yaml");
  const renderedPath = path.join(DIR, "model-opensora-v2.rendered.yaml");
  const template = handlebars.compile(fs.readFileSync(templatePath, "utf8"));
  fs.writeFileSync(renderedPath, template(await utils.model.getModelVars()));
  await $`kubectl apply -f ${renderedPath}`;
  console.log("\n✅ Open-Sora v2 applied.");
  console.log("   First start downloads ~50GB of checkpoints and installs deps (~15-30 min).");
  console.log("   API: POST http://opensora-v2.vllm.svc.cluster.local:8000/generate {\"prompt\": \"...\"}");
}

export async function uninstall() {
  await utils.setK8sContext();
  const renderedPath = path.join(DIR, "model-opensora-v2.rendered.yaml");
  if (fs.existsSync(renderedPath)) {
    await $`kubectl delete -f ${renderedPath} --ignore-not-found`;
  }
}
