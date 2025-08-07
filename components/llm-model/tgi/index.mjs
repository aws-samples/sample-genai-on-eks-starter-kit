#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $, cd } from "zx";
$.verbose = true;

export const name = "TGI";
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
  const { models, enableNeuron } = config["llm-model"]["tgi"];
  if (enableNeuron) {
    // Need until this PR merged and new image available
    // https://github.com/huggingface/text-generation-inference/pull/3308
    // ghcr.io/huggingface/text-generation-inference
    try {
      await $`kubectl -n tgi get job tgi-neuron-build`;
      console.log("TGI Neuron build job already exists, skipping build...");
    } catch (err) {
      await utils.terraform.apply(DIR);
      const ecrRepoUrl = await utils.terraform.output(DIR, { outputName: "ecr_repository_url" });
      cd(DIR);
      const jobTemplatePath = path.join(DIR, `job-tgi-neuron-build.template.yaml`);
      const jobRenderedPath = path.join(DIR, `job-tgi-neuron-build.rendered.yaml`);
      const jobTemplateString = fs.readFileSync(jobTemplatePath, "utf8");
      const jobTemplate = handlebars.compile(jobTemplateString);
      const jobVars = { IMAGE: `${ecrRepoUrl}:latest` };
      fs.writeFileSync(jobRenderedPath, jobTemplate(jobVars));
      await $`kubectl -n tgi delete job tgi-neuron-build --ignore-not-found=true`;
      await $`kubectl apply -f ${jobRenderedPath}`;
      console.log("Waiting for TGI Neuron build job to complete, up to 30 mins...");
      try {
        await $`kubectl -n tgi wait --for=condition=complete job tgi-neuron-build --timeout=1800s`;
        console.log("TGI Neuron build job completed successfully!");
      } catch (err) {
        console.error("TGI Neuron build job did not complete in time or failed:", err);
      }
    }
  }
  await utils.model.addModels(models, "llm-model", "tgi");
}

export async function uninstall() {
  const { models } = config["llm-model"]["tgi"];
  await utils.model.removeAllModels(models, "llm-model", "tgi");
  await $`kubectl delete -f ${path.join(DIR, "secret.rendered.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc-huggingface-cache.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "pvc-neuron-cache.yaml")} --ignore-not-found`;
  await $`kubectl delete -f ${path.join(DIR, "namespace.yaml")} --ignore-not-found`;
}
