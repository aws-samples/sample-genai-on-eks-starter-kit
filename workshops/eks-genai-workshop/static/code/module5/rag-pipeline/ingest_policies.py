#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Ingest loan policy documents into Milvus using Bedrock Titan embeddings.

Reads every Markdown file under ./policies, splits it into overlapping chunks,
embeds each chunk with Amazon Bedrock Titan Text Embeddings v2, and stores the
vectors in a Milvus collection named ``loan_policies``.

Environment:
    AWS_REGION         AWS region for Bedrock (default: us-east-1)
    MILVUS_URI         Milvus connection URI
                       (default: http://localhost:19530 for port-forward use)

Usage:
    kubectl port-forward svc/milvus -n milvus 19530:19530 &
    python3 ingest_policies.py
"""

import os
import glob

from langchain_aws import BedrockEmbeddings
from langchain_milvus import Milvus
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MILVUS_URI = os.environ.get("MILVUS_URI", "http://localhost:19530")
COLLECTION = "loan_policies"
POLICIES_DIR = os.path.join(os.path.dirname(__file__), "policies")


def load_documents() -> list[Document]:
    """Load every Markdown policy file as a LangChain Document."""
    docs: list[Document] = []
    paths = sorted(glob.glob(os.path.join(POLICIES_DIR, "*.md")))
    if not paths:
        raise SystemExit(f"No policy documents found in {POLICIES_DIR}")
    for path in paths:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        docs.append(Document(page_content=text, metadata={"source": os.path.basename(path)}))
    print(f"Loading {len(docs)} policy documents...")
    return docs


def main() -> None:
    documents = load_documents()

    # 1. Split documents into chunks that preserve Markdown section boundaries.
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
        separators=["\n## ", "\n### ", "\n\n", "\n", " "],
    )
    chunks = splitter.split_documents(documents)
    print(f"Splitting into chunks: {len(chunks)} chunks created")

    # 2. Create embeddings using Bedrock Titan.
    print("Generating embeddings via Bedrock Titan...")
    embeddings = BedrockEmbeddings(
        model_id="amazon.titan-embed-text-v2:0",
        region_name=AWS_REGION,
    )

    # 3. Store in Milvus with metadata. drop_old=True makes re-runs idempotent.
    print(f"Storing in Milvus collection '{COLLECTION}'...")
    Milvus.from_documents(
        documents=chunks,
        embedding=embeddings,
        connection_args={"uri": MILVUS_URI},
        collection_name=COLLECTION,
        drop_old=True,
        auto_id=True,
    )

    print(f"Ingested {len(chunks)} policy chunks into Milvus")


if __name__ == "__main__":
    main()
