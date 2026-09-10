"""Ray Serve wrapper for the workshop's GPU vLLM image (deepseek-r1-qwen3-8b on g6.xlarge / L4).

Each Serve replica runs the EXACT `vllm serve ...` the workshop's fixed GPU deployment uses
(components/llm-model/vllm/model-deepseek-r1-qwen3-8b.template.yaml), as a pod-local subprocess
(127.0.0.1:VLLM_PORT), and exposes an OpenAI-compatible proxy so Ray Serve can autoscale replicas
(1 GPU per replica). Uses the workshop's own stock vLLM (vllm/vllm-openai:v0.10.2), which serves
deepseek-r1-qwen3-8b cleanly — unlike Ray Serve LLM's build_openai_app on newer vLLM, which
mis-detokenizes this model. Faithful to the fixed pod (same CLI/flags), robust across requests.
"""
import os, json, time, logging, subprocess, urllib.request
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse
from ray import serve

logger = logging.getLogger("ray.serve")

# Defaults match the fixed GPU deployment sized for a single g6.xlarge (NVIDIA L4, 24 GB).
MODEL_PATH    = os.environ.get("MODEL_PATH", "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B")
SERVED_NAME   = os.environ.get("SERVED_MODEL_NAME", "deepseek-r1-qwen3-8b-ray")
GPU_MEM_UTIL  = os.environ.get("GPU_MEMORY_UTILIZATION", "0.90")
MAX_MODEL_LEN = os.environ.get("MAX_MODEL_LEN", "16384")   # 8B + KV must fit the L4's 24 GB
REASONING     = os.environ.get("REASONING_PARSER", "deepseek_r1")
VLLM_PORT     = int(os.environ.get("VLLM_PORT", "8100"))
NUM_GPUS      = float(os.environ.get("NUM_GPUS", "1"))
READY_TIMEOUT = int(os.environ.get("VLLM_READY_TIMEOUT", "1800"))

web = FastAPI()

@serve.deployment(
    name="deepseek",
    autoscaling_config={"min_replicas": 1, "max_replicas": 2, "target_ongoing_requests": 2},
    max_ongoing_requests=8,
    ray_actor_options={"num_gpus": NUM_GPUS},
    health_check_period_s=30,
    health_check_timeout_s=60,
)
@serve.ingress(web)
class VLLMGpuProxy:
    def __init__(self):
        self.base = f"http://127.0.0.1:{VLLM_PORT}"
        cmd = [
            "vllm", "serve", MODEL_PATH,
            f"--served-model-name={SERVED_NAME}",
            "--host=127.0.0.1", f"--port={VLLM_PORT}",
            "--trust-remote-code",
            f"--gpu-memory-utilization={GPU_MEM_UTIL}",
            f"--max-model-len={MAX_MODEL_LEN}",
            f"--reasoning-parser={REASONING}",
        ]
        logger.info("Launching vLLM subprocess: %s", " ".join(cmd))
        self.proc = subprocess.Popen(cmd, env={**os.environ})
        self._wait_ready(READY_TIMEOUT)
        self.client = httpx.AsyncClient(base_url=self.base,
                                        timeout=httpx.Timeout(600.0, connect=10.0))
        logger.info("vLLM ready; Ray Serve proxy online")

    def _wait_ready(self, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"vllm serve exited early rc={self.proc.returncode}")
            try:
                with urllib.request.urlopen(f"{self.base}/health", timeout=3) as r:
                    if r.status == 200:
                        return
            except Exception:
                pass
            time.sleep(5)
        raise RuntimeError(f"vLLM did not become ready within {timeout}s")

    async def check_health(self):
        if self.proc.poll() is not None:
            raise RuntimeError(f"vllm subprocess died rc={self.proc.returncode}")

    @web.get("/v1/models")
    async def models(self):
        r = await self.client.get("/v1/models")
        return Response(content=r.content, status_code=r.status_code,
                        media_type="application/json")

    @web.post("/v1/chat/completions")
    async def chat(self, request: Request):
        return await self._forward("/v1/chat/completions", request)

    @web.post("/v1/completions")
    async def completions(self, request: Request):
        return await self._forward("/v1/completions", request)

    async def _forward(self, path, request: Request):
        body = await request.body()
        stream = False
        try:
            stream = bool(json.loads(body or b"{}").get("stream", False))
        except Exception:
            pass
        if stream:
            async def gen():
                async with self.client.stream("POST", path, content=body,
                        headers={"content-type": "application/json"}) as resp:
                    async for chunk in resp.aiter_raw():
                        yield chunk
            return StreamingResponse(gen(), media_type="text/event-stream")
        r = await self.client.post(path, content=body,
                                   headers={"content-type": "application/json"})
        return Response(content=r.content, status_code=r.status_code,
                        media_type="application/json")


app = VLLMGpuProxy.bind()
