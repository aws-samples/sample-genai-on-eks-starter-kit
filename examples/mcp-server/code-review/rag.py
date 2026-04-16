"""RAG module: embedding, indexing, and retrieval via TEI + Qdrant."""

import os
import re
import time
import glob as globmod
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

TEI_BASE_URL = os.environ.get("TEI_BASE_URL", "http://qwen3-embedding-06b-bf16-cpu.tei:80")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant.qdrant:6333")
COLLECTION = os.environ.get("QDRANT_COLLECTION", "code-review")
VECTOR_DIM = 1024  # Qwen3-Embedding-0.6B output dimension
SAMPLE_CODE_DIR = os.path.join(os.path.dirname(__file__), "sample_code")

_tei_client = None
_qdrant_client = None


def _get_tei_client():
    global _tei_client
    if _tei_client is None:
        _tei_client = OpenAI(base_url=f"{TEI_BASE_URL}/v1", api_key="unused")
    return _tei_client


def _get_qdrant_client():
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = QdrantClient(url=QDRANT_URL)
    return _qdrant_client


def _embed(texts: list[str]) -> list[list[float]]:
    """Embed texts using TEI's OpenAI-compatible endpoint."""
    client = _get_tei_client()
    response = client.embeddings.create(input=texts, model="tei")
    return [item.embedding for item in response.data]


def _chunk_python_file(content: str, file_path: str) -> list[dict]:
    """Split Python file into chunks by top-level functions/classes."""
    chunks = []
    lines = content.split("\n")

    # Find top-level definitions
    boundaries = []
    for i, line in enumerate(lines):
        if re.match(r"^(def |class |async def )", line):
            boundaries.append(i)

    if not boundaries:
        # No definitions found: treat entire file as one chunk
        chunks.append({
            "file_path": file_path,
            "content": content,
            "line_start": 1,
            "line_end": len(lines),
            "chunk_type": "module",
        })
        return chunks

    # Module-level code before first definition
    if boundaries[0] > 0:
        module_lines = lines[: boundaries[0]]
        module_content = "\n".join(module_lines).strip()
        if module_content:
            chunks.append({
                "file_path": file_path,
                "content": module_content,
                "line_start": 1,
                "line_end": boundaries[0],
                "chunk_type": "module",
            })

    # Each definition block
    for idx, start in enumerate(boundaries):
        end = boundaries[idx + 1] if idx + 1 < len(boundaries) else len(lines)
        chunk_lines = lines[start:end]
        chunk_content = "\n".join(chunk_lines).strip()
        if not chunk_content:
            continue

        chunk_type = "class" if lines[start].startswith("class ") else "function"
        chunks.append({
            "file_path": file_path,
            "content": chunk_content,
            "line_start": start + 1,
            "line_end": end,
            "chunk_type": chunk_type,
        })

    return chunks


def _wait_for_service(name: str, check_fn, max_retries: int = 10, base_delay: float = 2.0):
    """Wait for a service to become available with exponential backoff."""
    for attempt in range(max_retries):
        try:
            check_fn()
            print(f"  {name} is ready")
            return
        except Exception as e:
            delay = min(base_delay * (2 ** attempt), 60)
            print(f"  Waiting for {name} (attempt {attempt + 1}/{max_retries}, retry in {delay:.0f}s): {e}")
            time.sleep(delay)
    raise RuntimeError(f"{name} not available after {max_retries} retries")


def initialize():
    """Index sample code into Qdrant. Idempotent: skips if collection already has data."""
    print("RAG: Initializing...")

    # Wait for Qdrant
    _wait_for_service("Qdrant", lambda: _get_qdrant_client().get_collections())

    # Wait for TEI
    _wait_for_service("TEI", lambda: _embed(["test"]))

    client = _get_qdrant_client()

    # Check if collection exists and has data
    collections = [c.name for c in client.get_collections().collections]
    if COLLECTION in collections:
        info = client.get_collection(COLLECTION)
        if info.points_count > 0:
            print(f"RAG: Collection '{COLLECTION}' already has {info.points_count} points, skipping indexing")
            return

    # Create collection
    if COLLECTION not in collections:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
        )
        print(f"RAG: Created collection '{COLLECTION}'")

    # Read and chunk sample code files
    py_files = sorted(globmod.glob(os.path.join(SAMPLE_CODE_DIR, "*.py")))
    all_chunks = []
    for filepath in py_files:
        filename = os.path.basename(filepath)
        if filename == "__init__.py":
            continue
        with open(filepath, "r") as f:
            content = f.read()
        chunks = _chunk_python_file(content, filename)
        all_chunks.extend(chunks)

    if not all_chunks:
        print("RAG: No code chunks to index")
        return

    # Embed and upsert
    texts = [c["content"] for c in all_chunks]
    print(f"RAG: Embedding {len(texts)} chunks...")
    embeddings = _embed(texts)

    points = [
        PointStruct(
            id=i,
            vector=emb,
            payload={
                "file_path": chunk["file_path"],
                "content": chunk["content"],
                "line_start": chunk["line_start"],
                "line_end": chunk["line_end"],
                "chunk_type": chunk["chunk_type"],
            },
        )
        for i, (chunk, emb) in enumerate(zip(all_chunks, embeddings))
    ]

    client.upsert(collection_name=COLLECTION, points=points)
    print(f"RAG: Indexed {len(points)} chunks into '{COLLECTION}'")


def search(query: str, top_k: int = 5) -> list[dict]:
    """Search indexed code by semantic similarity."""
    query_embedding = _embed([query])[0]
    client = _get_qdrant_client()
    results = client.search(
        collection_name=COLLECTION,
        query_vector=query_embedding,
        limit=top_k,
    )
    return [
        {
            "file_path": hit.payload["file_path"],
            "content": hit.payload["content"],
            "line_start": hit.payload["line_start"],
            "line_end": hit.payload["line_end"],
            "chunk_type": hit.payload["chunk_type"],
            "score": hit.score,
        }
        for hit in results
    ]


def get_file_content(file_path: str) -> str | None:
    """Retrieve full file content by reading all chunks for a given file path."""
    file_path = os.path.basename(file_path)  # Prevent path traversal
    client = _get_qdrant_client()
    results = client.scroll(
        collection_name=COLLECTION,
        scroll_filter=Filter(
            must=[FieldCondition(key="file_path", match=MatchValue(value=file_path))]
        ),
        limit=100,
    )
    points = results[0]
    if not points:
        return None

    # Sort by line_start and reconstruct
    sorted_points = sorted(points, key=lambda p: p.payload["line_start"])
    return "\n\n".join(p.payload["content"] for p in sorted_points)


def list_indexed_files() -> list[str]:
    """List all unique file paths in the index."""
    client = _get_qdrant_client()
    results = client.scroll(
        collection_name=COLLECTION,
        limit=1000,
        with_payload=["file_path"],
    )
    points = results[0]
    files = sorted(set(p.payload["file_path"] for p in points))
    return files
