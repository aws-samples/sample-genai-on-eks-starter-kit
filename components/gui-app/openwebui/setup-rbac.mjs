#!/usr/bin/env zx

/**
 * OpenWebUI Model Access Control Setup
 *
 * - Signs in as the admin (WEBUI_ADMIN_EMAIL / WEBUI_ADMIN_PASSWORD) to get a JWT
 * - Reads LiteLLM RBAC team definitions from config.json (litellm.rbac.teams)
 * - For each model discovered in OpenWebUI, assigns access_control to groups
 *   whose `models` list includes that model (or "all-models")
 * - Groups must already exist in OpenWebUI (auto-created via ENABLE_OAUTH_GROUP_CREATION
 *   on first Keycloak login of a user in that group)
 */

import { $ } from "zx";
$.verbose = true;

const LOCAL_PORT = 18081;

async function owAPI(token, method, path, body) {
  const args = [
    "-sf",
    "-X", method,
    `http://localhost:${LOCAL_PORT}${path}`,
    "-H", "Content-Type: application/json",
  ];
  if (token) args.push("-H", `Authorization: Bearer ${token}`);
  if (body) args.push("-d", JSON.stringify(body));
  const result = await $`curl ${args}`.quiet();
  if (!result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return result.stdout;
  }
}

function buildAccessControl(teams, modelId, groupIdByName) {
  // Teams whose `models` list includes this model (or "all-models")
  const readGroups = new Set();
  const writeGroups = new Set();
  for (const team of teams) {
    const allowAll = (team.models || []).includes("all-models");
    const matches = allowAll || (team.models || []).includes(modelId);
    if (matches) {
      const gid = groupIdByName[team.alias];
      if (gid) {
        readGroups.add(gid);
        if (allowAll) writeGroups.add(gid);
      }
    }
  }
  if (readGroups.size === 0) return null; // public
  return {
    read: { group_ids: [...readGroups], user_ids: [] },
    write: { group_ids: [...writeGroups], user_ids: [] },
  };
}

export async function setupRBAC(config) {
  console.log("\n========================================");
  console.log("Setting up OpenWebUI Model RBAC");
  console.log("========================================\n");

  const rbac = config?.litellm?.rbac;
  if (!rbac?.teams?.length) {
    console.log("No litellm.rbac.teams defined in config.json — skipping OpenWebUI RBAC");
    return;
  }

  const pf = $`kubectl port-forward -n openwebui svc/openwebui ${LOCAL_PORT}:80`.quiet().nothrow();
  await new Promise((r) => setTimeout(r, 3000));

  try {
    // 1. Obtain an admin token
    //    In SSO mode OpenWebUI blocks password sign-in, so prefer OPENWEBUI_ADMIN_API_KEY.
    //    Fallback: try /api/v1/auths/signin (works only when SSO is not enforced).
    let token = process.env.OPENWEBUI_ADMIN_API_KEY || "";
    if (!token) {
      const adminEmail = process.env.OPENWEBUI_ADMIN_EMAIL || "admin@example.com";
      const adminPass = process.env.OPENWEBUI_ADMIN_PASSWORD || "Pass@123";
      try {
        const auth = await owAPI(null, "POST", "/api/v1/auths/signin", { email: adminEmail, password: adminPass });
        token = auth?.token || "";
      } catch {
        // ignore, handled below
      }
    }
    if (!token) {
      console.warn("  No admin token available. SSO-only mode blocks password sign-in.");
      console.warn("  To enable automatic RBAC setup:");
      console.warn("    1. Log in to OpenWebUI as admin via browser");
      console.warn("    2. Settings → Account → API keys → Create new");
      console.warn("    3. Save to .env.local: OPENWEBUI_ADMIN_API_KEY=<key>");
      console.warn("    4. Re-run: ./cli gui-app openwebui setup-rbac");
      return;
    }
    console.log("  Authenticated as admin");

    // 2. List groups
    const groups = (await owAPI(token, "GET", "/api/v1/groups/")) || [];
    const groupIdByName = Object.fromEntries(groups.map((g) => [g.name, g.id]));
    const missing = rbac.teams.map((t) => t.alias).filter((name) => !groupIdByName[name]);
    if (missing.length > 0) {
      console.warn(`  Groups not yet created in OpenWebUI: ${missing.join(", ")}`);
      console.warn("  Groups are auto-created when a user from that Keycloak group signs in.");
      console.warn("  Re-run after first login of senior-demo and junior-demo.");
    }
    console.log(`  Found groups: ${Object.keys(groupIdByName).join(", ") || "(none)"}`);

    // 3. List models
    const modelsResp = await owAPI(token, "GET", "/api/models");
    const models = modelsResp?.data || modelsResp || [];
    console.log(`  Found ${models.length} models`);

    // 4. For each model, set access_control based on which teams include it
    let updated = 0;
    for (const m of models) {
      const modelId = m.id;
      const accessControl = buildAccessControl(rbac.teams, modelId, groupIdByName);
      if (!accessControl) continue;
      try {
        await owAPI(token, "POST", `/api/v1/models/model/update?id=${encodeURIComponent(modelId)}`, {
          id: modelId,
          name: m.name || modelId,
          meta: m.meta || {},
          params: m.params || {},
          access_control: accessControl,
          is_active: true,
        });
        console.log(`  ✓ ${modelId} -> groups [${accessControl.read.group_ids.length}]`);
        updated++;
      } catch (err) {
        console.warn(`  ✗ ${modelId}: ${err.message}`);
      }
    }
    console.log(`\n  Updated access control on ${updated}/${models.length} models`);
  } finally {
    pf.kill();
  }
}
