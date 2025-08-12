# # https://modelcontextprotocol.io/quickstart/server

from mcp.server.fastmcp import FastMCP
import random

mcp = FastMCP("account_code_assigner_service", host="0.0.0.0", port=5000)

@mcp.tool(description="Get transaction details and the transaction amount and return the right accounting code")
async def get_account_code_for_line_item(transaction_description: str, transaction_amount: float):
    """ Get transaction details and the transaction amount and return the right accounting code """

    if len(transaction_description) == 0:
        return  f"Invalid transaction description.",

    if transaction_amount <= 0:
        return  f"Invalid transaction amount {transaction_amount}.",

    # Pick a random account name from the chart of accounts
    random_account_name = random.choice(list(chart_of_accounts.keys()))
    account_code = chart_of_accounts[random_account_name]
    
    return f"The account code for the transaction '{transaction_description}' with amount {transaction_amount} is {account_code}",

chart_of_accounts = {
    "Assets": "4000",
    "Liabilities": "5000",
    "Operating Expenses": "6000",
    "Income": "7000",
    "Expenses": "8000",
    "Equity": "9000"
}

if __name__ == "__main__":
    mcp.run(transport="sse")
    
    
