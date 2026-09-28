"""Fractional-GPU multi-model packing: two small models on ONE NVIDIA L4.

Used by the Track B module `ray-anyscale/ray-gpu-packing`.

WHY this exists
---------------
`vllm_serve.py` gives one 8B model a whole L4 (`num_gpus: 1`, ~90% of 24 GB). That is
correct for an 8B model — and it is also why average GPU utilization across a fleet is
notoriously low: most models are far smaller than the card they sit on.

This module packs TWO small models onto a single L4 by requesting a FRACTION of the GPU
per replica. Each replica still launches its own `vllm serve` subprocess, so the models
stay fully isolated; they simply share the device.

The three settings that must agree (getting this wrong is the classic failure):

  1. `ray_actor_options={"num_gpus": 0.49}`  -> Ray SCHEDULING. How much of the GPU Ray
     reserves for this replica. Use 0.49, not 0.5: scheduling overhead on a 0.5/0.5 split
     can leave no headroom and trip OOM.
  2. `--gpu-memory-utilization=0.40`         -> vLLM MEMORY. The fraction of TOTAL GPU
     memory this vLLM process pre-reserves. Independent of (1) — Ray's fraction does not
     limit vLLM's allocator. Keep (util x replicas-per-GPU) < 1.0 with headroom.
  3. Fixed replica counts                    -> Ray Serve docs: fractional-GPU deployments
     "work best with fixed replica counts rather than autoscaling", so we pin
     num_replicas instead of using autoscaling_config.

Budget on a 24 GB L4: 2 x 0.40 = 19.2 GB reserved, ~4.8 GB headroom for CUDA context,
framework overhead and fragmentation.

Models are small, ungated, and Qwen2-architecture (well supported by vLLM 0.10.2).
"""

import json
import logging
import os
import subprocess
import time
import urllib.request

import httpx
from fastapi import FastAPI
from ray import serve

logger = logging.getLogger("ray.serve")

# --- Per-model configuration -------------------------------------------------------
# Two DIFFERENT small models, so this demonstrates multi-model packing (the real
# production case) rather than just extra replicas of one model.
MODEL_A = os.environ.get("PACK_MODEL_A", "Qwen/Qwen2.5-0.5B-Instruct")
MODEL_B = os.environ.get("PACK_MODEL_B", "Qwen/Qwen2.5-1.5B-Instruct")
NAME_A = os.environ.get("PACK_NAME_A", "qwen2.5-0.5b")
NAME_B = os.environ.get("PACK_NAME_B", "qwen2.5-1.5b")

GPU_FRACTION = float(os.environ.get("PACK_GPU_FRACTION", "0.49"))  # Ray scheduling
GPU_MEM_UTIL = os.environ.get("PACK_GPU_MEM_UTIL", "0.40")         # vLLM memory
MAX_MODEL_LEN = os.environ.get("PACK_MAX_MODEL_LEN", "4096")
READY_TIMEOUT = int(os.environ.get("VLLM_READY_TIMEOUT", "1800"))

web = FastAPI(title="packed-models")


class _VLLMOnFractionalGPU:
    """Shared launcher: one `vllm serve` subprocess pinned to a fraction of the GPU."""

    def _start(self, model_path: str, served_name: str, port: int):
        self.base = f"http://127.0.0.1:{port}"
        cmd = [
            "vllm", "serve", model_path,
            f"--served-model-name={served_name}",
            "--host=127.0.0.1", f"--port={port}",
            "--trust-remote-code",
            # (2) vLLM's own memory reservation — the knob that actually decides whether
            #     two processes fit on one card.
            f"--gpu-memory-utilization={GPU_MEM_UTIL}",
            f"--max-model-len={MAX_MODEL_LEN}",
            # No CUDA graphs: less memory overhead, which matters when sharing a device.
            "--enforce-eager",
        ]
        logger.info("[pack] launching: %s", " ".join(cmd))
        self.proc = subprocess.Popen(cmd, env={**os.environ})
        deadline = time.time() + READY_TIMEOUT
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"vllm serve exited early rc={self.proc.returncode}")
            try:
                with urllib.request.urlopen(f"{self.base}/health", timeout=3) as r:
                    if r.status == 200:
                        break
            except Exception:
                pass
            time.sleep(5)
        else:
            raise RuntimeError(f"vLLM {served_name} not ready within {READY_TIMEOUT}s")
        self.client = httpx.AsyncClient(base_url=self.base,
                                        timeout=httpx.Timeout(600.0, connect=10.0))
        logger.info("[pack] %s ready on %s", served_name, self.base)

    async def check_health(self):
        if self.proc.poll() is not None:
            raise RuntimeError(f"vllm subprocess died rc={self.proc.returncode}")

    async def generate(self, body: dict) -> dict:
        r = await self.client.post("/v1/chat/completions", json=body)
        return json.loads(r.content)


# (1) Ray scheduling fraction + (3) FIXED replica count — no autoscaling_config here.
@serve.deployment(name="model-a", num_replicas=1,
                  ray_actor_options={"num_gpus": GPU_FRACTION},
                  health_check_period_s=30, health_check_timeout_s=60)
class ModelA(_VLLMOnFractionalGPU):
    def __init__(self):
        self._start(MODEL_A, NAME_A, int(os.environ.get("PACK_PORT_A", "8101")))


@serve.deployment(name="model-b", num_replicas=1,
                  ray_actor_options={"num_gpus": GPU_FRACTION},
                  health_check_period_s=30, health_check_timeout_s=60)
class ModelB(_VLLMOnFractionalGPU):
    def __init__(self):
        self._start(MODEL_B, NAME_B, int(os.environ.get("PACK_PORT_B", "8102")))


@serve.deployment(name="router", num_replicas=1, ray_actor_options={"num_cpus": 1})
@serve.ingress(web)
class PackRouter:
    """OpenAI-compatible front door that dispatches on the `model` field."""

    def __init__(self, model_a, model_b):
        self.handles = {NAME_A: model_a, NAME_B: model_b}

    @web.get("/v1/models")
    async def models(self):
        return {"object": "list",
                "data": [{"id": n, "object": "model", "owned_by": "vllm"} for n in self.handles]}

    @web.post("/v1/chat/completions")
    async def chat(self, body: dict):
        requested = body.get("model", NAME_A)
        handle = self.handles.get(requested)
        if handle is None:
            return {"error": {"message": f"unknown model '{requested}'; "
                                         f"available: {list(self.handles)}",
                              "type": "invalid_request_error"}}
        return await handle.generate.remote(body)


app = PackRouter.bind(model_a=ModelA.bind(), model_b=ModelB.bind())
