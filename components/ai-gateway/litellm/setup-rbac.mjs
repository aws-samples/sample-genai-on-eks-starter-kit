#!/usr/bin/env zx

/**
 * LiteLLM Team RBAC Setup Script
 *
 * Creates teams with model access groups and generates team API keys.
 * Run after LiteLLM is installed: ./cli ai-gateway litellm setup-rbac
 *
 * Teams:
 *   - senior-dev: access to all models (access group: "all-models")
 *   - junior-dev: access to limited models (specific model list)
 */

import { $ } from "zx";
$.verbose = true;

const LOCAL_PORT = 14000;

async function litellmAPI(method, path, body) {
  const apiKey = process.env.LITELLM_API_KEY;
  const curlArgs = [
    "-sf",
    "-X", method,
    `http://localhost:${LOCAL_PORT}${path}`,
    "-H", "Content-Type: application/json",
    "-H", `Authorization: Bearer ${apiKey}`,
  ];
  if (body) {
    curlArgs.push("-d", JSON.stringify(body));
  }
  const result = await $`curl ${curlArgs}`.quiet();
  return JSON.parse(result.stdout);
}

export async function setupRBAC(config) {
  console.log("\n========================================");
  console.log("Setting up LiteLLM Team RBAC");
  console.log("========================================\n");

  // Start port-forward in background
  const pf = $`kubectl port-forward -n litellm svc/litellm ${LOCAL_PORT}:4000`.quiet().nothrow();
  await new Promise((r) => setTimeout(r, 3000));

  const rbacConfig = config?.litellm?.rbac;
  if (!rbacConfig || !rbacConfig.teams) {
    console.log("No RBAC configuration found in config.json. Using defaults.");
  }

  const teams = rbacConfig?.teams || [
    {
      alias: "senior-dev",
      models: ["all-models"],
      description: "Senior developers - access to all models",
    },
    {
      alias: "junior-dev",
      models: ["vllm/qwen3-30b-instruct-fp8"],
      description: "Junior developers - limited model access",
    },
  ];

  try {
    for (const team of teams) {
      console.log(`\nCreating team: ${team.alias}`);
      console.log(`  Models: ${team.models.join(", ")}`);

      try {
        const teamResult = await litellmAPI("POST", "/team/new", {
          team_alias: team.alias,
          models: team.models,
          metadata: { description: team.description || "" },
        });
        console.log(`  Team ID: ${teamResult.team_id}`);

        // Generate API key for the team
        const keyResult = await litellmAPI("POST", "/key/generate", {
          team_id: teamResult.team_id,
          key_alias: `${team.alias}-key`,
          duration: "365d",
        });
        console.log(`  API Key: ${keyResult.key}`);
        console.log(`  Expires: ${keyResult.expires}`);
      } catch (error) {
        console.warn(`  Warning: Could not create team '${team.alias}': ${error.message}`);
        console.warn("  Team may already exist. Use LiteLLM UI to manage existing teams.");
      }
    }
  } finally {
    pf.kill();
  }

  console.log("\n========================================");
  console.log("RBAC Setup Complete");
  console.log("========================================");
  console.log("\nTo test model access control:");
  console.log("  curl -H 'Authorization: Bearer <team-key>' \\");
  console.log("    http://litellm.litellm:4000/v1/chat/completions \\");
  console.log('    -d \'{"model": "vllm/qwen3-30b-instruct-fp8", "messages": [{"role": "user", "content": "hello"}]}\'');
  console.log("\nNote: junior-dev team key will be rejected for models not in their allowed list.");
}
