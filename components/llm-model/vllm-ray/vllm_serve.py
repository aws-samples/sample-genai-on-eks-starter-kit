"""Ray Serve wrapper for the workshop's optimum-neuron qwen3-8b vLLM image.

Each Serve replica runs the EXACT `vllm serve ...` the workshop deployment uses,
as a pod-local subprocess (127.0.0.1:VLLM_PORT), and exposes an OpenAI-compatible
proxy so Ray Serve can autoscale replicas (1 per inf2 device = neuron_cores:2).
Faithful to the workshop pod (same CLI/flags) and robust across vLLM versions.
"""
import os, json, time, logging, subprocess, urllib.request
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse
from ray import serve

logger = logging.getLogger("ray.serve")

MODEL_PATH    = os.environ.get("MODEL_PATH", "/root/.cache/neuron/Qwen/Qwen3-8B")
SERVED_NAME   = os.environ.get("SERVED_MODEL_NAME", "qwen3-8b-neuron-ray")
TP            = os.environ.get("TENSOR_PARALLEL_SIZE", "2")
MAX_NUM_SEQS  = os.environ.get("MAX_NUM_SEQS", "2")
MAX_MODEL_LEN = os.environ.get("MAX_MODEL_LEN", "8192")
VLLM_PORT     = int(os.environ.get("VLLM_PORT", "8100"))
NEURON_CORES  = int(os.environ.get("NEURON_CORES", "2"))
READY_TIMEOUT = int(os.environ.get("VLLM_READY_TIMEOUT", "1800"))

web = FastAPI()

@serve.deployment(
    name="qwen3-neuron",
    autoscaling_config={"min_replicas": 1, "max_replicas": 2, "target_ongoing_requests": 2},
    max_ongoing_requests=8,
    ray_actor_options={"resources": {"neuron_cores": NEURON_CORES}},
    health_check_period_s=30,
    health_check_timeout_s=60,
)
@serve.ingress(web)
class VLLMNeuronProxy:
    def __init__(self):
        self.base = f"http://127.0.0.1:{VLLM_PORT}"
        cmd = [
            "vllm", "serve", MODEL_PATH,
            f"--served-model-name={SERVED_NAME}",
            "--host=127.0.0.1", f"--port={VLLM_PORT}",
            "--trust-remote-code",
            "--gpu-memory-utilization=0.90",
            "--enable-auto-tool-choice",
            "--tool-call-parser=hermes",
            "--reasoning-parser=qwen3",
            f"--tensor-parallel-size={TP}",
            f"--max-num-seqs={MAX_NUM_SEQS}",
            f"--max-model-len={MAX_MODEL_LEN}",
        ]
        logger.info("Launching vLLM subprocess: %s", " ".join(cmd))
        # NEURON_RT_VISIBLE_CORES format conflict: Ray's raylet parses it as a COMMA list of core IDs
        # (e.g. "0,1") to count neuron_cores, but optimum-neuron/vLLM needs the RANGE form ("0-1").
        # Ray sets the actor's env to the assigned comma list; convert it to a range for the child.
        _cores = os.environ.get("NEURON_RT_VISIBLE_CORES", "0,1")
        _ids = [int(x) for x in _cores.replace("-", ",").split(",") if x.strip() != ""]
        _range = f"{min(_ids)}-{max(_ids)}" if _ids else "0-1"
        _child_env = {**os.environ, "NEURON_RT_VISIBLE_CORES": _range}
        self.proc = subprocess.Popen(cmd, env=_child_env)
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


app = VLLMNeuronProxy.bind()
