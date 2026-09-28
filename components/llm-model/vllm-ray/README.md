# vllm-ray — Ray Serve + vLLM serving image

Ray Serve applications layered onto the kit's own `vllm/vllm-openai:v0.10.2` image, so a
Ray-served model uses the **same vLLM** as the plain `vllm` component and detokenizes
`deepseek-r1-qwen3-8b` cleanly.

Published image (linux/amd64 only — there is no arm64 CUDA base):

```
public.ecr.aws/agentic-ai-platforms-on-k8s/ray-vllm-gpu
  tag        deepseek-r1-qwen3-8b
  immutable  sha-cbab1399
  digest     sha256:eec2aee90853b8bc9cd0f32c4a657a153862c1cf800d013a8a7d5ba0244200f9
```

It is ~11.6 GB, so manifests here pin the **digest** with `imagePullPolicy: IfNotPresent`.
A moving tag plus `Always` re-pulls the whole image on every reschedule.

## ⚠️ Prerequisite: the KubeRay operator

**This component does not install the KubeRay operator, and the kit does not install it
anywhere else.** `rayservice-deepseek-r1-qwen3-8b.yaml` is a `ray.io/v1 RayService`, so
without the operator its CRD is absent and the manifest cannot reconcile on a clean
cluster.

Install it first:

```bash
helm repo add kuberay https://ray-project.github.io/kuberay-helm/
helm repo update kuberay

helm upgrade --install kuberay-operator kuberay/kuberay-operator \
  --version 1.5.1 \
  --namespace ray-system --create-namespace

kubectl -n ray-system rollout status deploy/kuberay-operator --timeout=180s
```

The manifest also expects a `hf-token` secret in the `vllm` namespace for the model pull.

## What ships in the image

Three Ray Serve applications are baked in and selected per deployment via `import_path`:

| Application | Shape |
|---|---|
| `vllm_serve:app` | one GPU deployment owning a whole accelerator |
| `compose_app:app` | CPU gateway + guard in front of the GPU model, wired with `DeploymentHandle` |
| `pack_app:app` | two small models sharing one GPU at `num_gpus: 0.49` |

All three are **plain Ray Serve applications** — nothing about them is runtime-specific,
so any of them can be deployed by KubeRay by copying
`rayservice-deepseek-r1-qwen3-8b.yaml` and changing `import_path` (and, for `pack_app`,
giving the worker 3 CPUs so both model replicas plus the router fit).

**Only `vllm_serve:app` ships a manifest here today.** `compose_app` and `pack_app` are
currently image-only building blocks — a `RayService` for each is a reasonable addition.

## ⚠️ In-tree autoscaling needs the head's ServiceAccount token

`enableInTreeAutoscaling: true` makes KubeRay run an autoscaler **sidecar inside the head
pod**, and that sidecar authenticates to the API server with the head's ServiceAccount
token. Do **not** set `automountServiceAccountToken: false` on the head group.

This fails silently, which makes it expensive to debug: nothing crashes, the head keeps
serving at `min_replicas`, and scale-up simply never fires. The worker group has no such
sidecar, so it does set `automountServiceAccountToken: false`.

They are baked into the image rather than shipped via Anyscale's `working_dir`, because
`working_dir` activates Anyscale's session/file-sync machinery, which requires the
`anyscale` Python package in the image. This image is built `FROM vllm/vllm-openai` and
deliberately does not carry it — using `working_dir` with it fails with
`anyscale session web_terminal_server … exit status 127` and the `ray` container never
becomes ready.

`vllm_serve.py` is split into an undecorated `VLLMEngineBase` plus a decorated ingress
deployment. Ray Serve permits only **one** `@serve.ingress` (FastAPI) deployment per
application, so the composed graph binds the plain base class; binding the decorated one
fails with `Found multiple FastAPI deployments in application` while the cluster still
reports healthy.

## Building and publishing

```bash
export ECR_PUBLIC_ALIAS=agentic-ai-platforms-on-k8s   # omit to use the test default
./build-and-push.sh "$ECR_PUBLIC_ALIAS" deepseek-r1-qwen3-8b
```

The alias resolves from the positional argument, then `$ECR_PUBLIC_ALIAS`, then a test
default — so publishing under a different registry needs no file edit. The Dockerfile
runs an import check at build time and fails fast if either side is broken: Ray must
import under `/opt/rayvenv`, vLLM under the image's own Python.

## GPU capacity

The worker pins `node.kubernetes.io/instance-type: g6.xlarge` (1× NVIDIA L4, 24 GB).
`g6` and `g6e` are frequently capacity-constrained; where guaranteed capacity matters,
attach an On-Demand Capacity Reservation to `NodeClass/gpu` and allow the `reserved`
capacity type on `NodePool/gpu` (both provided by `terraform/modules/eks-auto-mode`).
