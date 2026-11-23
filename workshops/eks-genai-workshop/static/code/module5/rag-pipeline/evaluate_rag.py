#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Evaluate the loan-policy RAG pipeline with Ragas.

Measures four standard RAG metrics — faithfulness, answer relevancy, context
precision, and context recall — using the loan_policies Milvus collection for
retrieval, Bedrock Titan for embeddings, and Claude (via the LiteLLM gateway,
OpenAI-compatible) as the judge LLM.

The evaluation set is a small, fixed list of loan questions with reference
answers grounded in the policy documents, so scores are reproducible.

Environment:
    AWS_REGION                AWS region for Bedrock embeddings (default us-east-1)
    MILVUS_URI                Milvus URI (default http://localhost:19530)
    GATEWAY_URL               LiteLLM base URL (default http://localhost:4000)
    GATEWAY_MODEL_ACCESS_KEY  LiteLLM key (required, no default)
    JUDGE_MODEL               Judge model name on the gateway
                              (default bedrock/claude-4.5-sonnet, a legacy alias
                              that the starter kit config.workshop.json routes to
                              Claude Sonnet 5.5, global.anthropic.claude-sonnet-5-5)

Usage:
    kubectl port-forward svc/milvus  -n milvus  19530:19530 &
    kubectl port-forward svc/litellm -n litellm 4000:4000  &
    python3 evaluate_rag.py
"""

import os

from langchain_aws import BedrockEmbeddings
from langchain_milvus import Milvus
from langchain_openai import ChatOpenAI

from ragas import evaluate, EvaluationDataset
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
)
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MILVUS_URI = os.environ.get("MILVUS_URI", "http://localhost:19530")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:4000")
# No default: a credential baked into sample code is a credential everyone has.
GATEWAY_KEY = os.environ.get("GATEWAY_MODEL_ACCESS_KEY", "")
if not GATEWAY_KEY:
    raise SystemExit(
        "GATEWAY_MODEL_ACCESS_KEY is not set. Export your account's LiteLLM key "
        "(see /workshop/.env.local) before running this evaluation."
    )
# "claude-4.5-sonnet" is a legacy alias label defined by the starter kit config.workshop.json.
# The LiteLLM gateway routes it to Claude Sonnet 5.5 (global.anthropic.claude-sonnet-5-5).
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "bedrock/claude-4.5-sonnet")
COLLECTION = "loan_policies"

# Fixed evaluation set: question + reference answer grounded in the policy docs.
EVAL_SET = [
    {
        "question": "What is the minimum credit score for a home improvement loan?",
        "reference": "The minimum FICO credit score for a home improvement loan is 660. "
                     "Applicants scoring 640-659 may qualify only with a co-signer.",
    },
    {
        "question": "What DTI ratio disqualifies an applicant from auto-approval?",
        "reference": "A debt-to-income ratio above 43% exceeds policy and prohibits "
                     "auto-approval; such applications are declined unless documented "
                     "compensating factors exist.",
    },
    {
        "question": "What are the loan amount limits for a personal loan?",
        "reference": "Personal loans range from $1,000 to $25,000 with terms of 12 to 60 months.",
    },
    {
        "question": "How should document authenticity concerns be handled?",
        "reference": "Document authenticity concerns raise the risk tier to at least "
                     "Elevated and require manual review. They are a review trigger, "
                     "not an automatic decline; the decision must rest on verified "
                     "financial criteria.",
    },
    {
        "question": "What is the maximum home improvement loan amount?",
        "reference": "Home improvement loans range from $5,000 to $50,000.",
    },
]


def build_dataset(vectorstore) -> EvaluationDataset:
    """Retrieve contexts for each question and assemble a Ragas dataset."""
    judge = ChatOpenAI(model=JUDGE_MODEL, temperature=0,
                       api_key=GATEWAY_KEY, base_url=f"{GATEWAY_URL}/v1",
                       max_tokens=1024, timeout=120)
    samples = []
    for item in EVAL_SET:
        docs = vectorstore.similarity_search(item["question"], k=3)
        contexts = [d.page_content for d in docs]
        context_block = "\n\n".join(contexts)
        answer = judge.invoke(
            f"Answer the loan question using ONLY the policy context. Cite specifics.\n\n"
            f"Context:\n{context_block}\n\nQuestion: {item['question']}"
        ).content
        samples.append({
            "user_input": item["question"],
            "retrieved_contexts": contexts,
            "response": answer,
            "reference": item["reference"],
        })
    return EvaluationDataset.from_list(samples)


def main() -> None:
    embeddings = BedrockEmbeddings(model_id="amazon.titan-embed-text-v2:0", region_name=AWS_REGION)
    vectorstore = Milvus(
        embedding_function=embeddings,
        connection_args={"uri": MILVUS_URI},
        collection_name=COLLECTION,
    )

    print("Building evaluation dataset from Milvus retrievals...")
    dataset = build_dataset(vectorstore)

    judge_llm = LangchainLLMWrapper(ChatOpenAI(
        model=JUDGE_MODEL, temperature=0, api_key=GATEWAY_KEY,
        base_url=f"{GATEWAY_URL}/v1", max_tokens=2048, timeout=120))
    judge_emb = LangchainEmbeddingsWrapper(embeddings)

    print("Running Ragas evaluation (faithfulness, answer_relevancy, context_precision, context_recall)...")
    results = evaluate(
        dataset=dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        llm=judge_llm,
        embeddings=judge_emb,
    )

    print("\n=== Ragas RAG Evaluation Results ===")
    print(results)


if __name__ == "__main__":
    main()
