# Address Validation MCP Server
# https://modelcontextprotocol.io/quickstart/server

from mcp.server.fastmcp import FastMCP
import random
import re

mcp = FastMCP("address_validation_service", host="0.0.0.0", port=8000)

# Mock address database with validation results
mock_address_database = {
    "123 main st": {
        "standardized_address": "123 Main Street",
        "city": "Anytown",
        "state": "CA",
        "zip_code": "90210",
        "county": "Los Angeles",
        "is_valid": True,
        "is_residential": True,
        "delivery_point": "Valid",
        "address_type": "Single Family",
        "occupancy_status": "Occupied",
        "risk_score": 15  # Low risk
    },
    "456 oak avenue": {
        "standardized_address": "456 Oak Avenue",
        "city": "Springfield",
        "state": "IL",
        "zip_code": "62701",
        "county": "Sangamon",
        "is_valid": True,
        "is_residential": True,
        "delivery_point": "Valid",
        "address_type": "Apartment",
        "occupancy_status": "Occupied",
        "risk_score": 25  # Low-Medium risk
    },
    "789 elm street": {
        "standardized_address": "789 Elm Street",
        "city": "Portland",
        "state": "OR",
        "zip_code": "97201",
        "county": "Multnomah",
        "is_valid": True,
        "is_residential": True,
        "delivery_point": "Valid",
        "address_type": "Condominium",
        "occupancy_status": "Occupied",
        "risk_score": 20  # Low risk
    },
    "999 fake street": {
        "standardized_address": None,
        "city": None,
        "state": None,
        "zip_code": None,
        "county": None,
        "is_valid": False,
        "is_residential": False,
        "delivery_point": "Invalid",
        "address_type": "Unknown",
        "occupancy_status": "Unknown",
        "risk_score": 95  # High risk
    }
}

@mcp.tool(description="Validates and standardizes applicant's residential address")
async def validate_address(
    street_address: str,
    city: str,
    state: str,
    zip_code: str
):
    """
    Validates and standardizes applicant's residential address.
    
    Args:
        street_address: Street address provided by applicant
        city: City name
        state: State abbreviation or full name
        zip_code: ZIP or postal code
        
    Returns:
        Address validation result with standardized format and risk assessment
    """
    
    # Normalize input for lookup
    normalized_street = street_address.lower().strip()
    
    # Check if address exists in mock database
    address_data = None
    for key, data in mock_address_database.items():
        if key in normalized_street or normalized_street in key:
            address_data = data
            break
    
    if not address_data:
        # Generate mock response for unknown addresses
        address_data = _generate_mock_address_response(street_address, city, state, zip_code)
    
    # Validate ZIP code format
    zip_valid = _validate_zip_code(zip_code)
    
    # Calculate overall validation score
    validation_score = _calculate_address_validation_score(address_data, zip_valid)
    
    return {
        "validation_status": "VALID" if address_data["is_valid"] and zip_valid else "INVALID",
        "standardized_address": {
            "street": address_data["standardized_address"],
            "city": address_data["city"] or city,
            "state": address_data["state"] or state,
            "zip_code": address_data["zip_code"] or zip_code,
            "county": address_data["county"]
        },
        "address_verification": {
            "is_valid_address": address_data["is_valid"],
            "is_residential": address_data["is_residential"],
            "delivery_point_valid": address_data["delivery_point"] == "Valid",
            "address_type": address_data["address_type"],
            "occupancy_status": address_data["occupancy_status"]
        },
        "risk_assessment": {
            "risk_score": address_data["risk_score"],
            "risk_level": _get_risk_level(address_data["risk_score"]),
            "validation_score": validation_score
        },
        "recommendation": _get_address_recommendation(address_data["is_valid"], address_data["risk_score"])
    }

@mcp.tool(description="Performs additional address verification checks including fraud detection")
async def perform_address_fraud_check(street_address: str, applicant_name: str):
    """
    Performs additional address verification including fraud detection.
    
    Args:
        street_address: Street address to verify
        applicant_name: Name of the applicant
        
    Returns:
        Fraud check results and additional verification data
    """
    
    normalized_street = street_address.lower().strip()
    
    # Mock fraud indicators
    fraud_indicators = []
    fraud_score = 0
    
    # Check for common fraud patterns
    if "po box" in normalized_street or "p.o. box" in normalized_street:
        fraud_indicators.append("PO Box address not acceptable for residential verification")
        fraud_score += 30
    
    if any(word in normalized_street for word in ["fake", "test", "invalid", "xxx"]):
        fraud_indicators.append("Address contains suspicious keywords")
        fraud_score += 50
    
    # Random additional checks
    if random.random() < 0.1:  # 10% chance of flagging for additional review
        fraud_indicators.append("Address flagged for manual review")
        fraud_score += 20
    
    # Check address history (mock)
    address_history_months = random.randint(1, 60)
    if address_history_months < 6:
        fraud_indicators.append("Recent address change - less than 6 months")
        fraud_score += 15
    
    fraud_level = "HIGH" if fraud_score >= 50 else "MEDIUM" if fraud_score >= 25 else "LOW"
    
    return {
        "fraud_check_status": "PASSED" if fraud_score < 50 else "FAILED",
        "fraud_score": fraud_score,
        "fraud_level": fraud_level,
        "fraud_indicators": fraud_indicators,
        "address_history_months": address_history_months,
        "additional_verification_required": fraud_score >= 25,
        "recommendation": _get_fraud_recommendation(fraud_score, fraud_level)
    }

