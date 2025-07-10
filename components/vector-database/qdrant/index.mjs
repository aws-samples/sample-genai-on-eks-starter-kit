import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Qdrant";
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
  const requiredEnvVars = ["QDRANT_USERNAME", "QDRANT_PASSWORD"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  await $`helm repo add qdrant https://qdrant.to/helm`;
  await $`helm repo update`;

  const valuesTemplatePath = path.join(DIR, "values.template.yaml");
  const valuesRenderedPath = path.join(DIR, "values.rendered.yaml");
  const valuesTemplateString = fs.readFileSync(valuesTemplatePath, "utf8");
  const valuesTemplate = handlebars.compile(valuesTemplateString);
  const valuesVars = {
    DOMAIN: process.env.DOMAIN,
  };
  fs.writeFileSync(valuesRenderedPath, valuesTemplate(valuesVars));
  await $`helm upgrade --install qdrant qdrant/qdrant --namespace qdrant --create-namespace -f ${valuesRenderedPath}`;

  const { QDRANT_USERNAME, QDRANT_PASSWORD } = process.env;
  const authContent = await $`htpasswd -nb ${QDRANT_USERNAME} ${QDRANT_PASSWORD}`;
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
  await $`helm uninstall qdrant --namespace qdrant`;
}
