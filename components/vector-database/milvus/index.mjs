import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Milvus";
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
  const requiredEnvVars = ["MILVUS_USERNAME", "MILVUS_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await utils.terraform.apply(DIR);
  const tfOutput = await utils.terraform.output(DIR);
  const milvusBucketName = tfOutput.milvus_bucket_name.value;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    DOMAIN: process.env.DOMAIN,
    MILVUS_BUCKET_NAME: milvusBucketName,  
    AWS_REGION: process.env.AWS_REGION,  
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm upgrade --install milvus milvus/milvus --namespace milvus --create-namespace -f ${valuesRenderedPath}`;

  const { MILVUS_USERNAME, MILVUS_PASSWORD } = process.env;
  const authContent = await $`htpasswd -nb ${MILVUS_USERNAME} ${MILVUS_PASSWORD}`;
  const secretTemplatePath = path.join(DIR, "secret.template.yaml");
  const secretRenderedPath = path.join(DIR, "secret.rendered.yaml");
  const secretTemplateString = fs.readFileSync(secretTemplatePath, "utf8");
  const secretTemplate = handlebars.compile(secretTemplateString);
  const secretVars = {
    AUTH: authContent.stdout.trim(),
  };
  fs.writeFileSync(secretRenderedPath, secretTemplate(secretVars));
  await $`kubectl apply -f ${secretRenderedPath}`;

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
  await $`kubectl delete -f ${path.join(DIR, "secret.rendered.yaml")} --ignore-not-found`;
  await $`helm uninstall milvus --namespace milvus`;
}
