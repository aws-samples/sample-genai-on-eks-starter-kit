#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import inquirer from "inquirer";
import { $ } from "zx";
$.verbose = true;

export const name = "AIConfigurator (Auto Config + SLA Deploy)";
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

const SUPPORTED_SYSTEMS = [
  { name: "H100 SXM", value: "h100_sxm" },
  { name: "H200 SXM", value: "h200_sxm" },
  { name: "A100 SXM", value: "a100_sxm" },
  { name: "B200 SXM (preview)", value: "b200_sxm" },
  { name: "GB200 SXM (preview)", value: "gb200_sxm" },
];

const SUPPORTED_BACKENDS = [
  { name: "vLLM", value: "vllm" },
  { name: "TensorRT-LLM", value: "trtllm" },
  { name: "SGLang", value: "sglang" },
];

function getRuntimeImage(backend, imageTag) {
  const prefix = backend === "trtllm" ? "tensorrtllm" : backend;
  return `nvcr.io/nvidia/ai-dynamo/${prefix}-runtime:${imageTag}`;
}

async function getAicSupportMatrix(namespace, imageTag) {
  // Always create a dedicated pod with latest aiconfigurator
  const podName = `aic-query-${Date.now().toString(36)}`;
  const image = getRuntimeImage("vllm", imageTag);
  let pod = null;
  
  try {
    console.log("  Starting AIConfigurator pod...");
    await $`kubectl run ${podName} -n ${namespace} --restart=Never --image=${image} \
      --overrides=${JSON.stringify({spec:{tolerations:[{operator:"Exists"}]}})} \
      -- sleep 600`.quiet();
    await $`kubectl wait --for=condition=ready pod/${podName} -n ${namespace} --timeout=120s`.quiet();
    pod = podName;
  } catch {
    await $`kubectl delete pod ${podName} -n ${namespace} --ignore-not-found --force --grace-period=0`.quiet().nothrow();
    return null;
  }
  
  try {
    console.log("  Querying supported models (this may take 30-60s)...");
    const script = `
import json, os
try:
    import importlib.resources as pkg_resources
    from aiconfigurator.sdk.perf_database import get_supported_databases
    
    # Get models from model_configs directory
    mc_path = str(pkg_resources.files("aiconfigurator") / "model_configs")
    models = set()
    if os.path.isdir(mc_path):
        for f in os.listdir(mc_path):
            if f.endswith("_config.json"):
                hf_id = f.replace("_config.json", "").replace("--", "/")
                models.add(hf_id)
    
    # Get supported systems/backends
    dbs = get_supported_databases()
    
    # Build results: every model x every system x backend
    results = []
    for model in sorted(models):
        for system in dbs:
            for backend in dbs[system]:
                versions = dbs[system][backend]
                results.append({"model": model, "system": system, "backend": backend, "version": versions[-1] if versions else ""})
    
    print(json.dumps(results))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
    const result = await $`kubectl exec ${pod} -n ${namespace} -- python3 -c ${script}`.quiet().nothrow();
    $`kubectl delete pod ${pod} -n ${namespace} --force --grace-period=0`.quiet().nothrow();
    
    if (result.stdout.trim()) {
      const data = JSON.parse(result.stdout.trim());
      if (Array.isArray(data)) return data;
      if (data.error) console.log(`  ⚠️  ${data.error}`);
    }
  } catch (e) {
    $`kubectl delete pod ${pod} -n ${namespace} --force --grace-period=0`.quiet().nothrow();
  }
  return null;
}

function filterModels(matrix, system, backend) {
  if (!matrix || !Array.isArray(matrix)) return null;
  const models = [...new Set(matrix.filter(r => r.system === system && r.backend === backend).map(r => r.model))].sort();
  return models.length > 0 ? models : null;
}

function filterSystems(matrix) {
  if (!matrix || !Array.isArray(matrix)) return SUPPORTED_SYSTEMS.map(s => s.value);
  return [...new Set(matrix.map(r => r.system))].sort();
}

function filterBackends(matrix, system) {
  if (!matrix || !Array.isArray(matrix)) return SUPPORTED_BACKENDS.map(b => b.value);
  return [...new Set(matrix.filter(r => r.system === system).map(r => r.backend))].sort();
}

export async function install() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  const namespace = platformConfig.namespace || "dynamo-system";
  const imageTag = (platformConfig.releaseVersion || "0.9.0-post1").replace(/-post\d+$/, "");

  console.log("\n========================================");
  console.log("AIConfigurator — Auto Configuration");
  console.log("========================================\n");
  console.log("Uses NVIDIA AI Configurator to simulate model performance");
  console.log("and recommend optimal parallelization (TP/PP) and deployment config.\n");

  // Load support matrix from runtime image
  console.log("Loading AIConfigurator support matrix...");
  const matrix = await getAicSupportMatrix(namespace, imageTag);
  if (matrix && matrix.length > 0) {
    const models = [...new Set(matrix.map(r => r.model))];
    const systems = [...new Set(matrix.map(r => r.system))];
    console.log(`✅ Loaded ${models.length} models across ${systems.length} systems.`);
  } else {
    console.log("⚠️  Could not load support matrix. Manual input required.");
  }

  const { mode } = await inquirer.prompt([{
    type: "list",
    name: "mode",
    message: "Mode:",
    choices: [
      { name: "Quick Estimate — get TP/PP recommendation without deploying (20-30s)", value: "estimate" },
      { name: "SLA-Driven Deploy — auto-profile + plan + deploy via DGDR", value: "sla-deploy" },
    ],
  }]);

  // System selection (dynamic from matrix)
  const availableSystems = filterSystems(matrix);
  const systemChoices = SUPPORTED_SYSTEMS.filter(s => availableSystems.includes(s.value));
  if (systemChoices.length === 0) systemChoices.push(...SUPPORTED_SYSTEMS);
  
  const { system } = await inquirer.prompt([{
    type: "list",
    name: "system",
    message: "GPU system:",
    choices: systemChoices,
  }]);

  // Backend selection (dynamic from matrix + system)
  const availableBackends = filterBackends(matrix, system);
  const backendChoices = SUPPORTED_BACKENDS.filter(b => availableBackends.includes(b.value));
  if (backendChoices.length === 0) backendChoices.push(...SUPPORTED_BACKENDS);
  
  const { backend } = await inquirer.prompt([{
    type: "list",
    name: "backend",
    message: "Inference backend:",
    choices: backendChoices,
  }]);

  // Model selection (dynamic from matrix + system + backend)
  const modelList = filterModels(matrix, system, backend);
  
  let model;
  if (modelList && modelList.length > 0) {
    console.log(`\n${modelList.length} models supported for ${system} + ${backend}:`);
    const { selectedModel } = await inquirer.prompt([{
      type: "list",
      name: "selectedModel",
      message: "Select model:",
      choices: [...modelList.map(m => ({ name: m, value: m })), new inquirer.Separator(), { name: "— Enter custom HuggingFace model ID —", value: "__custom__" }],
      pageSize: 20,
    }]);
    if (selectedModel === "__custom__") {
      const { customModel } = await inquirer.prompt([{ type: "input", name: "customModel", message: "HuggingFace model ID:", default: "Qwen/Qwen3-32B" }]);
      model = customModel;
    } else {
      model = selectedModel;
    }
  } else {
    console.log("\nNo model list available. Enter manually.");
    const { customModel } = await inquirer.prompt([{ type: "input", name: "customModel", message: "HuggingFace model ID:", default: "Qwen/Qwen3-32B" }]);
    model = customModel;
  }

  const sla = await inquirer.prompt([
    { type: "input", name: "isl", message: "Average input sequence length (tokens):", default: "3000" },
    { type: "input", name: "osl", message: "Average output sequence length (tokens):", default: "150" },
    { type: "input", name: "ttft", message: "Target TTFT (ms):", default: "200" },
    { type: "input", name: "itl", message: "Target ITL (ms):", default: "20" },
  ]);

  // ========================================
  // Mode: Quick Estimate
  // ========================================
  if (mode === "estimate") {
    const { totalGpus } = await inquirer.prompt([{
      type: "input", name: "totalGpus", message: "Total GPUs available:", default: "8",
    }]);

    console.log("\n========================================");
    console.log("Running AIConfigurator simulation...");
    console.log("========================================\n");
    console.log(`  Model: ${model}`);
    console.log(`  System: ${system}`);
    console.log(`  Backend: ${backend}`);
    console.log(`  GPUs: ${totalGpus}`);
    console.log(`  SLA: ISL=${sla.isl}, OSL=${sla.osl}, TTFT≤${sla.ttft}ms, ITL≤${sla.itl}ms\n`);

    const aicPod = `aic-estimate-${Date.now().toString(36)}`;
    const image = getRuntimeImage(backend, imageTag);
    try {
      await $`kubectl run ${aicPod} --rm -i --restart=Never \
        --image=${image} -n ${namespace} \
        --overrides=${JSON.stringify({spec:{tolerations:[{operator:"Exists"}]}})} \
        -- aiconfigurator cli default \
          --hf_id ${model} \
          --total_gpus ${totalGpus} \
          --system ${system} \
          --backend ${backend} \
          --isl ${sla.isl} \
          --osl ${sla.osl} \
          --ttft ${sla.ttft} \
          --tpot ${sla.itl}`;
    } catch (e) {
      console.log(`\n⚠️  AIConfigurator error: ${e.message}`);
      console.log("Possible causes:");
      console.log("  - Model not supported for this system/backend");
      console.log("  - Image pull failed (check NGC credentials)");
      await $`kubectl delete pod ${aicPod} -n ${namespace} --ignore-not-found --force --grace-period=0`.quiet().nothrow();
      return;
    }

    console.log("\n========================================");
    console.log("Next Steps");
    console.log("========================================");
    console.log("Use the recommended TP values when deploying:");
    console.log("  ./cli nvidia-platform dynamo-vllm install");
    console.log("  → Set tensor_parallel_size to the recommended value");
    console.log("\nOr use SLA-Driven Deploy mode for auto-deployment.");
  }

  // ========================================
  // Mode: SLA-Driven Deploy (DGDR)
  // ========================================
  if (mode === "sla-deploy") {
    console.log("\nSLA-Driven Deploy creates a DynamoGraphDeploymentRequest (DGDR).");
    console.log("The Dynamo Operator will profile → plan → deploy automatically.\n");

    const { profilingMethod } = await inquirer.prompt([{
      type: "list",
      name: "profilingMethod",
      message: "Profiling method:",
      choices: [
        { name: "AI Configurator Simulation (fast, ~25s, no GPU needed)", value: "aic" },
        { name: "Real Engine Profiling (accurate, 2-4h, requires GPU)", value: "real" },
      ],
    }]);

    let realProfilingOpts = {};
    if (profilingMethod === "real") {
      console.log("\nReal profiling deploys actual vLLM/TRT-LLM engines and measures with AIPerf.");
      console.log("This takes 2-4 hours but gives accurate real-world performance data.\n");
      realProfilingOpts = await inquirer.prompt([
        { type: "input", name: "prefillGranularity", message: "Prefill interpolation samples:", default: "16" },
        { type: "input", name: "decodeGranularity", message: "Decode interpolation samples:", default: "6" },
      ]);
    }

    const deployOpts = await inquirer.prompt([
      { type: "input", name: "dgdrName", message: "DGDR name:", default: `${model.split("/").pop().toLowerCase().replace(/[^a-z0-9-]/g, "-")}-sla` },
      { type: "confirm", name: "autoApply", message: "Auto-deploy after profiling?", default: true },
      { type: "input", name: "minGpus", message: "Min GPUs per engine (0 = auto):", default: "0" },
      { type: "input", name: "maxGpus", message: "Max GPUs per engine (0 = auto):", default: "0" },
      { type: "confirm", name: "enablePlanner", message: "Enable SLA Planner (auto-scaling)?", default: false },
    ]);

    let plannerOpts = {};
    if (deployOpts.enablePlanner) {
      plannerOpts = await inquirer.prompt([
        { type: "input", name: "minEndpoint", message: "Planner min endpoints:", default: "2" },
        { type: "input", name: "adjustInterval", message: "Planner adjustment interval (sec):", default: "60" },
      ]);
    }

    // Check model cache PVC
    let modelCachePvc = "";
    let modelCachePath = "";
    try {
      const pvcs = await $`kubectl get pvc -n ${namespace} -o jsonpath='{.items[*].metadata.name}'`.quiet();
      const pvcList = pvcs.stdout.trim().replace(/'/g, "").split(" ").filter(p => p);
      const cachePvcs = pvcList.filter(p => p.includes("model") || p.includes("cache") || p.includes("nfs"));
      if (cachePvcs.length > 0) {
        const { usePvc } = await inquirer.prompt([{
          type: "list",
          name: "usePvc",
          message: "Use existing model cache PVC?",
          choices: [...cachePvcs.map(p => ({ name: p, value: p })), { name: "— No PVC (download from HuggingFace) —", value: "" }],
        }]);
        modelCachePvc = usePvc;
        if (modelCachePvc) {
          const { cachePath } = await inquirer.prompt([{
            type: "input", name: "cachePath", message: "Model path within PVC (empty = root):", default: "",
          }]);
          modelCachePath = cachePath;
        }
      }
    } catch { /* no PVCs */ }

    const templatePath = path.join(DIR, "dgdr.template.yaml");
    const templateString = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(templateString);

    const useAic = profilingMethod === "aic";
    const renderedYaml = template({
      DGDR_NAME: deployOpts.dgdrName,
      NAMESPACE: namespace,
      MODEL: model,
      BACKEND: backend,
      IS_TRTLLM: backend === "trtllm",
      IMAGE_TAG: imageTag,
      USE_AIC: useAic,
      AIC_SYSTEM: system,
      AIC_BACKEND_VERSION: "",
      PREFILL_GRANULARITY: realProfilingOpts.prefillGranularity || "16",
      DECODE_GRANULARITY: realProfilingOpts.decodeGranularity || "6",
      ISL: sla.isl,
      OSL: sla.osl,
      TTFT: sla.ttft,
      ITL: sla.itl,
      MIN_GPUS: deployOpts.minGpus !== "0" ? deployOpts.minGpus : "",
      MAX_GPUS: deployOpts.maxGpus !== "0" ? deployOpts.maxGpus : "",
      ENABLE_PLANNER: deployOpts.enablePlanner,
      PLANNER_MIN_ENDPOINT: plannerOpts.minEndpoint || "2",
      PLANNER_ADJUSTMENT_INTERVAL: plannerOpts.adjustInterval || "60",
      MODEL_CACHE_PVC: modelCachePvc,
      MODEL_CACHE_PATH: modelCachePath,
      AUTO_APPLY: deployOpts.autoApply,
    });

    const renderedPath = path.join(DIR, `${deployOpts.dgdrName}.generated.yaml`);
    fs.writeFileSync(renderedPath, renderedYaml);
    
    console.log("\n========================================");
    console.log("Generated DGDR:");
    console.log("========================================");
    console.log(renderedYaml);

    const { apply } = await inquirer.prompt([{
      type: "confirm",
      name: "apply",
      message: "Apply this DGDR to the cluster?",
      default: true,
    }]);

    if (apply) {
      await $`kubectl apply -f ${renderedPath}`;
      console.log(`\n✅ DGDR '${deployOpts.dgdrName}' created in namespace '${namespace}'`);
      console.log("\nMonitor progress:");
      console.log(`  kubectl get dgdr ${deployOpts.dgdrName} -n ${namespace} -w`);
      console.log(`  kubectl describe dgdr ${deployOpts.dgdrName} -n ${namespace}`);
      if (deployOpts.autoApply) {
        console.log("\nOnce profiling completes, the DGD will be auto-deployed.");
        console.log(`  kubectl get dgd -n ${namespace} -w`);
      }
    } else {
      console.log(`\nDGDR saved to: ${renderedPath}`);
      console.log(`Apply manually: kubectl apply -f ${renderedPath}`);
    }
    
    fs.unlinkSync(renderedPath);
  }
}

export async function uninstall() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  const namespace = platformConfig.namespace || "dynamo-system";

  console.log("\nCleaning up AIConfigurator resources...");
  
  // List DGDRs
  try {
    const dgdrs = await $`kubectl get dgdr -n ${namespace} -o jsonpath='{.items[*].metadata.name}'`.quiet();
    const dgdrList = dgdrs.stdout.trim().replace(/'/g, "").split(" ").filter(d => d);
    if (dgdrList.length > 0) {
      console.log(`Found DGDRs: ${dgdrList.join(", ")}`);
      const { deleteDgdrs } = await inquirer.prompt([{
        type: "checkbox",
        name: "deleteDgdrs",
        message: "Select DGDRs to delete:",
        choices: dgdrList,
      }]);
      for (const dgdr of deleteDgdrs) {
        await $`kubectl delete dgdr ${dgdr} -n ${namespace}`;
        console.log(`  Deleted: ${dgdr}`);
      }
    } else {
      console.log("No DGDRs found.");
    }
  } catch {
    console.log("DGDR CRD not available (Dynamo Operator may not be installed).");
  }

  console.log("Done.");
}
