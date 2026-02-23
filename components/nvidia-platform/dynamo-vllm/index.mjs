#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";
import inquirer from "inquirer";
import { $ } from "zx";
$.verbose = true;

export const name = "Dynamo vLLM Serving";
const __filename = fileURLToPath(import.meta.url);
const DIR = path.dirname(__filename);
let BASE_DIR;
let config;
let utils;

// Register Handlebars helpers
handlebars.registerHelper("eq", (a, b) => a === b);
handlebars.registerHelper("neq", (a, b) => a !== b);
handlebars.registerHelper("gt", (a, b) => parseInt(a) > parseInt(b));
handlebars.registerHelper("split", (str, delimiter) => str ? str.split(delimiter).filter(s => s.trim()) : []);

export async function init(_BASE_DIR, _config, _utils) {
  BASE_DIR = _BASE_DIR;
  config = _config;
  utils = _utils;
}

// Check if Dynamo Platform is installed
async function isPlatformInstalled(namespace) {
  try {
    const result = await $`kubectl get crd dynamographdeployments.nvidia.com`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Check if HF token secret exists
async function isHfTokenSecretExist(namespace) {
  try {
    const result = await $`kubectl get secret hf-token-secret -n ${namespace}`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Check if model cache PVC exists
async function isModelCachePvcExist(namespace, pvcName) {
  try {
    const result = await $`kubectl get pvc ${pvcName} -n ${namespace}`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// Check if model is already downloaded in PVC
async function isModelDownloaded(namespace, pvcName, model) {
  try {
    // Create a short-lived pod to check if model files exist
    const modelDir = model.replace("/", "--");
    const checkResult = await $`kubectl run model-check-${Date.now()} \
      --image=busybox --rm -i --restart=Never \
      --overrides='{"spec":{"volumes":[{"name":"cache","persistentVolumeClaim":{"claimName":"${pvcName}"}}],"containers":[{"name":"check","image":"busybox","command":["sh","-c","ls /opt/models/hub/models--${modelDir}/ 2>/dev/null && echo EXISTS || echo MISSING"],"volumeMounts":[{"name":"cache","mountPath":"/opt/models"}]}]}}' \
      -n ${namespace}`.quiet();
    return checkResult.stdout.includes("EXISTS");
  } catch {
    return false;
  }
}

// Run model download job and wait for completion
async function runModelDownloadJob(namespace, model, modelShortName, pvcName, isK8s, hfSecretExists) {
  const jobName = `model-download-${modelShortName}-${Date.now().toString(36)}`.slice(0, 63);
  
  // Render download job template
  const jobTemplatePath = path.join(DIR, "model-download-job.template.yaml");
  const jobRenderedPath = path.join(DIR, `${jobName}.generated.yaml`);
  const jobTemplateString = fs.readFileSync(jobTemplatePath, "utf8");
  const jobTemplate = handlebars.compile(jobTemplateString);
  
  const jobYaml = jobTemplate({
    JOB_NAME: jobName,
    MODEL: model,
    MODEL_SHORT_NAME: modelShortName,
    MODEL_CACHE_PVC_NAME: pvcName,
    HAS_HF_TOKEN: hfSecretExists,
    IS_K8S: isK8s,
    IS_EKS: !isK8s,
  });
  
  fs.writeFileSync(jobRenderedPath, jobYaml);
  
  console.log(`\n  Starting download job: ${jobName}`);
  await $`kubectl apply -f ${jobRenderedPath} -n ${namespace}`;
  
  // Wait for job completion with progress
  console.log("  Waiting for download to complete...");
  console.log(`  Monitor logs: kubectl logs -f job/${jobName} -n ${namespace}\n`);
  
  const maxWaitSeconds = 3600; // 1 hour max
  const pollInterval = 15;
  let elapsed = 0;
  
  while (elapsed < maxWaitSeconds) {
    try {
      // Check succeeded/failed counts (more reliable than conditions)
      const result = await $`kubectl get job ${jobName} -n ${namespace} -o jsonpath={.status.succeeded},{.status.failed},{.status.active}`.quiet();
      const [succeeded, failed, active] = result.stdout.trim().split(",");
      
      if (succeeded === "1") {
        console.log("  ✅ Model download complete!");
        // Cleanup job and generated yaml
        try { await $`kubectl delete job ${jobName} -n ${namespace}`.quiet(); } catch {}
        try { fs.unlinkSync(jobRenderedPath); } catch {}
        return true;
      }
      if (parseInt(failed || "0") >= 3) {
        console.log("  ❌ Model download failed (backoff limit reached)!");
        console.log(`  Check logs: kubectl logs job/${jobName} -n ${namespace}`);
        // Keep job for debugging, don't delete
        return false;
      }
    } catch {
      // Job query failed, retry
    }
    
    // Show progress from logs periodically
    if (elapsed % 30 === 0 && elapsed > 0) {
      try {
        const logs = await $`kubectl logs job/${jobName} -n ${namespace} --tail=1`.quiet();
        const lastLine = logs.stdout.trim().split("\n").pop();
        if (lastLine) {
          console.log(`  [${Math.floor(elapsed / 60)}m] ${lastLine}`);
        }
      } catch {}
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));
    elapsed += pollInterval;
  }
  
  console.log("  ⚠️  Download job timed out (1 hour). It may still be running.");
  console.log(`  Monitor with: kubectl logs -f job/${jobName} -n ${namespace}`);
  return false;
}

export async function install() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s 
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  
  const namespace = platformConfig.namespace || "dynamo-system";
  const storageClass = isK8s 
    ? (config?.platform?.k8s?.storageClass || "local-path")
    : (config?.platform?.eks?.storageClass || "efs");
  
  console.log("\n========================================");
  console.log("Deploying Dynamo vLLM Serving");
  console.log("========================================\n");
  console.log(`Platform: ${isK8s ? "K8s" : "EKS"}`);
  console.log(`Namespace: ${namespace}`);
  console.log(`StorageClass: ${storageClass}`);
  
  // ============================================
  // Step 1: Check prerequisites
  // ============================================
  console.log("\n[1/6] Checking prerequisites...");
  const platformInstalled = await isPlatformInstalled(namespace);
  if (!platformInstalled) {
    console.log("❌ Dynamo Platform not installed.");
    console.log("   Please install Dynamo Platform first:");
    console.log("   ./cli nvidia-platform dynamo-platform install");
    return;
  }
  console.log("✅ Dynamo Platform CRDs found");
  
  const hfSecretExists = await isHfTokenSecretExist(namespace);
  if (!hfSecretExists) {
    console.log("\n⚠️  HuggingFace token secret not found.");
    console.log("   Some models (e.g., gated models) require a HuggingFace token.");
    
    const { tokenAction } = await inquirer.prompt([{
      type: "list",
      name: "tokenAction",
      message: "HuggingFace token setup:",
      choices: [
        { name: "Enter token now (stored as K8s secret only)", value: "enter" },
        { name: "Skip (public models only)", value: "skip" },
      ],
    }]);
    
    if (tokenAction === "enter") {
      const { inputToken } = await inquirer.prompt([{
        type: "password",
        name: "inputToken",
        message: "Enter your HuggingFace token:",
        mask: "*",
        validate: (input) => input.startsWith("hf_") ? true : "Token should start with 'hf_'",
      }]);
      
      await $`kubectl create secret generic hf-token-secret \
        --from-literal=HF_TOKEN=${inputToken} \
        -n ${namespace}`;
      console.log("✅ HuggingFace token saved as K8s secret (hf-token-secret)");
    } else {
      console.log("  Skipping HF token. Only public models will work.");
      console.log("  To add later:");
      console.log(`    kubectl create secret generic hf-token-secret \\`);
      console.log(`      --from-literal=HF_TOKEN=<your-token> \\`);
      console.log(`      -n ${namespace}`);
    }
  } else {
    console.log("✅ HuggingFace token secret exists");
  }
  
  // ============================================
  // Step 2: Model and deployment configuration
  // ============================================
  console.log("\n[2/6] Model & Deployment Configuration...");
  
  // Model selection
  const { model } = await inquirer.prompt([{
    type: "input",
    name: "model",
    message: "Enter model name (HuggingFace format):",
    default: "nvidia/Llama-3.3-70B-Instruct-FP8",
  }]);
  const servedModelName = model; // API served name = model name
  
  // Deployment mode
  const { deploymentMode } = await inquirer.prompt([{
    type: "list",
    name: "deploymentMode",
    message: "Select deployment mode:",
    choices: [
      { name: "Aggregated (single worker, simpler)", value: "agg" },
      { name: "Disaggregated (prefill/decode separation, better throughput)", value: "disagg" },
    ],
    default: "agg",
  }]);
  
  // Parallelism configuration
  // Parallelism - different for agg vs disagg
  let tensorParallel, pipelineParallel, gpuCount;
  let prefillTP, prefillPP, prefillGpuCount;
  let decodeTP, decodePP, decodeGpuCount;
  const dataParallel = "1"; // DP는 Dynamo에서 replicas로 대체
  
  if (deploymentMode === "agg") {
    const parallelConfig = await inquirer.prompt([
      {
        type: "input",
        name: "tensorParallel",
        message: "Tensor Parallel Size (TP):",
        default: "4",
        validate: (input) => parseInt(input) > 0 ? true : "Must be > 0",
      },
      {
        type: "input",
        name: "pipelineParallel",
        message: "Pipeline Parallel Size (PP, usually 1):",
        default: "1",
        validate: (input) => parseInt(input) > 0 ? true : "Must be > 0",
      },
    ]);
    tensorParallel = parallelConfig.tensorParallel;
    pipelineParallel = parallelConfig.pipelineParallel;
    gpuCount = parseInt(tensorParallel) * parseInt(pipelineParallel);
    console.log(`  → GPUs per worker: ${gpuCount} (TP=${tensorParallel} × PP=${pipelineParallel})`);
  } else {
    // Disagg: prefill and decode can have different parallelism
    console.log("\n  Prefill worker parallelism:");
    const prefillConfig = await inquirer.prompt([
      {
        type: "input",
        name: "tp",
        message: "  Prefill TP (higher = faster prefill):",
        default: "2",
        validate: (input) => parseInt(input) > 0 ? true : "Must be > 0",
      },
      {
        type: "input",
        name: "pp",
        message: "  Prefill PP (usually 1):",
        default: "1",
        validate: (input) => parseInt(input) > 0 ? true : "Must be > 0",
      },
    ]);
    prefillTP = prefillConfig.tp;
    prefillPP = prefillConfig.pp;
    prefillGpuCount = parseInt(prefillTP) * parseInt(prefillPP);
    
    console.log("\n  Decode worker parallelism:");
    const decodeConfig = await inquirer.prompt([
      {
        type: "input",
        name: "tp",
        message: "  Decode TP (higher = more KV cache capacity):",
        default: "4",
        validate: (input) => parseInt(input) > 0 ? true : "Must be > 0",
      },
      {
        type: "input",
        name: "pp",
        message: "  Decode PP (usually 1):",
        default: "1",
        validate: (input) => parseInt(input) > 0 ? true : "Must be > 0",
      },
    ]);
    decodeTP = decodeConfig.tp;
    decodePP = decodeConfig.pp;
    decodeGpuCount = parseInt(decodeTP) * parseInt(decodePP);
    
    // For shared settings (Frontend etc), use decode as reference
    tensorParallel = decodeTP;
    pipelineParallel = decodePP;
    gpuCount = decodeGpuCount;
    
    console.log(`  → Prefill: ${prefillGpuCount} GPUs (TP=${prefillTP} × PP=${prefillPP})`);
    console.log(`  → Decode:  ${decodeGpuCount} GPUs (TP=${decodeTP} × PP=${decodePP})`);
  }
  
  // EKS: optional instance family selector
  let eksInstanceFamily = "";
  if (!isK8s) {
    const { instanceFamily } = await inquirer.prompt([{
      type: "input",
      name: "instanceFamily",
      message: "EKS GPU instance family (e.g., p5, g6e, g5) or leave empty for any:",
      default: "",
    }]);
    eksInstanceFamily = instanceFamily;
    if (eksInstanceFamily) {
      console.log(`  → Node selector: instance-family=${eksInstanceFamily}`);
    }
  }
  
  // ============================================
  // Step 3: Advanced features configuration
  // ============================================
  console.log("\n[3/6] Advanced Features Configuration...");
  
  // Expert Parallel (MoE models like DeepSeek-R1, Mixtral, etc.)
  const { enableExpertParallel } = await inquirer.prompt([{
    type: "confirm",
    name: "enableExpertParallel",
    message: "Enable Expert Parallel (EP)? (for MoE models: DeepSeek-R1, Mixtral, etc.)",
    default: false,
  }]);
  
  // KV Router
  const { enableKvRouter } = await inquirer.prompt([{
    type: "confirm",
    name: "enableKvRouter",
    message: "Enable KV Router (KV cache-aware routing for better cache hit)?",
    default: false,
  }]);
  
  let kvRouterConfig = {};
  if (enableKvRouter) {
    kvRouterConfig = await inquirer.prompt([
      {
        type: "input",
        name: "routerTemperature",
        message: "Router temperature (0.0 = deterministic, higher = more random):",
        default: "0.5",
      },
      {
        type: "input",
        name: "overlapScoreWeight",
        message: "KV overlap score weight (>1.0 prioritize TTFT, <1.0 prioritize ITL):",
        default: "1.0",
      },
    ]);
  }
  
  // KV Cache Offloading (KVBM)
  const { enableKvbm } = await inquirer.prompt([{
    type: "confirm",
    name: "enableKvbm",
    message: "Enable KV Cache Offloading (KVBM - offload GPU KV cache to CPU/Disk)?",
    default: false,
  }]);
  
  let kvbmConfig = {};
  if (enableKvbm) {
    // CPU cache (required for KVBM)
    const { cpuCacheGB } = await inquirer.prompt([{
      type: "input",
      name: "cpuCacheGB",
      message: "CPU pinned memory cache size (GB):",
      default: "100",
      validate: (input) => parseInt(input) > 0 ? true : "Must be > 0",
    }]);
    kvbmConfig.cpuCacheGB = cpuCacheGB;
    
    // Disk/SSD cache (optional tier 2)
    const { enableDiskCache } = await inquirer.prompt([{
      type: "confirm",
      name: "enableDiskCache",
      message: "Enable Disk/SSD offloading (GPU → CPU → Disk tiered cache)?",
      default: false,
    }]);
    
    if (enableDiskCache) {
      const diskConfig = await inquirer.prompt([
        {
          type: "input",
          name: "diskCacheGB",
          message: "Disk cache size (GB):",
          default: "200",
        },
        {
          type: "input",
          name: "diskCacheDir",
          message: "Disk cache directory (use fast SSD/NVMe path):",
          default: isK8s ? "/tmp" : "/mnt/nvme/kvbm_cache",
        },
        {
          type: "confirm",
          name: "enableDiskFilter",
          message: "Enable disk offload frequency filter (recommended for SSD lifespan)?",
          default: true,
        },
      ]);
      kvbmConfig.diskCacheGB = diskConfig.diskCacheGB;
      kvbmConfig.diskCacheDir = diskConfig.diskCacheDir;
      kvbmConfig.disableDiskFilter = !diskConfig.enableDiskFilter;
      // zerofill is only needed for network filesystems (NFS/EFS/Lustre)
      // Disk cache should always be on local SSD, so this is almost never needed
      kvbmConfig.zerofillFallback = false;
    } else {
      kvbmConfig.diskCacheGB = "0";
    }
  }
  
  // Model cache storage (always enabled - required for model persistence)
  const enableModelCache = true;
  let modelCacheConfig = {};
  let preDownloadModel = false;
  
  const pvcName = "dynamo-model-cache";
  const pvcExists = await isModelCachePvcExist(namespace, pvcName);
  
  if (!pvcExists) {
    const { cacheSize } = await inquirer.prompt([{
      type: "input",
      name: "cacheSize",
      message: "Model cache PVC size:",
      default: "500Gi",
    }]);
    modelCacheConfig = { pvcName, cacheSize, createPvc: true };
    preDownloadModel = true;
    console.log("  → New PVC: model will be pre-downloaded before deployment");
  } else {
    console.log(`  ✅ Model cache PVC '${pvcName}' already exists`);
    modelCacheConfig = { pvcName, createPvc: false };
    
    // Auto-detect: check if model already exists in PVC at /opt/models/<model>/
    console.log(`  Checking if model '${model}' is cached in PVC...`);
    try {
      const checkPodName = `model-check-${Date.now().toString(36)}`;
      const checkResult = await $`kubectl run ${checkPodName} --rm -i --restart=Never --image=busybox \
        --overrides=${JSON.stringify({
          spec: {
            tolerations: [{ key: "nvidia.com/gpu", operator: "Exists", effect: "NoSchedule" }],
            containers: [{
              name: checkPodName,
              image: "busybox",
              command: ["sh", "-c", `ls /opt/models/${model}/*.safetensors 2>/dev/null && echo MODEL_EXISTS || echo MODEL_MISSING`],
              volumeMounts: [{ name: "cache", mountPath: "/opt/models" }],
            }],
            volumes: [{ name: "cache", persistentVolumeClaim: { claimName: pvcName } }],
          },
        })} \
        -n ${namespace}`.quiet();
      
      // --rm -i: output comes directly from stdout of kubectl run
      const output = checkResult.stdout;
      if (output.includes("MODEL_EXISTS")) {
        console.log("  ✅ Model already cached in PVC. Skipping download.");
        preDownloadModel = false;
      } else {
        console.log("  ⚠️  Model not found in PVC. Will pre-download.");
        preDownloadModel = true;
      }
    } catch (e) {
      // Check pod might have failed or timed out
      const output = e?.stdout || "";
      if (output.includes("MODEL_EXISTS")) {
        console.log("  ✅ Model already cached in PVC. Skipping download.");
        preDownloadModel = false;
      } else {
        console.log("  ⚠️  Could not verify model cache. Will pre-download to be safe.");
        preDownloadModel = true;
      }
    }
  }
  
  // Worker replicas
  let prefillReplicas = 1;
  let decodeReplicas = 1;
  let aggReplicas = 1;
  
  if (deploymentMode === "disagg") {
    const scalingConfig = await inquirer.prompt([
      {
        type: "input",
        name: "prefillReplicas",
        message: `Prefill worker replicas (each gets ${prefillGpuCount} GPUs):`,
        default: "1",
      },
      {
        type: "input",
        name: "decodeReplicas",
        message: `Decode worker replicas (each gets ${decodeGpuCount} GPUs):`,
        default: "1",
      },
    ]);
    prefillReplicas = parseInt(scalingConfig.prefillReplicas);
    decodeReplicas = parseInt(scalingConfig.decodeReplicas);
  } else {
    const { replicas } = await inquirer.prompt([{
      type: "input",
      name: "replicas",
      message: `Worker replicas (each gets ${gpuCount} GPUs, total GPUs = replicas × ${gpuCount}):`,
      default: enableKvRouter ? "2" : "1",
    }]);
    aggReplicas = parseInt(replicas);
  }
  
  // Additional vLLM args
  const { additionalArgs } = await inquirer.prompt([{
    type: "input",
    name: "additionalArgs",
    message: "Additional vLLM args (optional, e.g., --max-model-len 32768):",
    default: "--gpu-memory-utilization 0.90 --block-size 128",
  }]);
  
  // Image tag
  const { imageTag } = await inquirer.prompt([{
    type: "input",
    name: "imageTag",
    message: "vLLM runtime image tag:",
    default: "0.9.0",
  }]);
  
  // ============================================
  // Monitoring: Dynamo Operator handles metrics automatically
  // when prometheusEndpoint is configured on the platform.
  // DYN_SYSTEM_PORT is set by the Operator (default: 9090).
  // ============================================
  let enableStructuredLogging = false;
  
  try {
    const promCrd = await $`kubectl get crd podmonitors.monitoring.coreos.com`.quiet();
    if (promCrd.exitCode === 0) {
      console.log("\n✅ Prometheus detected - Dynamo Operator will auto-configure metrics/health probes.");
    }
  } catch {
    // Prometheus not available
  }
  
  const { wantStructuredLogging } = await inquirer.prompt([{
    type: "confirm",
    name: "wantStructuredLogging",
    message: "Enable structured logging (JSONL format, for Loki/log aggregation)?",
    default: false,
  }]);
  enableStructuredLogging = wantStructuredLogging;
  
  // ============================================
  // Ingress: detect and ask
  // ============================================
  let enableIngress = false;
  let ingressClass = "";
  let ingressPath = "";
  
  try {
    const icResult = await $`kubectl get ingressclass -o jsonpath='{.items[0].metadata.name}'`.quiet();
    const detectedClass = icResult.stdout.trim().replace(/'/g, "");
    if (detectedClass) {
      console.log(`\n✅ Ingress controller detected: ${detectedClass}`);
      const { wantIngress } = await inquirer.prompt([{
        type: "confirm",
        name: "wantIngress",
        message: "Create Ingress for Frontend API? (no port-forward needed)",
        default: true,
      }]);
      enableIngress = wantIngress;
      
      if (enableIngress) {
        const ingressAnswers = await inquirer.prompt([
          {
            type: "input",
            name: "ingressClass",
            message: "Ingress class:",
            default: detectedClass,
          },
          {
            type: "input",
            name: "ingressPath",
            message: "Ingress path prefix (e.g., /v1 or /qwen3):",
            default: "/v1",
          },
        ]);
        ingressClass = ingressAnswers.ingressClass;
        ingressPath = ingressAnswers.ingressPath;
      }
    }
  } catch {
    // No ingress controller
  }
  
  // ============================================
  // Step 4: Render deployment template
  // ============================================
  console.log("\n[4/6] Rendering deployment template...");
  
  // Generate deployment name
  // Deployment name must be ≤27 chars (K8s pod name limit: 45 - 17 for "vllmprefillworker" suffix - 1)
  const defaultName = model.split("/").pop().toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 20);
  const { deploymentName } = await inquirer.prompt([{
    type: "input",
    name: "deploymentName",
    message: "Deployment name (max 27 chars, lowercase alphanumeric + hyphens):",
    default: defaultName,
    validate: (input) => {
      if (input.length > 27) return `Too long (${input.length}/27). Shorten it.`;
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(input)) return "Must be lowercase alphanumeric with hyphens, no leading/trailing hyphens";
      return true;
    },
  }]);
  
  // Additional args as inline string (for shell command mode)
  const additionalArgsInline = additionalArgs || "";
  
  const modelLocalPath = `/opt/models/${model}`;  // e.g., /opt/models/nvidia/Qwen3-14B-FP8
  const modelShortName = model.split("/").pop().toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
  
  const templateVars = {
    // Basic
    DEPLOYMENT_NAME: deploymentName,
    MODEL: model,
    MODEL_LOCAL_PATH: modelLocalPath,
    SERVED_MODEL_NAME: servedModelName || model,
    IMAGE_TAG: imageTag,
    
    // Mode
    DEPLOYMENT_MODE: deploymentMode,
    IS_AGG: deploymentMode === "agg",
    IS_DISAGG: deploymentMode === "disagg",
    
    // Parallelism (agg uses these directly, disagg uses PREFILL_*/DECODE_*)
    TENSOR_PARALLEL: tensorParallel,
    PIPELINE_PARALLEL: pipelineParallel,
    DATA_PARALLEL: dataParallel,
    GPU_COUNT: gpuCount.toString(),
    ENABLE_PP: parseInt(pipelineParallel) > 1,
    ENABLE_DP: parseInt(dataParallel) > 1,
    
    // Disagg-specific parallelism
    PREFILL_TP: prefillTP || tensorParallel,
    PREFILL_PP: prefillPP || pipelineParallel,
    PREFILL_GPU_COUNT: (prefillGpuCount || gpuCount).toString(),
    PREFILL_ENABLE_PP: parseInt(prefillPP || pipelineParallel) > 1,
    DECODE_TP: decodeTP || tensorParallel,
    DECODE_PP: decodePP || pipelineParallel,
    DECODE_GPU_COUNT: (decodeGpuCount || gpuCount).toString(),
    DECODE_ENABLE_PP: parseInt(decodePP || pipelineParallel) > 1,
    
    // Expert Parallel (MoE)
    ENABLE_EP: enableExpertParallel,
    
    // Replicas
    AGG_REPLICAS: aggReplicas,
    PREFILL_REPLICAS: prefillReplicas,
    DECODE_REPLICAS: decodeReplicas,
    
    // KV Router
    ENABLE_KV_ROUTER: enableKvRouter,
    ROUTER_TEMPERATURE: kvRouterConfig.routerTemperature || "0.5",
    OVERLAP_SCORE_WEIGHT: kvRouterConfig.overlapScoreWeight || "1.0",
    
    // KVBM
    ENABLE_KVBM: enableKvbm,
    KVBM_CPU_CACHE_GB: kvbmConfig.cpuCacheGB || "0",
    KVBM_DISK_CACHE_GB: kvbmConfig.diskCacheGB || "0",
    ENABLE_KVBM_DISK: enableKvbm && parseInt(kvbmConfig.diskCacheGB || "0") > 0,
    KVBM_DISK_CACHE_DIR: kvbmConfig.diskCacheDir || "/tmp",
    KVBM_DISABLE_DISK_FILTER: kvbmConfig.disableDiskFilter || false,
    KVBM_ZEROFILL_FALLBACK: kvbmConfig.zerofillFallback || false,
    // KVBM memory: CPU cache + 20GB overhead for vLLM engine + OS
    KVBM_MEMORY_REQUEST: enableKvbm ? `${parseInt(kvbmConfig.cpuCacheGB || "0") + 16}Gi` : "16Gi",
    KVBM_MEMORY_LIMIT: enableKvbm ? `${parseInt(kvbmConfig.cpuCacheGB || "0") + 32}Gi` : "64Gi",
    
    // Model Cache
    ENABLE_MODEL_CACHE: enableModelCache,
    MODEL_CACHE_PVC_NAME: modelCacheConfig.pvcName || "",
    MODEL_CACHE_SIZE: modelCacheConfig.cacheSize || "500Gi",
    CREATE_MODEL_CACHE_PVC: modelCacheConfig.createPvc || false,
    
    // Additional args (inline for shell command)
    ADDITIONAL_ARGS_INLINE: additionalArgsInline,
    
    // Monitoring
    ENABLE_STRUCTURED_LOGGING: enableStructuredLogging,
    
    // Ingress
    ENABLE_INGRESS: enableIngress,
    INGRESS_CLASS: ingressClass,
    INGRESS_PATH: ingressPath,
    NAMESPACE: namespace,
    
    // Platform
    IS_K8S: isK8s,
    IS_EKS: !isK8s,
    STORAGE_CLASS: storageClass,
    GPU_NODE_SELECTOR_KEY: isK8s 
      ? (config?.platform?.k8s?.gpuNodeSelectorKey || "nvidia.com/gpu.present")
      : (config?.platform?.eks?.gpuNodeSelectorKey || "nvidia.com/gpu.present"),
    GPU_NODE_SELECTOR_VALUE: isK8s 
      ? (config?.platform?.k8s?.gpuNodeSelectorValue || "true")
      : (config?.platform?.eks?.gpuNodeSelectorValue || "true"),
    EKS_INSTANCE_FAMILY: eksInstanceFamily,
  };
  
  // Read and render template
  const templatePath = path.join(DIR, "deploy.template.yaml");
  const renderedPath = path.join(DIR, `${deploymentName}.generated.yaml`);
  const templateString = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateString);
  const renderedYaml = template(templateVars);
  
  fs.writeFileSync(renderedPath, renderedYaml);
  
  console.log(`\n✅ Deployment YAML generated: ${renderedPath}`);
  
  // ============================================
  // Step 5: Review and Deploy
  // ============================================
  console.log("\n[5/6] Review and Deploy...");
  
  // Summary
  console.log("\n========================================");
  console.log("Deployment Summary");
  console.log("========================================");
  console.log(`  Name:           ${deploymentName}`);
  console.log(`  Model:          ${model}`);
  console.log(`  Mode:           ${deploymentMode}`);
  if (deploymentMode === "agg") {
    console.log(`  Parallelism:    TP=${tensorParallel}, PP=${pipelineParallel}`);
    console.log(`  GPUs/worker:    ${gpuCount}`);
    console.log(`  Workers:        ${aggReplicas} replica(s)`);
  } else {
    console.log(`  Prefill:        TP=${prefillTP}, PP=${prefillPP} (${prefillGpuCount} GPUs × ${prefillReplicas} replicas)`);
    console.log(`  Decode:         TP=${decodeTP}, PP=${decodePP} (${decodeGpuCount} GPUs × ${decodeReplicas} replicas)`);
  }
  console.log(`  Expert Parallel: ${enableExpertParallel ? "Enabled (MoE)" : "Disabled"}`);
  console.log(`  KV Router:      ${enableKvRouter ? "Enabled" : "Disabled"}`);
  if (enableKvbm) {
    let kvbmSummary = `CPU: ${kvbmConfig.cpuCacheGB}GB`;
    if (parseInt(kvbmConfig.diskCacheGB || "0") > 0) {
      kvbmSummary += `, Disk: ${kvbmConfig.diskCacheGB}GB (${kvbmConfig.diskCacheDir})`;
      kvbmSummary += kvbmConfig.disableDiskFilter ? " [filter OFF]" : " [filter ON]";
    }
    console.log(`  KV Offloading:  Enabled (${kvbmSummary})`);
  } else {
    console.log(`  KV Offloading:  Disabled`);
  }
  console.log(`  Model Cache:    ${modelCacheConfig.pvcName} (${storageClass})`);
  console.log(`  Pre-Download:   ${preDownloadModel ? "Yes (will download before deploy)" : "No (vLLM downloads on startup)"}`);
  
  const { deployAction } = await inquirer.prompt([{
    type: "list",
    name: "deployAction",
    message: "What would you like to do?",
    choices: [
      { name: "Deploy now", value: "deploy" },
      { name: "Open generated YAML for review/edit first", value: "review" },
      { name: "Save YAML only (deploy later)", value: "save" },
    ],
    default: "deploy",
  }]);
  
  if (deployAction === "review") {
    console.log(`\nGenerated YAML saved to: ${renderedPath}`);
    console.log("\nYou can review and edit the file, then deploy with:");
    console.log(`  kubectl apply -f ${renderedPath} -n ${namespace}`);
    
    const { continueAfterReview } = await inquirer.prompt([{
      type: "confirm",
      name: "continueAfterReview",
      message: "Continue with deployment after review?",
      default: true,
    }]);
    
    if (!continueAfterReview) {
      return;
    }
  } else if (deployAction === "save") {
    console.log(`\nGenerated YAML saved to: ${renderedPath}`);
    console.log("\nTo deploy later, run:");
    console.log(`  kubectl apply -f ${renderedPath} -n ${namespace}`);
    return;
  }
  
  // Create model cache PVC if needed
  if (enableModelCache && modelCacheConfig.createPvc) {
    console.log("\nCreating model cache PVC...");
    // local-path only supports ReadWriteOnce; EFS/NFS supports ReadWriteMany
    const accessMode = storageClass === "local-path" ? "ReadWriteOnce" : "ReadWriteMany";
    const pvcYaml = `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${modelCacheConfig.pvcName}
  namespace: ${namespace}
spec:
  accessModes:
    - ${accessMode}
  storageClassName: ${storageClass}
  resources:
    requests:
      storage: ${modelCacheConfig.cacheSize}
`;
    await $`echo ${pvcYaml} | kubectl apply -f -`;
    console.log("✅ Model cache PVC created");
  }
  
  // Pre-download model if requested
  if (preDownloadModel && enableModelCache) {
    console.log("\n========================================");
    console.log("Model Pre-Download");
    console.log("========================================");
    console.log(`  Model: ${model}`);
    console.log(`  Target PVC: ${modelCacheConfig.pvcName}`);
    
    const hfSecretExists = await isHfTokenSecretExist(namespace);
    const downloadSuccess = await runModelDownloadJob(
      namespace, model, modelShortName, modelCacheConfig.pvcName, isK8s, hfSecretExists
    );
    
    if (!downloadSuccess) {
      const { continueAnyway } = await inquirer.prompt([{
        type: "confirm",
        name: "continueAnyway",
        message: "Model download may not have completed. Continue with deployment anyway?",
        default: false,
      }]);
      
      if (!continueAnyway) {
        console.log("\nDeployment cancelled. The generated YAML is saved at:");
        console.log(`  ${renderedPath}`);
        console.log("\nAfter the model is downloaded, deploy with:");
        console.log(`  kubectl apply -f ${renderedPath} -n ${namespace}`);
        return;
      }
    }
  }
  
  // Deploy
  console.log("\nDeploying...");
  await $`kubectl apply -f ${renderedPath} -n ${namespace}`;
  
  console.log("\n✅ Deployment created!");
  
  // Usage instructions - platform-specific
  const modelName = servedModelName || model;
  const frontendSvc = `${deploymentName}-frontend`;
  const internalUrl = `http://${frontendSvc}.${namespace}:8000/v1`;
  
  console.log("\n========================================");
  console.log("Next Steps");
  console.log("========================================");
  console.log("\n0. Watch pods until ready:");
  console.log(`   kubectl get pods -n ${namespace} | grep ${deploymentName}`);
  
  if (isK8s) {
    if (enableIngress) {
      console.log("\n1. Access via Ingress (find NodePort first):");
      console.log(`   kubectl get svc -n ingress-nginx`);
      console.log(`   # Look for PORT(S): 80:<NODE_PORT>/TCP`);
      console.log(`\n2. Test the API:`);
      console.log(`   curl http://<node-ip>:<node-port>${ingressPath}/chat/completions \\`);
      console.log(`     -H "Content-Type: application/json" \\`);
      console.log(`     -d '{"model": "${modelName}", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50}'`);
    } else {
      console.log("\n1. Port-forward the frontend service (after pods are ready):");
      console.log(`   kubectl port-forward svc/${frontendSvc} 8000:8000 -n ${namespace} --address 0.0.0.0 &`);
      console.log("\n2. Test the API:");
      console.log(`   curl localhost:8000/v1/chat/completions \\`);
      console.log(`     -H "Content-Type: application/json" \\`);
      console.log(`     -d '{"model": "${modelName}", "messages": [{"role": "user", "content": "Hello!"}], "max_tokens": 50}'`);
      console.log("\n3. Stop port-forward:");
      console.log(`   kill %1    # or: kill $(lsof -ti:8000)`);
    }
  } else {
    // EKS mode: internal URL for LiteLLM + optional external access
    console.log("\n  Internal service URL (for LiteLLM / other in-cluster services):");
    console.log(`   ${internalUrl}`);
    console.log("\n1. Add to LiteLLM (if installed):");
    console.log(`   Model name: dynamo/${deploymentName}`);
    console.log(`   API base:   ${internalUrl}`);
    console.log("\n2. (Optional) Expose externally via LoadBalancer:");
    console.log(`   kubectl patch svc ${frontendSvc} -n ${namespace} \\`);
    console.log(`     -p '{"spec": {"type": "LoadBalancer"}}'`);
    console.log(`   # Then: kubectl get svc ${frontendSvc} -n ${namespace} -w`);
    console.log("\n3. (Optional) Port-forward for local testing:");
    console.log(`   kubectl port-forward svc/${frontendSvc} 8000:8000 -n ${namespace} &`);
  }
  
  console.log("\n4. Uninstall:");
  console.log(`   ./cli nvidia-platform dynamo-vllm uninstall`);
}

export async function uninstall() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s 
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  
  const namespace = platformConfig.namespace || "dynamo-system";
  
  console.log("\nListing Dynamo vLLM deployments...");
  
  try {
    const result = await $`kubectl get dynamographdeployment -n ${namespace} -o jsonpath='{.items[*].metadata.name}'`.quiet();
    const allDeployments = result.stdout.trim().split(" ").filter(d => d);
    const vllmDeployments = allDeployments.filter(d => d.startsWith("vllm-"));
    
    if (vllmDeployments.length === 0) {
      console.log("No vLLM deployments found.");
      return;
    }
    
    const { selectedDeployment } = await inquirer.prompt([{
      type: "list",
      name: "selectedDeployment",
      message: "Select deployment to remove:",
      choices: [...vllmDeployments, new inquirer.Separator(), "All vLLM deployments", "Cancel"],
    }]);
    
    if (selectedDeployment === "Cancel") {
      return;
    }
    
    const deploymentsToRemove = selectedDeployment === "All vLLM deployments" ? vllmDeployments : [selectedDeployment];
    
    if (selectedDeployment === "All vLLM deployments") {
      const { confirm } = await inquirer.prompt([{
        type: "confirm",
        name: "confirm",
        message: `Remove all ${vllmDeployments.length} vLLM deployment(s)?`,
        default: false,
      }]);
      if (!confirm) return;
    }
    
    for (const dep of deploymentsToRemove) {
      console.log(`Removing ${dep}...`);
      
      // K8s mode: kill port-forward processes
      if (isK8s) {
        try {
          await $`pkill -f "port-forward svc/${dep}-frontend"`.quiet();
          console.log(`  Stopped port-forward for ${dep}`);
        } catch {
          // No port-forward running, that's fine
        }
      }
      
      // Delete DGD
      await $`kubectl delete dynamographdeployment ${dep} -n ${namespace}`;
    }
    
    console.log("Deployment(s) removed.");
    
    // Clean up generated YAML files
    try {
      const generatedFiles = fs.readdirSync(DIR).filter(f => f.endsWith(".generated.yaml"));
      for (const f of generatedFiles) {
        fs.unlinkSync(path.join(DIR, f));
      }
      if (generatedFiles.length > 0) {
        console.log(`Cleaned up ${generatedFiles.length} generated YAML file(s).`);
      }
    } catch {}
    
    // Ask about PVC cleanup
    const { cleanupPvc } = await inquirer.prompt([{
      type: "confirm",
      name: "cleanupPvc",
      message: "Also remove model cache PVC (dynamo-model-cache)? (model data will be lost)",
      default: false,
    }]);
    
    if (cleanupPvc) {
      await $`kubectl delete pvc dynamo-model-cache -n ${namespace} --ignore-not-found`;
      console.log("Model cache PVC removed.");
    }
    
  } catch (e) {
    console.log("Error listing/removing deployments:", e.message);
  }
}
