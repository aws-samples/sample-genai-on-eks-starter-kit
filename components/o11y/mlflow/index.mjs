import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "MLflow";
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
  const requiredEnvVars = ["MLFLOW_USERNAME", "MLFLOW_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await utils.terraform.apply(DIR);
  const mlflowBucketName = await utils.terraform.output(DIR, { outputName: "mlflow_bucket_name" });

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    DOMAIN: process.env.DOMAIN,
    MLFLOW_USERNAME: process.env.MLFLOW_USERNAME,
    MLFLOW_PASSWORD: process.env.MLFLOW_PASSWORD,
    MLFLOW_BUCKET_NAME: mlflowBucketName,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm repo add community-charts https://community-charts.github.io/helm-charts`;
  await $`helm upgrade --install mlflow community-charts/mlflow --namespace mlflow --create-namespace -f ${valuesRenderedPath}`;
}

export async function uninstall() {
  await $`helm uninstall mlflow --namespace mlflow`;
  await utils.terraform.destroy(DIR);
}
