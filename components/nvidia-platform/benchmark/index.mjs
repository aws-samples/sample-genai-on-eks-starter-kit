#!/usr/bin/env zx

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import http from "http";
import handlebars from "handlebars";
import inquirer from "inquirer";
import { $ } from "zx";
$.verbose = true;

export const name = "AIPerf Benchmark";
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

async function getDeployedModels(namespace) {
  try {
    const result = await $`kubectl get dgd -n ${namespace} -o jsonpath='{.items[*].metadata.name}'`.quiet();
    return result.stdout.trim().replace(/'/g, "").split(" ").filter(d => d);
  } catch {
    return [];
  }
}

async function getFrontendService(namespace, dgdName) {
  try {
    const result = await $`kubectl get svc -n ${namespace} -l nvidia.com/dynamo-graph-deployment-name=${dgdName},nvidia.com/dynamo-component-type=frontend -o jsonpath='{.items[0].metadata.name}'`.quiet();
    return result.stdout.trim().replace(/'/g, "");
  } catch {
    return `${dgdName}-frontend`;
  }
}

async function getModelName(namespace, dgdName) {
  try {
    const result = await $`kubectl get pods -n ${namespace} -l nvidia.com/dynamo-graph-deployment-name=${dgdName},nvidia.com/dynamo-component-type=worker -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="SERVED_MODEL_NAME")].value}'`.quiet();
    return result.stdout.trim().replace(/'/g, "") || dgdName;
  } catch {
    return dgdName;
  }
}

async function extractResults(namespace, benchmarkName) {
  console.log("\nExtracting results from PVC...");
  const resultsDir = path.join(DIR, "results", benchmarkName);
  fs.mkdirSync(resultsDir, { recursive: true });
  
  const cpPod = `results-cp-${Date.now().toString(36)}`;
  const podYaml = `
apiVersion: v1
kind: Pod
metadata:
  name: ${cpPod}
  labels:
    app: benchmark-results-cp
spec:
  restartPolicy: Never
  containers:
    - name: cp
      image: busybox
      command: ["sleep", "300"]
      volumeMounts:
        - name: results
          mountPath: /data
  volumes:
    - name: results
      persistentVolumeClaim:
        claimName: benchmark-results
`;
  try {
    await $`echo ${podYaml} | kubectl apply -f - -n ${namespace}`;
    await $`kubectl wait --for=condition=ready pod/${cpPod} -n ${namespace} --timeout=60s`.quiet();
    
    const files = await $`kubectl exec ${cpPod} -n ${namespace} -- find /data/results/${benchmarkName} -type f 2>/dev/null`.quiet().nothrow();
    if (files.stdout.trim()) {
      console.log("\nPVC contents:");
      for (const f of files.stdout.trim().split("\n")) {
        console.log(`  ${f}`);
      }
    }
    
    // Copy to /tmp first then move (avoids vagrant shared folder issues)
    await $`kubectl cp ${namespace}/${cpPod}:/data/results/${benchmarkName} /tmp/bench-results-${benchmarkName}`.nothrow();
    await $`rm -rf ${resultsDir}`.quiet().nothrow();
    await $`mv /tmp/bench-results-${benchmarkName} ${resultsDir}`.quiet().nothrow();
    console.log(`\n📁 Results saved: ${resultsDir}`);
  } catch (e) {
    console.log(`⚠️  Result extraction error: ${e.message}`);
  }
  
  // Return cpPod name (caller is responsible for cleanup)
  console.log("\nCompleted Jobs auto-expire after 2h (ttlSecondsAfterFinished).");
  console.log("To check failed Jobs: kubectl get jobs -n " + namespace + " -l app=dynamo-benchmark");
  return cpPod;
}

async function getNumGpus(namespace, dgdName) {
  try {
    const result = await $`kubectl get dgd ${dgdName} -n ${namespace} -o json`.quiet();
    const dgd = JSON.parse(result.stdout);
    let totalGpus = 0;
    const services = dgd.spec?.services || {};
    for (const [, svc] of Object.entries(services)) {
      const replicas = svc.replicas || 1;
      const gpus = parseInt(svc.resources?.limits?.["nvidia.com/gpu"] || svc.resources?.requests?.["nvidia.com/gpu"] || "0", 10);
      totalGpus += replicas * gpus;
    }
    return totalGpus || 1;
  } catch {
    return 1;
  }
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: { "Content-Type": "text/plain" },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function pushMetricsToPushgateway(namespace, benchmarkName, mode, modelName, dgdName, pvcPod) {
  const numGpus = await getNumGpus(namespace, dgdName);
  console.log(`\nPushing metrics to Pushgateway (${numGpus} GPUs)...`);
  
  // Find concurrency directories in PVC
  const dirsResult = await $`kubectl exec ${pvcPod} -n ${namespace} -- sh -c ${`ls -d /data/results/${benchmarkName}/c* 2>/dev/null`}`.quiet().nothrow();
  if (!dirsResult.stdout.trim()) {
    console.log("⚠️  No concurrency directories found in PVC");
    return;
  }
  
  // Start port-forward to Pushgateway
  const pfProc = $`kubectl port-forward svc/pushgateway-prometheus-pushgateway 19091:9091 -n monitoring`.quiet().nothrow();
  await $`sleep 2`.quiet();
  
  let pushed = 0;
  try {
    for (const dir of dirsResult.stdout.trim().split("\n")) {
      const concurrencyRaw = dir.split("/").pop().replace(/^c/, "");
      const concurrency = concurrencyRaw.padStart(4, "0");
      const jsonPath = `${dir}/profile_export_aiperf.json`;
      
      // Read JSON directly from PVC pod
      const catResult = await $`kubectl exec ${pvcPod} -n ${namespace} -- cat ${jsonPath} 2>/dev/null`.quiet().nothrow();
      if (!catResult.stdout.trim()) continue;
      
      try {
        const data = JSON.parse(catResult.stdout);
        const get = (p, stat) => { let node = data; for (const k of p.split(".")) { node = node?.[k]; } return node?.[stat] ?? null; };
        
        const requestThroughput = get("request_throughput", "avg");
        const tokenThroughput = requestThroughput ? requestThroughput * (get("output_token_count", "avg") || 200) : null;
        const tpsPerGpu = tokenThroughput ? tokenThroughput / numGpus : null;
        
        const lines = [];
        const add = (name, value) => {
          if (value !== null && value !== undefined && !isNaN(value)) {
            lines.push(`${name}{benchmark="${benchmarkName}",concurrency="${concurrency}",mode="${mode}",model="${modelName}",num_gpus="${numGpus}"} ${value}`);
          }
        };
        
        add("benchmark_tps_per_gpu", tpsPerGpu);
        add("benchmark_tps_per_user", requestThroughput);
        add("benchmark_ttft_p50", get("time_to_first_token", "p50"));
        add("benchmark_ttft_p99", get("time_to_first_token", "p99"));
        add("benchmark_itl_p50", get("inter_token_latency", "p50"));
        add("benchmark_itl_p99", get("inter_token_latency", "p99"));
        add("benchmark_request_latency_p50", get("request_latency", "p50"));
        add("benchmark_request_latency_p99", get("request_latency", "p99"));
        
        if (lines.length > 0) {
          const body = lines.join("\n") + "\n";
          const jobLabel = `benchmark_${benchmarkName}_c${concurrency}`;
          const res = await httpPost(`http://127.0.0.1:19091/metrics/job/${jobLabel}`, body);
          if (res.status < 300) {
            pushed++;
          } else {
            console.log(`  ⚠️  c=${concurrency}: HTTP ${res.status} ${res.body}`);
          }
        }
      } catch (e) {
        console.log(`  ⚠️  c=${concurrency}: ${e.message}`);
      }
    }
  } finally {
    pfProc.kill();
  }
  
  if (pushed > 0) {
    console.log(`✅ Pushed ${pushed} concurrency levels to Pushgateway`);
    console.log("View in Grafana → Benchmark Pareto dashboard");
  } else {
    console.log("⚠️  No results found to push");
  }
}

async function runConcurrencySweep(namespace, benchmarkName, concLevels, template, baseVars, modeVars, { mode, modelName, dgdName } = {}) {
  console.log(`\nRunning ${concLevels.length} concurrency levels: ${concLevels.join(", ")}\n`);
  
  for (const conc of concLevels) {
    const jobSuffix = `c${conc}-${Date.now().toString(36)}`;
    const jobName = `benchmark-${benchmarkName}-${jobSuffix}`;
    
    const renderedYaml = template({
      ...baseVars,
      ...modeVars,
      JOB_SUFFIX: jobSuffix,
      CONCURRENCY: conc,
    });
    
    const renderedPath = path.join(DIR, `${jobName}.generated.yaml`);
    fs.writeFileSync(renderedPath, renderedYaml);
    
    console.log(`--- Concurrency ${conc} ---`);
    await $`kubectl apply -f ${renderedPath} -n ${namespace}`;
    console.log(`Job: ${jobName}`);
    
    try {
      await $`kubectl wait --for=condition=ready pod -l job-name=${jobName} -n ${namespace} --timeout=120s`.quiet().nothrow();
      await $`kubectl logs -f job/${jobName} -n ${namespace}`.nothrow();
      
      const status = await $`kubectl get job ${jobName} -n ${namespace} -o jsonpath='{.status.succeeded}'`.quiet();
      if (status.stdout.trim().replace(/'/g, "") === "1") {
        console.log(`✅ c=${conc} done\n`);
      } else {
        console.log(`⚠️  c=${conc} failed`);
        const logs = await $`kubectl logs job/${jobName} -n ${namespace} --tail=20`.quiet().nothrow();
        if (logs.stdout.trim()) console.log(logs.stdout);
      }
    } catch {
      console.log(`⚠️  c=${conc} timeout or error`);
    }
    
    fs.unlinkSync(renderedPath);
  }
  
  const cpPod = await extractResults(namespace, benchmarkName);
  
  if (mode && modelName && dgdName && cpPod) {
    try {
      await pushMetricsToPushgateway(namespace, benchmarkName, mode, modelName, dgdName, cpPod);
    } catch (e) {
      console.log(`⚠️  Pushgateway push error: ${e.message}`);
    }
  }
  
  // Cleanup PVC access pod
  if (cpPod) {
    await $`kubectl delete pod ${cpPod} -n ${namespace} --force --grace-period=0`.quiet().nothrow();
  }
  
  console.log(`\n✅ Benchmark complete!`);
}

export async function install() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  const namespace = platformConfig.namespace || "dynamo-system";
  const imageTag = (platformConfig.releaseVersion || "0.9.0-post1").replace(/-post\d+$/, "");
  
  console.log("\n========================================");
  console.log("AIPerf Benchmark");
  console.log("========================================\n");
  
  // List deployed models
  const deployedModels = await getDeployedModels(namespace);
  if (deployedModels.length === 0) {
    console.log("No DynamoGraphDeployments found. Deploy a model first.");
    return;
  }
  
  const { targetDgd } = await inquirer.prompt([{
    type: "list",
    name: "targetDgd",
    message: "Select deployment to benchmark:",
    choices: deployedModels,
  }]);
  
  const frontendSvc = await getFrontendService(namespace, targetDgd);
  const modelName = await getModelName(namespace, targetDgd);
  const endpointUrl = `http://${frontendSvc}.${namespace}:8000`;
  
  console.log(`  Model: ${modelName}`);
  console.log(`  Endpoint: ${endpointUrl}`);
  
  // Ensure benchmark-results PVC exists
  try {
    await $`kubectl get pvc benchmark-results -n ${namespace}`.quiet();
    console.log("  PVC: benchmark-results (exists)");
  } catch {
    console.log("  Creating benchmark-results PVC...");
    const storageClass = isK8s ? (config?.platform?.k8s?.storageClass || "nfs") : (config?.platform?.eks?.storageClass || "efs");
    const pvcYaml = `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: benchmark-results
spec:
  accessModes: ["ReadWriteMany"]
  storageClassName: "${storageClass}"
  resources:
    requests:
      storage: 10Gi
`;
    await $`echo ${pvcYaml} | kubectl apply -f - -n ${namespace}`;
    console.log("  ✅ PVC created");
  }
  
  // Benchmark mode
  const { benchmarkMode } = await inquirer.prompt([{
    type: "list",
    name: "benchmarkMode",
    message: "Benchmark mode:",
    choices: [
      { name: "Concurrency Sweep — throughput vs latency at different concurrency levels", value: "sweep" },
      { name: "Multi-Turn — multi-turn conversations (prefix cache reuse)", value: "multi-turn" },
      { name: "Sequence Distribution — mixed ISL/OSL workloads (summarization + QA)", value: "seq-dist" },
      { name: "Prefix Cache — synthetic shared-prefix workload (KV cache hit rate testing)", value: "prefix-cache" },
    ],
  }]);
  
  const { benchmarkName } = await inquirer.prompt([{
    type: "input",
    name: "benchmarkName",
    message: "Benchmark name:",
    default: `${targetDgd}-${benchmarkMode}`,
    validate: (input) => /^[a-zA-Z0-9_-]+$/.test(input) ? true : "Alphanumeric, hyphens, underscores only",
  }]);
  
  const templatePath = path.join(DIR, "benchmark-job.template.yaml");
  const templateString = fs.readFileSync(templatePath, "utf8");
  const template = handlebars.compile(templateString);
  
  const baseVars = {
    BENCHMARK_NAME: benchmarkName,
    BENCHMARK_MODE: benchmarkMode,
    ENDPOINT_URL: endpointUrl,
    MODEL: modelName,
    IMAGE_TAG: imageTag,
    IS_K8S: isK8s,
    IS_EKS: !isK8s,
  };
  
  // ========================================
  // Mode: Concurrency Sweep (baseline)
  // ========================================
  if (benchmarkMode === "sweep") {
    const params = await inquirer.prompt([
      { type: "input", name: "isl", message: "Input sequence length:", default: "2000" },
      { type: "input", name: "osl", message: "Output sequence length:", default: "256" },
      { type: "input", name: "concurrencies", message: "Concurrency levels:", default: "1,2,5,10,50,100,250" },
    ]);
    
    const concLevels = params.concurrencies.split(",").map(c => c.trim());
    await runConcurrencySweep(namespace, benchmarkName, concLevels, template, baseVars, {
      IS_SWEEP: true,
      ISL: params.isl,
      STD: "10",
      OSL: params.osl,
    }, { mode: benchmarkMode, modelName, dgdName: targetDgd });
  }
  
  // ========================================
  // Mode: Multi-Turn Conversations
  // ========================================
  if (benchmarkMode === "multi-turn") {
    const params = await inquirer.prompt([
      { type: "input", name: "turnMean", message: "Average turns per conversation:", default: "5" },
      { type: "input", name: "turnStddev", message: "Turn count stddev:", default: "2" },
      { type: "input", name: "numSessions", message: "Number of sessions:", default: "50" },
      { type: "input", name: "isl", message: "Input sequence length:", default: "500" },
      { type: "input", name: "osl", message: "Output sequence length:", default: "128" },
      { type: "input", name: "concurrencies", message: "Concurrency levels:", default: "1,2,5,10,50" },
    ]);
    
    console.log(`\nMulti-turn: ${params.turnMean}±${params.turnStddev} turns, ${params.numSessions} sessions`);
    console.log("KV Router routes same-session requests to same worker → lower TTFT\n");
    
    const concLevels = params.concurrencies.split(",").map(c => c.trim());
    await runConcurrencySweep(namespace, benchmarkName, concLevels, template, baseVars, {
      IS_MULTI_TURN: true,
      TURN_MEAN: params.turnMean,
      TURN_STDDEV: params.turnStddev,
      NUM_SESSIONS: params.numSessions,
      ISL: params.isl,
      OSL: params.osl,
    }, { mode: benchmarkMode, modelName, dgdName: targetDgd });
  }
  
  // ========================================
  // Mode: Sequence Distribution
  // ========================================
  if (benchmarkMode === "seq-dist") {
    console.log("\nSequence distribution format: ISL|STD,OSL|STD:PROB;...");
    console.log("Example presets:");
    console.log("  QA + Summary: 64|10,32|8:70;1024|100,256|50:30");
    console.log("  Code Gen:     256|50,512|100:60;1024|200,1024|200:40");
    console.log("  Mixed:        64|10,32|8:50;256|40,128|20:30;1024|100,512|50:20\n");
    
    const params = await inquirer.prompt([
      {
        type: "input",
        name: "seqDist",
        message: "Sequence distribution:",
        default: "64|10,32|8:70;1024|100,256|50:30",
      },
      { type: "input", name: "concurrencies", message: "Concurrency levels:", default: "1,2,5,10,50" },
    ]);
    
    console.log(`\nSequence distribution: ${params.seqDist}`);
    console.log("Tests mixed workload handling (short QA + long summarization)\n");
    
    const concLevels = params.concurrencies.split(",").map(c => c.trim());
    await runConcurrencySweep(namespace, benchmarkName, concLevels, template, baseVars, {
      IS_SEQ_DIST: true,
      SEQUENCE_DISTRIBUTION: params.seqDist,
    }, { mode: benchmarkMode, modelName, dgdName: targetDgd });
  }
  
  // ========================================
  // Mode: Prefix Cache (synthetic shared-prefix)
  // ========================================
  if (benchmarkMode === "prefix-cache") {
    console.log("\nPrefix Cache — synthetic shared-prefix workload (no trace file needed).");
    console.log("Generates N prefix prompts of fixed length. Each request picks one randomly");
    console.log("and appends a unique continuation. Simulates RAG / system-prompt scenarios.");
    console.log("  pool-size=10, prefix=512 → 10 unique 512-token prefixes, ~10% cache hit per prefix\n");
    
    const params = await inquirer.prompt([
      { type: "input", name: "prefixLength", message: "Shared prefix length (tokens):", default: "512" },
      { type: "input", name: "prefixPoolSize", message: "Prefix pool size (number of unique prefixes):", default: "10" },
      { type: "input", name: "isl", message: "Continuation length (tokens after prefix):", default: "128" },
      { type: "input", name: "osl", message: "Output sequence length:", default: "128" },
      { type: "input", name: "requestCount", message: "Requests per concurrency level:", default: "200" },
      { type: "input", name: "concurrencies", message: "Concurrency levels:", default: "1,2,5,10,50" },
    ]);
    
    console.log(`\nPrefix cache: ${params.prefixPoolSize} prefixes × ${params.prefixLength} tokens, continuation=${params.isl}, ${params.requestCount} requests/level`);
    
    const concLevels = params.concurrencies.split(",").map(c => c.trim());
    await runConcurrencySweep(namespace, benchmarkName, concLevels, template, baseVars, {
      IS_PREFIX_CACHE: true,
      PREFIX_LENGTH: params.prefixLength,
      PREFIX_POOL_SIZE: params.prefixPoolSize,
      ISL: params.isl,
      OSL: params.osl,
      REQUEST_COUNT: params.requestCount,
    }, { mode: benchmarkMode, modelName, dgdName: targetDgd });
  }
  
  // Pareto plot hint
  console.log("\n========================================");
  console.log("Pareto Plot (future)");
  console.log("========================================");
  console.log("To compare deployments, run same benchmark on different configs:");
  console.log("  1. Deploy agg baseline    → benchmark sweep → results/qwen3-agg/");
  console.log("  2. Deploy agg + kvrouter  → benchmark sweep → results/qwen3-kvrouter/");
  console.log("  3. Deploy agg + kvbm      → benchmark sweep → results/qwen3-kvbm/");
  console.log("  4. Deploy disagg + kvbm   → benchmark sweep → results/qwen3-disagg/");
  console.log("\nKey metrics per concurrency level:");
  console.log("  x-axis: request_throughput (tps/user)");
  console.log("  y-axis: token_throughput / num_gpus (tps/gpu)");
  console.log("  line: deployment config, data points: concurrency levels");
}

export async function uninstall() {
  const isK8s = utils.isK8sMode();
  const platformConfig = isK8s
    ? config?.platform?.k8s?.dynamoPlatform || {}
    : config?.platform?.eks?.dynamoPlatform || {};
  const namespace = platformConfig.namespace || "dynamo-system";
  
  console.log("\nCleaning up benchmark resources...");
  await $`kubectl delete jobs -n ${namespace} -l app=dynamo-benchmark --ignore-not-found`.nothrow();
  await $`kubectl delete pods -n ${namespace} -l app=benchmark-results-cp --force --grace-period=0 --ignore-not-found`.nothrow();
  
  const { deletePvc } = await inquirer.prompt([{
    type: "confirm",
    name: "deletePvc",
    message: "Delete benchmark-results PVC? (all benchmark data on PVC will be lost)",
    default: false,
  }]);
  if (deletePvc) {
    await $`kubectl delete pvc benchmark-results -n ${namespace} --ignore-not-found`.nothrow();
    console.log("PVC deleted.");
  }
  
  const resultsDir = path.join(DIR, "results");
  if (fs.existsSync(resultsDir)) {
    const { deleteResults } = await inquirer.prompt([{
      type: "confirm",
      name: "deleteResults",
      message: "Delete local benchmark results?",
      default: false,
    }]);
    if (deleteResults) {
      fs.rmSync(resultsDir, { recursive: true, force: true });
      console.log("Local results deleted.");
    }
  }
  
  console.log("Done.");
}
