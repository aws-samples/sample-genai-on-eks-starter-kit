#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import { $ } from "zx";
$.verbose = true;

export const name = "Network Observability (AWS Network Flow Monitor)";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

const ADDON_NAME = "aws-network-flow-monitoring-agent";
const NFM_NAMESPACE = "amazon-network-flow-monitor";
const NFM_SA = "aws-network-flow-monitor-agent-service-account";

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

export async function install() {
  if (utils.isK8sMode()) {
    console.log("Network Flow Monitor requires EKS/AWS; skipping in K8s mode.");
    return;
  }

  const clusterName = process.env.EKS_CLUSTER_NAME || config?.platform?.eks?.clusterName || "genai-on-eks";
  const region = process.env.AWS_REGION;

  console.log("\n========================================");
  console.log("Installing AWS Network Flow Monitor");
  console.log("========================================\n");

  // 1. Provision NFM Scope + Monitor + IAM role (managed-policy attached).
  await utils.terraform.apply(DIR);
  const roleArn = await utils.terraform.output(DIR, { outputName: "nfm_agent_role_arn" });

  // 2. Prerequisite: EKS Pod Identity Agent add-on must be present.
  console.log("\nEnsuring EKS Pod Identity Agent add-on is installed...");
  await $`aws eks create-addon --cluster-name ${clusterName} --addon-name eks-pod-identity-agent --region ${region}`.catch(
    () => console.log("  (pod-identity-agent already present or created)")
  );

  // 3. Install the NFM agent add-on. --pod-identity-associations creates the
  //    SA↔role binding, so no separate association resource is needed.
  console.log("\nInstalling NFM agent add-on...");
  await $`aws eks create-addon \
    --cluster-name ${clusterName} \
    --addon-name ${ADDON_NAME} \
    --region ${region} \
    --pod-identity-associations serviceAccount=${NFM_SA},roleArn=${roleArn}`.catch((e) =>
    console.log(`  create-addon returned: ${e.message} (may already exist)`)
  );

  // 4. Scrape the agent's Prometheus metrics (/metrics on port 9101) into
  //    kube-prometheus-stack via a ServiceMonitor + headless Service.
  const smTemplatePath = path.join(DIR, "servicemonitor.template.yaml");
  const smRenderedPath = path.join(DIR, "servicemonitor.rendered.yaml");
  const smTemplateString = fs.readFileSync(smTemplatePath, "utf8");
  const smTemplate = handlebars.compile(smTemplateString);
  fs.writeFileSync(smRenderedPath, smTemplate({ NFM_NAMESPACE }));
  await $`kubectl apply -f ${smRenderedPath}`;

  // 5. Workload Insights exporter: polls the NFM top-contributor API and
  //    exposes AZ/VPC/subnet traffic + retransmission/timeout gauges that the
  //    agent endpoint doesn't have. Feeds the Grafana inter-AZ/cost panels.
  const wiTemplatePath = path.join(DIR, "wi-exporter.template.yaml");
  const wiRenderedPath = path.join(DIR, "wi-exporter.rendered.yaml");
  const wiTemplate = handlebars.compile(fs.readFileSync(wiTemplatePath, "utf8"));
  fs.writeFileSync(wiRenderedPath, wiTemplate({ NFM_NAMESPACE, REGION: region }));
  await $`kubectl apply -f ${wiRenderedPath}`;

  console.log("\n✅ Network Flow Monitor installed.");
  console.log("   Service map / flow table: EKS console → cluster → Observability → Network.");
  console.log(`   Verify agent pods: kubectl get pods -n ${NFM_NAMESPACE}`);
}

export async function uninstall() {
  if (utils.isK8sMode()) return;
  const clusterName = process.env.EKS_CLUSTER_NAME || config?.platform?.eks?.clusterName || "genai-on-eks";
  const region = process.env.AWS_REGION;

  await $`kubectl delete -f ${path.join(DIR, "wi-exporter.rendered.yaml")} --ignore-not-found`.catch(() => {});
  await $`kubectl delete -f ${path.join(DIR, "servicemonitor.rendered.yaml")} --ignore-not-found`.catch(() => {});
  await $`aws eks delete-addon --cluster-name ${clusterName} --addon-name ${ADDON_NAME} --region ${region}`.catch(
    () => {}
  );
  await utils.terraform.destroy(DIR);
}
