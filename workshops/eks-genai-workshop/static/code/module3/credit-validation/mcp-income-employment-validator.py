# Income and Employment Validation MCP Server
# https://modelcontextprotocol.io/quickstart/server

from mcp.server.fastmcp import FastMCP
import random
from datetime import datetime, timedelta

mcp = FastMCP("income_employment_validation_service", host="0.0.0.0", port=5200)

# Mock employment database
mock_employment_database = {
    "john.doe@email.com": {
        "employer": "Tech Solutions Inc",
        "job_title": "Software Engineer",
        "annual_income": 75000,
        "employment_status": "Full-time",
        "years_employed": 3.5,
        "employment_verified": True,
        "income_verified": True,
        "last_verification_date": "2024-08-15"
    },
    "jane.smith@email.com": {
        "employer": "Marketing Pro LLC",
        "job_title": "Marketing Manager", 
        "annual_income": 65000,
        "employment_status": "Full-time",
        "years_employed": 2.8,
        "employment_verified": True,
        "income_verified": True,
        "last_verification_date": "2024-08-10"
    },
    "mike.johnson@email.com": {
        "employer": "Construction Works",
        "job_title": "Project Manager",
        "annual_income": 55000,
        "employment_status": "Contract",
        "years_employed": 1.2,
        "employment_verified": True,
        "income_verified": False,  # Income not verified for contract work
        "last_verification_date": "2024-07-20"
    }
}

@mcp.tool(description="Validates applicant's income and employment status through external verification")
async def validate_income_employment(
    applicant_email: str, 
    reported_income: float, 
    reported_employer: str, 
    reported_job_title: str,
    reported_employment_years: float
):
    """
    Validates applicant's income and employment status through external verification.
    
    Args:
        applicant_email: Email address of the applicant for lookup
        reported_income: Annual income reported by applicant
        reported_employer: Employer name reported by applicant
        reported_job_title: Job title reported by applicant
        reported_employment_years: Years of employment reported by applicant
    
    Returns:
        Validation result with employment and income verification status
    """
    
    # Check if applicant exists in mock database
    if applicant_email not in mock_employment_database:
        return {
            "validation_status": "FAILED",
            "employment_verified": False,
            "income_verified": False,
            "reason": "Applicant not found in employment verification system",
            "recommendation": "Request additional employment documentation"
        }
    
    applicant_data = mock_employment_database[applicant_email]
    
    # Verify employment details
    employment_match = (
        applicant_data["employer"].lower() == reported_employer.lower() and
        applicant_data["job_title"].lower() == reported_job_title.lower()
    )
    
    # Verify income (allow 10% variance)
    income_variance = abs(applicant_data["annual_income"] - reported_income) / applicant_data["annual_income"]
    income_match = income_variance <= 0.10
    
    # Verify employment duration (allow 6 months variance)
    years_variance = abs(applicant_data["years_employed"] - reported_employment_years)
    years_match = years_variance <= 0.5
    
    # Determine overall validation status
    if employment_match and income_match and years_match and applicant_data["employment_verified"]:
        validation_status = "PASSED"
        risk_level = "LOW"
    elif employment_match and applicant_data["employment_verified"]:
        validation_status = "PARTIAL"
        risk_level = "MEDIUM"
    else:
        validation_status = "FAILED"
        risk_level = "HIGH"
    
    return {
        "validation_status": validation_status,
        "employment_verified": employment_match and applicant_data["employment_verified"],
        "income_verified": income_match and applicant_data["income_verified"],
        "employment_years_verified": years_match,
        "verified_income": applicant_data["annual_income"],
        "verified_employer": applicant_data["employer"],
        "verified_job_title": applicant_data["job_title"],
        "verified_employment_years": applicant_data["years_employed"],
        "employment_status": applicant_data["employment_status"],
        "risk_level": risk_level,
        "last_verification_date": applicant_data["last_verification_date"],
        "income_variance_percentage": round(income_variance * 100, 2) if 'income_variance' in locals() else 0,
        "recommendation": _get_employment_recommendation(validation_status, risk_level)
    }

@mcp.tool(description="Checks employment stability and income consistency over time")
async def check_employment_stability(applicant_email: str):
    """
    Checks employment stability and income consistency for the applicant.
    
    Args:
        applicant_email: Email address of the applicant
        
    Returns:
        Employment stability assessment
    """
    
    if applicant_email not in mock_employment_database:
        return {
            "stability_status": "UNKNOWN",
            "reason": "No employment history found"
        }
    
    applicant_data = mock_employment_database[applicant_email]
    years_employed = applicant_data["years_employed"]
    employment_status = applicant_data["employment_status"]
    
    # Determine stability based on employment duration and status
    if years_employed >= 2.0 and employment_status == "Full-time":
        stability_status = "STABLE"
        stability_score = 85
    elif years_employed >= 1.0 and employment_status == "Full-time":
        stability_status = "MODERATE"
        stability_score = 70
    elif employment_status == "Contract" and years_employed >= 1.0:
        stability_status = "MODERATE"
        stability_score = 65
    else:
        stability_status = "UNSTABLE"
        stability_score = 40
    
    return {
        "stability_status": stability_status,
        "stability_score": stability_score,
        "years_employed": years_employed,
        "employment_status": employment_status,
        "recommendation": _get_stability_recommendation(stability_status)
    }

def _get_employment_recommendation(validation_status: str, risk_level: str) -> str:
    """Generate recommendation based on validation results"""
    if validation_status == "PASSED":
        return "Employment and income verified successfully. Proceed with application."
    elif validation_status == "PARTIAL":
        return "Employment verified but income discrepancy found. Request recent pay stubs."
    else:
        return "Employment verification failed. Request additional documentation or reject application."

def _get_stability_recommendation(stability_status: str) -> str:
    """Generate recommendation based on stability assessment"""
    if stability_status == "STABLE":
        return "Strong employment stability. Low risk for income disruption."
    elif stability_status == "MODERATE":
        return "Moderate employment stability. Consider additional income verification."
    else:
        return "Unstable employment history. High risk - consider rejection or require co-signer."

if __name__ == "__main__":
    mcp.run(transport="sse")
