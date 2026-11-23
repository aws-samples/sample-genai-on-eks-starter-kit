# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
"""Pydantic schema for structured, auditable credit decisions (Module 5).

Every credit decision the agent emits must conform to ``CreditDecision`` so that
downstream systems get a consistent, validated, machine-readable record. The
DTI validator enforces a hard compliance rule: an application with DTI > 43%
cannot be auto-APPROVED (it must be routed to MANUAL_REVIEW or REJECTED).
"""

from enum import Enum
from typing import List

from pydantic import BaseModel, Field, field_validator, ValidationInfo


class DecisionStatus(str, Enum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    MANUAL_REVIEW = "MANUAL_REVIEW"


class PolicyReference(BaseModel):
    policy_name: str = Field(description="Name of the referenced policy document")
    section: str = Field(description="Specific section cited")
    relevance: str = Field(description="Why this policy applies")


class CreditDecision(BaseModel):
    """Structured credit underwriting decision."""

    applicant_name: str
    loan_amount: float = Field(gt=0)
    loan_purpose: str
    # debt_to_income_ratio MUST be declared before `decision` so it is already
    # validated and present in info.data when validate_decision_consistency runs.
    debt_to_income_ratio: float = Field(ge=0.0)
    decision: DecisionStatus
    confidence_score: float = Field(ge=0.0, le=1.0)
    risk_factors: List[str]
    policy_references: List[PolicyReference] = Field(min_length=1)
    reasoning: str = Field(min_length=50)

    @field_validator("decision")
    @classmethod
    def validate_decision_consistency(cls, v: DecisionStatus, info: ValidationInfo) -> DecisionStatus:
        """Ensure high-risk DTI ratios cannot be auto-approved.

        Note: ``debt_to_income_ratio`` is declared before ``decision`` so it is
        already validated and present in ``info.data`` when this runs.
        """
        dti = info.data.get("debt_to_income_ratio", 0)
        # Accept both ratio (0.43) and percentage (43) styles defensively.
        threshold = 0.43 if dti <= 1 else 43
        if dti > threshold and v == DecisionStatus.APPROVED:
            raise ValueError(
                f"DTI ratio {dti} exceeds 43% threshold - cannot auto-approve"
            )
        return v


def validate_and_format_decision(raw_output: str) -> CreditDecision:
    """Parse and validate the LLM's credit decision JSON.

    On validation failure, returns a safe MANUAL_REVIEW decision rather than
    raising, so a malformed model output never silently approves a loan.
    """
    try:
        return CreditDecision.model_validate_json(raw_output)
    except Exception as e:  # ValidationError or JSON error
        return CreditDecision(
            applicant_name="Unknown",
            loan_amount=1.0,
            loan_purpose="Unknown",
            decision=DecisionStatus.MANUAL_REVIEW,
            confidence_score=0.0,
            debt_to_income_ratio=0.0,
            risk_factors=["Output validation failed"],
            policy_references=[PolicyReference(
                policy_name="System",
                section="Validation",
                relevance="Auto-generated due to validation failure",
            )],
            reasoning=f"Agent output failed schema validation: {str(e)[:200]}",
        )
