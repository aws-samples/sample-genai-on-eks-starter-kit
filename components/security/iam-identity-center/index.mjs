#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { $ } from "zx";
$.verbose = true;

export const name = "IAM Identity Center (OIDC)";
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
  const requiredEnvVars = ["REGION", "EKS_CLUSTER_NAME"];
  utils.checkRequiredEnvVars(requiredEnvVars);

  console.log("\n========================================");
  console.log("Provisioning IAM Identity Center OIDC Application");
  console.log("========================================\n");

  // Auto-detect IAM Identity Center region
  console.log("[0/3] Detecting IAM Identity Center region...");
  let identityCenterRegion = process.env.IDENTITY_CENTER_REGION;
  if (!identityCenterRegion) {
    const candidateRegions = ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1", "ap-southeast-1", process.env.REGION];
    for (const region of [...new Set(candidateRegions)]) {
      try {
        const result = await $`aws sso-admin list-instances --region ${region} --query "Instances[0].IdentityStoreId" --output text`.quiet();
        if (result.stdout.trim() && result.stdout.trim() !== "None") {
          identityCenterRegion = region;
          console.log(`  Found IAM Identity Center in ${region}`);
          break;
        }
      } catch {}
    }
    if (!identityCenterRegion) {
      // Auto-create IAM Identity Center in the EKS region
      const createRegion = process.env.REGION || "us-east-1";
      console.log(`  IAM Identity Center not found. Creating in ${createRegion}...`);
      try {
        await $`aws sso-admin create-instance --region ${createRegion}`.quiet();
        // Wait for instance to be available
        console.log("  Waiting for IAM Identity Center to become available...");
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 10000));
          const check = await $`aws sso-admin list-instances --region ${createRegion} --query "Instances[0].IdentityStoreId" --output text`.quiet();
          if (check.stdout.trim() && check.stdout.trim() !== "None") {
            identityCenterRegion = createRegion;
            console.log(`  IAM Identity Center created in ${createRegion}`);
            break;
          }
        }
        if (!identityCenterRegion) {
          throw new Error("IAM Identity Center creation timed out. Check AWS Console.");
        }
      } catch (error) {
        if (error.message.includes("timed out")) throw error;
        throw new Error(`Failed to create IAM Identity Center: ${error.message}. Enable it manually in AWS Console.`);
      }
    }
  } else {
    console.log(`  Using configured region: ${identityCenterRegion}`);
  }

  // Provision OIDC application via Terraform
  console.log("\n[1/3] Provisioning IAM Identity Center resources (Terraform)...");
  const tfVars = { vars: { identity_center_region: identityCenterRegion } };
  await utils.terraform.apply(DIR, tfVars);
  const tfOutput = await utils.terraform.output(DIR, tfVars);

  const clientId = tfOutput.oidc_client_id.value;
  const clientSecret = await utils.terraform.output(DIR, { outputName: "oidc_client_secret" });
  const issuerUrl = tfOutput.oidc_issuer_url.value;

  console.log(`  OIDC Client ID: ${clientId}`);
  console.log(`  OIDC Issuer URL: ${issuerUrl}`);
  console.log(`  OIDC Client Secret: ****${clientSecret.slice(-4)}`);

  // Auto-save OIDC config to config.local.json
  console.log("\n[2/3] Saving OIDC config to config.local.json...");
  const configLocalPath = path.join(BASE_DIR, "config.local.json");
  let existing = {};
  if (fs.existsSync(configLocalPath)) {
    existing = JSON.parse(fs.readFileSync(configLocalPath, "utf8"));
  }
  existing.oidc = {
    clientId: clientId,
    issuerUrl: issuerUrl,
  };
  fs.writeFileSync(configLocalPath, JSON.stringify(existing, null, 2));
  console.log("  OIDC config saved to config.local.json");

  // Auto-save OIDC credentials to .env.local
  console.log("\n[3/3] Saving OIDC credentials to .env.local...");
  const envLocalPath = path.join(BASE_DIR, ".env.local");
  let envContent = "";
  if (fs.existsSync(envLocalPath)) {
    envContent = fs.readFileSync(envLocalPath, "utf8");
  }
  const setEnvVar = (content, key, value) => {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    }
    return content.trimEnd() + `\n${key}=${value}\n`;
  };
  envContent = setEnvVar(envContent, "OIDC_CLIENT_ID", clientId);
  envContent = setEnvVar(envContent, "OIDC_CLIENT_SECRET", clientSecret);
  envContent = setEnvVar(envContent, "OIDC_ISSUER_URL", issuerUrl);
  fs.writeFileSync(envLocalPath, envContent);
  // Reload env vars for subsequent components
  process.env.OIDC_CLIENT_ID = clientId;
  process.env.OIDC_CLIENT_SECRET = clientSecret;
  process.env.OIDC_ISSUER_URL = issuerUrl;
  console.log("  OIDC credentials saved to .env.local");

  console.log("\n========================================");
  console.log("IAM Identity Center setup complete!");
  console.log("========================================");
  console.log("All OIDC credentials have been auto-generated and saved.");
  console.log("User groups created: senior-dev, junior-dev");
  console.log("Next: Assign users to groups in IAM Identity Center console.");
}

export async function uninstall() {
  console.log("\nRemoving IAM Identity Center OIDC Application...");
  const identityCenterRegion = process.env.IDENTITY_CENTER_REGION || "us-east-1";
  await utils.terraform.destroy(DIR, { vars: { identity_center_region: identityCenterRegion } });
  console.log("IAM Identity Center resources destroyed.");
}
