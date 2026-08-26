# Pre-baked image for serving vLLM models via Ray Serve LLM (ray.serve.llm:build_openai_app).
#
# Why this image exists: the base Ray "serve-ml-cuda" DLC image does NOT ship ray[llm] or vllm.
# The upstream Ray/vLLM workshops pip-install them at POD STARTUP, which adds several minutes to
# every pod start (initial deploy, each autoscaled replica, every restart). Baking them into the
# image once removes that cold-start penalty entirely.
#
# CUDA image => linux/amd64 only (there is no arm64 CUDA base). Build single-arch.
FROM public.ecr.aws/deep-learning-containers/ray:serve-ml-cuda-v1.3

USER root
# vLLM/Triton JIT-compile CUDA kernels at runtime and need a C compiler; without it the engine
# crashes with "Failed to find C compiler". Bake gcc in (the upstream workshop dnf-installs it at
# pod startup instead). CC is also set in the RayService env for Triton.
RUN dnf install -y -q gcc gcc-c++ make which && dnf clean all

# ray[llm] provides ray.serve.llm (build_openai_app); vllm is the inference engine.
# vllm must be new enough for the target model (Qwen3-30B-A3B-Instruct-2507-FP8 needs a 2025+ vLLM).
#
# IMPORTANT: install into the SAME Python interpreter that `ray` (and its compiled raylet) uses.
# The base image has multiple Pythons; a plain `python3 -m pip` can resolve to the wrong one
# (e.g. 3.13 vs the raylet's 3.12), which makes the raylet crash on startup ("node timed out
# during startup"). Extracting the interpreter from ray's shebang guarantees a match in any builder.
RUN RAY_PY="$(head -1 "$(command -v ray)" | sed 's/^#!//; s/ .*//')" && \
    echo "Installing into ray's interpreter: $RAY_PY" && \
    "$RAY_PY" -m pip install --no-cache-dir 'ray[llm]==2.56.1' 'vllm==0.22.0'
