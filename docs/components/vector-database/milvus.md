# Milvus

Cloud-native vector database built for scalable similarity search. Supports billion-scale vector search with GPU acceleration, hybrid search, and multi-tenancy.

| | |
|---|---|
| **Category** | vector-database |
| **Official Docs** | [Milvus Documentation](https://milvus.io/docs) |
| **CLI Install** | `./cli vector-database milvus install` |
| **CLI Uninstall** | `./cli vector-database milvus uninstall` |
| **Namespace** | `milvus` |

## Overview

Milvus is designed for large-scale vector workloads:
- **Billion-Scale**: Handles billions of vectors with efficient indexing
- **GPU Acceleration**: Optional GPU-based index building and search
- **Hybrid Search**: Combine vector similarity with scalar filtering
- **Multi-Index**: IVF_FLAT, IVF_SQ8, HNSW, ANNOY, and more
- **S3 Storage**: Uses Terraform-provisioned S3 bucket for object storage
- **Distributed Architecture**: Separate compute and storage layers

## Installation

### Prerequisites

Configure in `.env`:

```bash
MILVUS_USERNAME=admin
MILVUS_PASSWORD=your-password
```

### Install

```bash
./cli vector-database milvus install
```

The installer:
1. Provisions an S3 bucket via Terraform for object storage
2. Deploys Milvus via Helm chart with S3 backend
3. Creates Nginx basic auth secret for ingress
4. Configures ingress with domain (if set)

## Verification

```bash
# Check pods
kubectl get pods -n milvus

# Check service
kubectl get svc -n milvus

# Check ingress
kubectl get ingress -n milvus

# Port-forward for local access
kubectl port-forward svc/milvus 19530:19530 -n milvus --address 0.0.0.0 &
```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `MILVUS_USERNAME` | Username for ingress basic auth |
| `MILVUS_PASSWORD` | Password for ingress basic auth |
| `DOMAIN` | Domain for ingress (optional) |

### Infrastructure

Milvus uses Terraform to provision:
- S3 bucket for object storage (vector data, indexes)
- IAM roles via IRSA for S3 access

## Usage

### Python Client

```python
from pymilvus import connections, Collection, FieldSchema, CollectionSchema, DataType

# Connect
connections.connect(host="milvus.milvus", port="19530")

# Define schema
fields = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=768),
    FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=1024),
]
schema = CollectionSchema(fields, description="My collection")

# Create collection
collection = Collection("my_collection", schema)

# Insert data
collection.insert([
    [[0.1, 0.2, ...]],  # embeddings
    ["Hello world"],      # text
])

# Create index
collection.create_index("embedding", {
    "index_type": "HNSW",
    "metric_type": "COSINE",
    "params": {"M": 16, "efConstruction": 256}
})

# Search
collection.load()
results = collection.search(
    data=[[0.1, 0.2, ...]],
    anns_field="embedding",
    param={"metric_type": "COSINE", "params": {"ef": 64}},
    limit=5,
    output_fields=["text"]
)
```

## Troubleshooting

### Pods not starting

```bash
# Check all Milvus components
kubectl get pods -n milvus

# Milvus has multiple components: proxy, datanode, indexnode, querynode
kubectl describe pod -n milvus -l app.kubernetes.io/name=milvus
```

### S3 access issues

```bash
# Check IRSA configuration
kubectl describe sa -n milvus

# Check S3 bucket exists
aws s3 ls | grep milvus
```

### Ingress authentication issues

```bash
# Check auth secret
kubectl get secret -n milvus

# Regenerate auth
htpasswd -nb <username> <password>
```

## Learn More

- [Milvus Documentation](https://milvus.io/docs)
- [Milvus GitHub](https://github.com/milvus-io/milvus)
- [PyMilvus SDK](https://github.com/milvus-io/pymilvus)
- [Milvus Helm Chart](https://github.com/milvus-io/milvus-helm)
