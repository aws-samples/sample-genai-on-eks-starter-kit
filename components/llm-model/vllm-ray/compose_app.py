"""Multi-deployment Ray Serve composition around the workshop's GPU vLLM proxy.

Used by the Track B module `ray-anyscale/ray-serve-composition`.

WHY this exists
---------------
`vllm_serve.py` serves ONE deployment: a GPU replica that owns a whole L4 and wraps
`vllm serve`. That is the right shape for "serve a model", but real endpoints do more
than call a model — they validate input, route, and post-process. Putting that work
*inside* the GPU replica is the classic mistake: cheap CPU work then occupies an
expensive accelerator, and it cannot scale independently of the model.

This module splits one endpoint into three deployments wired by `DeploymentHandle`:

    Gateway (CPU, ingress)
      ├─► Guard      (CPU)  reject / sanitize obvious junk before any GPU work
      └─► deepseek   (GPU)  the existing vLLM proxy replica, unchanged

Each deployment has its OWN replica count and resource request, so a spike in cheap
CPU work never consumes GPU, and the GPU replica count is driven only by real model
load. That is the whole point of Ray Serve over a single-process model server.

The GPU deployment is imported from `vllm_serve` — it is the SAME class the
autoscaling module uses, so this module changes the *topology*, not the model.
"""

import os

from fastapi import FastAPI
from ray import serve
from ray.serve.handle import DeploymentHandle

# The ENGINE (undecorated) from the autoscaling module. We deliberately import the
# base class, NOT the decorated `VLLMGpuProxy`: Ray Serve permits only ONE
# @serve.ingress (FastAPI) deployment per application, and `Gateway` below is that
# one. Binding the decorated proxy here fails at deploy time with:
#   "Found multiple FastAPI deployments in application ... Please only include one
#    deployment with @serve.ingress in your application to avoid this issue."
from vllm_serve import NUM_GPUS, VLLMEngineBase

SERVED_NAME = os.environ.get("SERVED_MODEL_NAME", "deepseek-r1-qwen3-8b-ray")
MAX_PROMPT_CHARS = int(os.environ.get("MAX_PROMPT_CHARS", "4000"))

web = FastAPI(title="composed-deepseek")


@serve.deployment(
    name="deepseek",
    # Same resources and autoscaling as the standalone module — only the ingress differs.
    autoscaling_config={"min_replicas": 1, "max_replicas": 2, "target_ongoing_requests": 2},
    max_ongoing_requests=8,
    ray_actor_options={"num_gpus": NUM_GPUS},
    health_check_period_s=30,
    health_check_timeout_s=60,
)
class DeepseekModel(VLLMEngineBase):
    """The GPU model as a NON-ingress deployment, callable only via DeploymentHandle."""


@serve.deployment(
    name="guard",
    # CPU-only and cheap, so it scales on its own curve — far more replicas than the
    # GPU deployment will ever have, at a fraction of the cost.
    autoscaling_config={"min_replicas": 1, "max_replicas": 4, "target_ongoing_requests": 20},
    ray_actor_options={"num_cpus": 1},
)
class Guard:
    """Deterministic input checks. No model call, therefore no GPU."""

    def check(self, prompt: str) -> dict:
        if not prompt or not prompt.strip():
            return {"ok": False, "reason": "empty prompt"}
        if len(prompt) > MAX_PROMPT_CHARS:
            return {"ok": False, "reason": f"prompt longer than {MAX_PROMPT_CHARS} chars"}
        return {"ok": True, "reason": ""}


@serve.deployment(
    name="gateway",
    autoscaling_config={"min_replicas": 1, "max_replicas": 4, "target_ongoing_requests": 20},
    ray_actor_options={"num_cpus": 1},
)
@serve.ingress(web)
class Gateway:
    """HTTP ingress that orchestrates guard -> model.

    WHY DeploymentHandle instead of calling the classes directly?
      A handle is a *reference to a deployment*, not an object. Calling
      `handle.method.remote(...)` routes the call to whichever replica of that
      deployment is least busy, across any node in the Ray cluster — which is what
      lets the two deployments scale independently.
    """

    def __init__(self, guard: DeploymentHandle, model: DeploymentHandle):
        self.guard = guard
        self.model = model

    @web.get("/healthz")
    async def healthz(self):
        return {"status": "ok", "topology": ["gateway(CPU)", "guard(CPU)", "deepseek(GPU)"]}

    @web.post("/v1/chat/completions")
    async def chat(self, body: dict):
        messages = body.get("messages") or []
        prompt = messages[-1].get("content", "") if messages else ""

        # Hop 1: CPU guard. Rejected requests never reach the GPU at all.
        verdict = await self.guard.check.remote(prompt)
        if not verdict["ok"]:
            return {"error": {"message": verdict["reason"], "type": "invalid_request_error"}}

        # Hop 2: GPU model. `body` is passed through untouched so the response stays
        # OpenAI-compatible for every existing client.
        body.setdefault("model", SERVED_NAME)
        return await self.model.chat_passthrough.remote(body)


# .bind() declares the graph at import time WITHOUT starting anything. Serve reads
# this object, sees the handle dependencies, and starts the deployments bottom-up,
# injecting real handles into Gateway's constructor.
app = Gateway.bind(
    guard=Guard.bind(),
    model=DeepseekModel.bind(),
)
