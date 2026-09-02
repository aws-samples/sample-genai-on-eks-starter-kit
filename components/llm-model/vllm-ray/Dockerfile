# Ray Serve + vLLM-Neuron (inf2) image for the autoscaling module (Track A: KubeRay).
#
# Built FROM the workshop's OWN inf2 vLLM image so the Ray-served model uses the EXACT same
# Neuron SDK / vLLM (0.10.2) / driver-compat as the fixed vllm/qwen3-8b-neuron deployment (same inf2
# host), and reuses that image's baked qwen3-8b weights + compiled Neuron artifacts (fast cold-start).
#
# Ray Serve (2.58) requires a newer fastapi/starlette than the image's vLLM 0.10.2 can tolerate
# (co-installing breaks vLLM's OpenAI server -> HTTP 500 on every route). So we ISOLATE Ray in its own
# virtualenv (/opt/rayvenv); the vLLM subprocess keeps the image's original Python + deps. vllm_serve.py
# (the Ray Serve replica) runs under /opt/rayvenv and launches the workshop's exact `vllm serve` as a
# pod-local subprocess via the image's /usr/local/bin/vllm (shebang -> image Python), so the two never clash.
#
# The Neuron base is linux/amd64 ONLY (inf2 hosts are amd64; there is no arm64 Neuron base) — build amd64.
FROM public.ecr.aws/agentic-ai-platforms-on-k8s/vllm-neuron:qwen3-8b-optimum-neuron

USER root

# The base image's Python has no ensurepip, so seed the venv with `virtualenv` (not `python3 -m venv`).
RUN python3 -m pip install --no-cache-dir virtualenv && \
    virtualenv /opt/rayvenv && \
    /opt/rayvenv/bin/pip install --no-cache-dir "ray[serve]==2.58.0" "httpx>=0.27" jinja2

# Put the venv first on PATH so `ray`/`serve`/`python` resolve to it; `vllm` has no venv entry, so it
# still resolves to the image's /usr/local/bin/vllm (image Python) — keeping vLLM's deps isolated.
ENV PATH=/opt/rayvenv/bin:$PATH

# Serve app on PYTHONPATH (the RayService sets PYTHONPATH=/home/ray and import_path vllm_serve:app).
COPY vllm_serve.py /home/ray/vllm_serve.py

# Fail the build early if either side is broken: Ray must import under the venv, vLLM under image Python.
RUN PYTHONPATH=/home/ray /opt/rayvenv/bin/python -c "import ray; from ray import serve; import vllm_serve; print('rayvenv OK')" && \
    /usr/bin/python3 -c "import vllm, starlette; print('image vllm', vllm.__version__, 'starlette', starlette.__version__)"
