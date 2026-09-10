# Ray Serve + stock vLLM (GPU) image for the autoscaling module (deepseek-r1-qwen3-8b on g6.xlarge).
#
# Built FROM the workshop's OWN stock GPU vLLM image so the Ray-served model uses the EXACT same
# vLLM (0.10.2) as the fixed vllm/deepseek-r1-qwen3-8b deployment. Stock vLLM 0.10.2 detokenizes
# deepseek-r1-qwen3-8b CLEANLY (Ray Serve LLM's build_openai_app on newer vLLM 0.22 mis-detokenizes
# it -> Ġ/Ċ byte-BPE artifacts), so we wrap the workshop's own `vllm serve` instead.
#
# Ray Serve requires a newer fastapi/starlette than vLLM 0.10.2 tolerates (co-installing breaks vLLM's
# OpenAI server). So Ray is ISOLATED in its own virtualenv (/opt/rayvenv); the vLLM subprocess keeps
# the image's original Python + deps. vllm_serve.py (the Ray Serve replica) runs under /opt/rayvenv and
# launches the workshop's exact `vllm serve` as a pod-local subprocess via the image's /usr/local/bin/vllm.
#
# CUDA base is linux/amd64 ONLY (no arm64 CUDA base) — build single-arch amd64.
FROM vllm/vllm-openai:v0.10.2

USER root

# Ray goes in its OWN venv so it doesn't upgrade the fastapi/starlette that vLLM 0.10.2 depends on.
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
    /usr/bin/python3 -c "import vllm, starlette; print('image vllm', vllm.__version__, 'starlette', starlette.__version__)" || \
    python3 -c "import vllm; print('image vllm', vllm.__version__)"
