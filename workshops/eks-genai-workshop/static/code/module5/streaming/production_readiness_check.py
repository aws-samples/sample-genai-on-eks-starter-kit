#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Production readiness checker for Loan Buddy v2 (Module 5).

Runs a series of checks across Security, Reliability, Observability, and Data/RAG
against the live cluster and prints a pass/fail summary. Uses kubectl and aws
CLIs (must be configured). Exit code is non-zero if any REQUIRED check fails.

Usage:
    export CLUSTER_NAME=genai-on-eks
    export AWS_REGION=<region of your workshop event>
    python3 production_readiness_check.py
"""

import os
import shutil
import subprocess
import sys

NAMESPACE = "workshop"
CLUSTER_NAME = os.environ.get("CLUSTER_NAME", os.environ.get("EKS_CLUSTER_NAME", "genai-on-eks"))
# The workshop runs in the event's Region (us-east-1 or us-west-2), so read it
# from the environment or the AWS CLI configuration instead of hard-coding one.
REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or ""
if not REGION and shutil.which("aws"):
    REGION = subprocess.run("aws configure get region", shell=True, capture_output=True,
                            text=True).stdout.strip()
if not REGION:
    sys.exit("AWS region not set. Run: export AWS_REGION=<your workshop Region>")

GREEN, RED, YELLOW, NC = "\033[0;32m", "\033[0;31m", "\033[1;33m", "\033[0m"


def run(cmd: str) -> tuple[int, str]:
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def check(name: str, cmd: str, expect_nonempty: bool = True, required: bool = True) -> bool:
    code, out = run(cmd)
    ok = (code == 0) and (bool(out) if expect_nonempty else True)
    tag = f"{GREEN}PASS{NC}" if ok else (f"{RED}FAIL{NC}" if required else f"{YELLOW}WARN{NC}")
    detail = out.splitlines()[0][:80] if out else "(no output)"
    print(f"  [{tag}] {name}: {detail}")
    return ok or not required


def main() -> None:
    if not shutil.which("kubectl"):
        sys.exit("kubectl not found")

    print("=== Production Readiness Check: Loan Buddy v2 ===\n")
    results = []

    print(f"{YELLOW}Security{NC}")
    results.append(check(
        "Pod Identity associations (workshop ns)",
        f"aws eks list-pod-identity-associations --cluster-name {CLUSTER_NAME} "
        f"--region {REGION} --query \"associations[?namespace=='{NAMESPACE}'].serviceAccount\" --output text"))
    results.append(check(
        "External Secrets synced",
        f"kubectl get externalsecret -n {NAMESPACE} --no-headers", required=False))
    results.append(check(
        "Bedrock guardrail exists",
        f"aws bedrock list-guardrails --region {REGION} "
        f"--query \"guardrails[?name=='loan-buddy-guardrail'].name\" --output text", required=False))

    print(f"\n{YELLOW}Reliability{NC}")
    results.append(check(
        "Agent deployment available",
        f"kubectl get deploy -n {NAMESPACE} -o name"))
    results.append(check(
        "Resource limits set on v2 agent",
        f"kubectl get deploy loan-buddy-agent-v2 -n {NAMESPACE} "
        "-o jsonpath='{.spec.template.spec.containers[0].resources.limits}'", required=False))

    print(f"\n{YELLOW}Observability{NC}")
    results.append(check(
        "Langfuse reachable",
        "kubectl get pods -n langfuse -l app=web --no-headers"))

    print(f"\n{YELLOW}Data & RAG{NC}")
    results.append(check(
        "Milvus running",
        f"kubectl get pods -n milvus --no-headers"))
    results.append(check(
        "Bedrock Titan embeddings accessible",
        f"aws bedrock list-foundation-models --region {REGION} "
        "--query \"modelSummaries[?contains(modelId,'titan-embed-text-v2')].modelId\" --output text"))

    print()
    passed = sum(1 for r in results if r)
    total = len(results)
    if passed == total:
        print(f"{GREEN}✅ Production readiness: {passed}/{total} checks passed.{NC}")
        sys.exit(0)
    else:
        print(f"{RED}❌ Production readiness: {passed}/{total} passed — review failures above.{NC}")
        sys.exit(1)


if __name__ == "__main__":
    main()
