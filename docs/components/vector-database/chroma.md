# Chroma

Open-source AI-native embedding database designed for simplicity. Provides an easy-to-use API for storing and querying embeddings with automatic embedding generation support.

| | |
|---|---|
| **Category** | vector-database |
| **Official Docs** | [Chroma Documentation](https://docs.trychroma.com) |
| **CLI Install** | `./cli vector-database chroma install` |
| **CLI Uninstall** | `./cli vector-database chroma uninstall` |
| **Namespace** | `chroma` |

## Overview

Chroma is designed for developer productivity:
- **Simple API**: Minimal boilerplate for storing and querying embeddings
- **Auto Embeddings**: Built-in embedding function support
- **Metadata Filtering**: Filter results by document metadata
- **Multi-Modal**: Support for text, images, and more
- **Persistent Storage**: Durable storage with automatic persistence

## Installation

```bash
./cli vector-database chroma install
```

The installer:
1. Adds the Chroma Helm chart repository
2. Renders Helm values
3. Deploys ChromaDB via Helm to the `chroma` namespace

No additional environment variables are required.

## Verification

```bash
# Check pods
kubectl get pods -n chroma

# Check service
kubectl get svc -n chroma

# Port-forward for local access
kubectl port-forward svc/chroma-chromadb 8000:8000 -n chroma --address 0.0.0.0 &

# Check API
curl http://localhost:8000/api/v1/heartbeat

# List collections
curl http://localhost:8000/api/v1/collections
```

## Usage

### Python Client

```python
import chromadb

client = chromadb.HttpClient(host="chroma-chromadb.chroma", port=8000)

# Create collection
collection = client.create_collection("my-collection")

# Add documents (auto-generates embeddings)
collection.add(
    documents=["Hello world", "How are you?"],
    ids=["doc1", "doc2"],
    metadatas=[{"source": "greeting"}, {"source": "greeting"}]
)

# Query
results = collection.query(
    query_texts=["Hi there"],
    n_results=2
)
```

### With Custom Embeddings (TEI)

```python
import chromadb
import requests

def get_embeddings(texts):
    response = requests.post(
        "http://tei.tei:8080/v1/embeddings",
        json={"model": "qwen3-embedding-06b-bf16-cpu", "input": texts}
    )
    return [d["embedding"] for d in response.json()["data"]]

client = chromadb.HttpClient(host="chroma-chromadb.chroma", port=8000)
collection = client.create_collection("my-collection")

embeddings = get_embeddings(["Hello world", "How are you?"])
collection.add(
    embeddings=embeddings,
    documents=["Hello world", "How are you?"],
    ids=["doc1", "doc2"]
)
```

## Troubleshooting

### Pod not starting

```bash
# Check pod events
kubectl describe pod -n chroma -l app=chromadb

# Check logs
kubectl logs -n chroma -l app=chromadb

# Check PVC
kubectl get pvc -n chroma
```

### Connection refused

```bash
# Verify service exists
kubectl get svc -n chroma

# Test connectivity
kubectl exec -it -n <app-namespace> <app-pod> -- \
  curl http://chroma-chromadb.chroma:8000/api/v1/heartbeat
```

## Learn More

- [Chroma Documentation](https://docs.trychroma.com)
- [Chroma GitHub](https://github.com/chroma-core/chroma)
- [Chroma Python Client](https://docs.trychroma.com/reference/py-client)
- [ChromaDB Helm Chart](https://github.com/amikos-tech/chromadb-chart)
