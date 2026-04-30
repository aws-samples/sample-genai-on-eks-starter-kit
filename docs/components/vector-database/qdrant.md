# Qdrant

High-performance vector similarity search engine built in Rust. Provides fast and scalable vector storage with rich filtering, payload indexing, and a gRPC/REST API.

| | |
|---|---|
| **Category** | vector-database |
| **Official Docs** | [Qdrant Documentation](https://qdrant.tech/documentation) |
| **CLI Install** | `./cli vector-database qdrant install` |
| **CLI Uninstall** | `./cli vector-database qdrant uninstall` |
| **Namespace** | `qdrant` |

## Overview

Qdrant is the default vector database in the demo stack:
- **High Performance**: Written in Rust for maximum throughput and low latency
- **Rich Filtering**: Combine vector search with payload-based filters
- **Scalar & Binary Quantization**: Reduce memory usage while maintaining accuracy
- **Distributed Mode**: Horizontal scaling with sharding and replication
- **Snapshot & Backup**: Point-in-time snapshots for data protection
- **REST & gRPC APIs**: Full-featured APIs for all operations

## Installation

### Prerequisites

Configure in `.env`:

```bash
QDRANT_USERNAME=admin
QDRANT_PASSWORD=your-password
```

### Install

```bash
./cli vector-database qdrant install
```

The installer:
1. Adds the Qdrant Helm chart repository
2. Renders Helm values and deploys via Helm
3. Creates Nginx basic auth secret for ingress
4. Configures ingress with domain (if set)

## Verification

```bash
# Check pods
kubectl get pods -n qdrant

# Check service
kubectl get svc -n qdrant

# Check ingress
kubectl get ingress -n qdrant

# Port-forward for local access
kubectl port-forward svc/qdrant 6333:6333 -n qdrant --address 0.0.0.0 &

# Check cluster info
curl http://localhost:6333/cluster

# List collections
curl http://localhost:6333/collections
```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `QDRANT_USERNAME` | Username for ingress basic auth |
| `QDRANT_PASSWORD` | Password for ingress basic auth |
| `DOMAIN` | Domain for ingress (e.g., `qdrant.example.com`) |

## Usage

### Create a Collection

```bash
curl -X PUT http://localhost:6333/collections/my-collection \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'
```

### Insert Vectors

```bash
curl -X PUT http://localhost:6333/collections/my-collection/points \
  -H "Content-Type: application/json" \
  -d '{
    "points": [
      {
        "id": 1,
        "vector": [0.1, 0.2, ...],
        "payload": {"text": "Hello world"}
      }
    ]
  }'
```

### Search

```bash
curl -X POST http://localhost:6333/collections/my-collection/points/search \
  -H "Content-Type: application/json" \
  -d '{
    "vector": [0.1, 0.2, ...],
    "limit": 5,
    "with_payload": true
  }'
```

### Python Client

```python
from qdrant_client import QdrantClient

client = QdrantClient(url="http://qdrant.qdrant:6333")

# Create collection
client.create_collection(
    collection_name="my-collection",
    vectors_config={"size": 768, "distance": "Cosine"}
)

# Search
results = client.search(
    collection_name="my-collection",
    query_vector=[0.1, 0.2, ...],
    limit=5
)
```

## Integration with TEI

Use [TEI](../embedding-model/tei.md) to generate embeddings and store them in Qdrant:

```python
import requests
from qdrant_client import QdrantClient

# Generate embedding
response = requests.post(
    "http://tei.tei:8080/v1/embeddings",
    json={"model": "qwen3-embedding-06b-bf16-cpu", "input": "Hello world"}
)
embedding = response.json()["data"][0]["embedding"]

# Store in Qdrant
client = QdrantClient(url="http://qdrant.qdrant:6333")
client.upsert(
    collection_name="my-collection",
    points=[{"id": 1, "vector": embedding, "payload": {"text": "Hello world"}}]
)
```

## Troubleshooting

### Pod not starting

```bash
# Check pod events
kubectl describe pod -n qdrant -l app=qdrant

# Check PVC
kubectl get pvc -n qdrant

# Check logs
kubectl logs -n qdrant -l app=qdrant
```

### Ingress authentication issues

```bash
# Check auth secret exists
kubectl get secret -n qdrant

# Regenerate auth
htpasswd -nb <username> <password>
```

## Learn More

- [Qdrant Documentation](https://qdrant.tech/documentation)
- [Qdrant GitHub](https://github.com/qdrant/qdrant)
- [Qdrant Python Client](https://github.com/qdrant/qdrant-client)
- [Qdrant Helm Chart](https://github.com/qdrant/qdrant-helm)
