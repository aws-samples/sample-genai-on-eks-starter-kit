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
  const requiredEnvVars = ["DOMAIN", "HF_TOKEN"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await $`kubectl apply -f ${path.join(DIR, "namespace.yaml")}`;
  await $`kubectl apply -f ${path.join(DIR, "pvc-huggingface-cache.yaml")}`;
  const secretTemplatePath = path.join(DIR, "secret.template.yaml");
  const secretRenderedPath = path.join(DIR, "secret.rendered.yaml");
  const secretTemplateString = fs.readFileSync(secretTemplatePath, "utf8");
  const secretTemplate = handlebars.compile(secretTemplateString);
  const secretVars = {
    HF_TOKEN: process.env.HF_TOKEN,
  };
  fs.writeFileSync(secretRenderedPath, secretTemplate(secretVars));
  await $`kubectl apply -f ${secretRenderedPath}`;
  const { models, enableNeuron } = config["llm-model"]["vllm"];
  if (enableNeuron) {
    await $`kubectl apply -f ${path.join(DIR, "pvc-neuron-cache.yaml")}`;
    await utils.terraform.apply(DIR);
    const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });
    cd(DIR);
    const jobTemplatePath = path.join(DIR, `job-vllm-neuron-build.template.yaml`);
    const jobRenderedPath = path.join(DIR, `job-vllm-neuron-build.rendered.yaml`);
    const jobTemplateString = fs.readFileSync(jobTemplatePath, "utf8");
    const jobTemplate = handlebars.compile(jobTemplateString);
    const jobVars = { IMAGE: `${ecrRepoUrl}:latest` };
    fs.writeFileSync(jobRenderedPath, jobTemplate(jobVars));
    await $`kubectl -n vllm delete job vllm-neuron-build --ignore-not-found=true`;
    await $`kubectl apply -f ${jobRenderedPath}`;
    console.log("Waiting for vLLM Neuron build job to complete, up to 30 mins...");
    try {
      await $`kubectl -n vllm wait --for=condition=complete job vllm-neuron-build --timeout=1800s`;
      console.log("vLLM Neuron build job completed successfully!");
    } catch (err) {
      console.error("vLLM Neuron build job did not complete in time or failed:", err);
    }
  }
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