@mcp.tool(description="Verifies address ownership and residency status")
async def verify_address_ownership(street_address: str, applicant_name: str):
    """
    Verifies address ownership and residency status.
    
    Args:
        street_address: Address to verify ownership for
        applicant_name: Name of the applicant
        
    Returns:
        Ownership verification results
    """
    
    # Mock ownership data
    ownership_types = ["Owner", "Renter", "Family Member", "Unknown"]
    ownership_status = random.choice(ownership_types)
    
    residency_months = random.randint(1, 120)
    
    # Calculate ownership verification score
    if ownership_status == "Owner":
        ownership_score = 90
    elif ownership_status == "Renter" and residency_months >= 12:
        ownership_score = 75
    elif ownership_status == "Renter":
        ownership_score = 60
    elif ownership_status == "Family Member":
        ownership_score = 50
    else:
        ownership_score = 20
    
    return {
        "ownership_status": ownership_status,
        "residency_months": residency_months,
        "ownership_verified": ownership_status in ["Owner", "Renter"],
        "ownership_score": ownership_score,
        "stability_rating": "HIGH" if residency_months >= 24 else "MEDIUM" if residency_months >= 12 else "LOW",
        "recommendation": _get_ownership_recommendation(ownership_status, residency_months)
    }

def _validate_zip_code(zip_code: str) -> bool:
    """Validate ZIP code format"""
    zip_pattern = r'^\d{5}(-\d{4})?$'
    return bool(re.match(zip_pattern, zip_code.strip()))

def _generate_mock_address_response(street: str, city: str, state: str, zip_code: str) -> dict:
    """Generate mock response for unknown addresses"""
    # Randomly determine if address is valid (80% chance)
    is_valid = random.random() < 0.8
    
    if is_valid:
        return {
            "standardized_address": street.title(),
            "city": city.title(),
            "state": state.upper(),
            "zip_code": zip_code,
            "county": f"{city} County",
            "is_valid": True,
            "is_residential": True,
            "delivery_point": "Valid",
            "address_type": random.choice(["Single Family", "Apartment", "Condominium"]),
            "occupancy_status": "Occupied",
            "risk_score": random.randint(10, 40)
        }
    else:
        return {
            "standardized_address": None,
            "city": None,
            "state": None,
            "zip_code": None,
            "county": None,
            "is_valid": False,
            "is_residential": False,
            "delivery_point": "Invalid",
            "address_type": "Unknown",
            "occupancy_status": "Unknown",
            "risk_score": random.randint(70, 100)
        }

def _calculate_address_validation_score(address_data: dict, zip_valid: bool) -> int:
    """Calculate overall address validation score"""
    score = 0
    
    if address_data["is_valid"]:
        score += 40
    if address_data["is_residential"]:
        score += 30
    if address_data["delivery_point"] == "Valid":
        score += 20
    if zip_valid:
        score += 10
    
    return score

def _get_risk_level(risk_score: int) -> str:
    """Determine risk level based on score"""
    if risk_score <= 30:
        return "LOW"
    elif risk_score <= 60:
        return "MEDIUM"
    else:
        return "HIGH"

def _get_address_recommendation(is_valid: bool, risk_score: int) -> str:
    """Generate recommendation based on address validation"""
    if is_valid and risk_score <= 30:
        return "Address verified successfully. Proceed with application."
    elif is_valid and risk_score <= 60:
        return "Address valid but medium risk. Consider additional verification."
    else:
        return "Address validation failed or high risk. Request additional documentation or reject."

def _get_fraud_recommendation(fraud_score: int, fraud_level: str) -> str:
    """Generate fraud check recommendation"""
    if fraud_level == "LOW":
        return "Low fraud risk. Proceed with standard verification."
    elif fraud_level == "MEDIUM":
        return "Medium fraud risk. Perform additional verification checks."
    else:
        return "High fraud risk detected. Reject application or require extensive documentation."

def _get_ownership_recommendation(ownership_status: str, residency_months: int) -> str:
    """Generate ownership verification recommendation"""
    if ownership_status == "Owner":
        return "Property ownership verified. Excellent stability indicator."
    elif ownership_status == "Renter" and residency_months >= 12:
        return "Stable rental history verified. Good residency indicator."
    else:
        return "Limited residency verification. Consider additional stability checks."

if __name__ == "__main__":
    print("Starting Address Validator MCP Server on port 8000...")
    mcp.run(transport="sse")
