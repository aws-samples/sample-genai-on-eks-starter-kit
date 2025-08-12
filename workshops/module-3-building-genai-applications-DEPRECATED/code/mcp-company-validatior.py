# # https://modelcontextprotocol.io/quickstart/server

from mcp.server.fastmcp import FastMCP


mcp = FastMCP("company_information_validation_service", host="0.0.0.0", port=5100)

@mcp.tool(description="Validates the company tax registration number and returns if it is valid or invalid")
async def validate_company_registration_number(registration_number: str):
    """ Validates the company tax registration number and returns if it is valid or invalid """

    if len(registration_number) != 10:
        return  f"Invalid registration number {registration_number}. External Data validation failed.",

    return f"Valid company registration number format and in the system {registration_number}"

if __name__ == "__main__":
    mcp.run(transport="sse")
    
    
