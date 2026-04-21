# MLflow

Open-source platform for managing the end-to-end machine learning lifecycle, including experiment tracking, model registry, and deployment. Provides a centralized tracking server for logging metrics, parameters, and artifacts.

| | |
|---|---|
| **Category** | observability |
| **Official Docs** | [MLflow Documentation](https://mlflow.org/docs/latest) |
| **CLI Install** | `./cli o11y mlflow install` |
| **CLI Uninstall** | `./cli o11y mlflow uninstall` |
| **Namespace** | `mlflow` |

## Overview

MLflow provides comprehensive ML lifecycle management:
- **Experiment Tracking**: Log parameters, metrics, and artifacts
- **Model Registry**: Version and stage ML models
- **Model Serving**: Deploy models as REST endpoints
- **S3 Artifact Storage**: Uses Terraform-provisioned S3 bucket
- **Web UI**: Visual experiment comparison and analysis

## Installation

### Prerequisites

Configure in `.env`:

```bash
MLFLOW_USERNAME=admin
MLFLOW_PASSWORD=your-password
```

### Install

```bash
./cli o11y mlflow install
```

The installer:
1. Provisions an S3 bucket via Terraform for artifact storage
2. Adds the community Helm chart repository
3. Renders Helm values with credentials and bucket configuration
4. Deploys MLflow to the `mlflow` namespace

## Verification

```bash
# Check pods
kubectl get pods -n mlflow

# Check service
kubectl get svc -n mlflow

# Port-forward for UI access
kubectl port-forward svc/mlflow 5000:5000 -n mlflow --address 0.0.0.0 &

# Access MLflow UI
open http://localhost:5000
```

Log in with `MLFLOW_USERNAME` and `MLFLOW_PASSWORD`.

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `MLFLOW_USERNAME` | Admin username |
| `MLFLOW_PASSWORD` | Admin password |
| `DOMAIN` | Domain for ingress (optional) |

### Infrastructure

MLflow uses Terraform to provision:
- S3 bucket for artifact storage (models, datasets, logs)
- IAM roles via IRSA for S3 access

## Usage

### Python SDK

```python
import mlflow

mlflow.set_tracking_uri("http://mlflow.mlflow:5000")
mlflow.set_experiment("my-experiment")

with mlflow.start_run():
    mlflow.log_param("model", "qwen3-30b-instruct-fp8")
    mlflow.log_metric("accuracy", 0.95)
    mlflow.log_artifact("output.json")
```

### Model Registry

```python
# Register a model
mlflow.register_model("runs:/<run-id>/model", "my-model")

# Load a registered model
model = mlflow.pyfunc.load_model("models:/my-model/Production")
```

## Troubleshooting

### UI not loading

```bash
# Check pod status
kubectl get pods -n mlflow

# Check logs
kubectl logs -n mlflow -l app=mlflow
```

### Artifact upload fails

```bash
# Check S3 bucket access
kubectl exec -it -n mlflow <mlflow-pod> -- aws s3 ls s3://<bucket-name>/

# Check IRSA configuration
kubectl describe sa -n mlflow mlflow
```

## Learn More

- [MLflow Documentation](https://mlflow.org/docs/latest)
- [MLflow GitHub](https://github.com/mlflow/mlflow)
- [MLflow Tracking](https://mlflow.org/docs/latest/tracking.html)
- [MLflow Model Registry](https://mlflow.org/docs/latest/model-registry.html)
