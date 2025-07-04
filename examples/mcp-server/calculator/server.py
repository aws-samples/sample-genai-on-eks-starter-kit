from fastmcp import FastMCP

mcp = FastMCP("Calculator")


# Define a simple addition tool
@mcp.tool(description="Add two numbers together")
def add(x: int, y: int) -> int:
    """Add two numbers and return the result.

    Args:
        x: First number
        y: Second number

    Returns:
        The sum of x and y
    """
    print("Calling add tool.\n")
    return x + y


# Define a subtraction tool
@mcp.tool(description="Subtract one number from another")
def subtract(x: int, y: int) -> int:
    """Subtract y from x and return the result.

    Args:
        x: Number to subtract from
        y: Number to subtract

    Returns:
        The difference (x - y)
    """
    print("Calling subtract tool.\n")
    return x - y


# Define a multiplication tool
@mcp.tool(description="Multiply two numbers together")
def multiply(x: int, y: int) -> int:
    """Multiply two numbers and return the result.

    Args:
        x: First number
        y: Second number

    Returns:
        The product of x and y
    """
    print("Calling multiply tool.\n")
    return x * y


# Define a division tool
@mcp.tool(description="Divide one number by another")
def divide(x: float, y: float) -> float:
    """Divide x by y and return the result.

    Args:
        x: Numerator
        y: Denominator (must not be zero)

    Returns:
        The quotient (x / y)

    Raises:
        ValueError: If y is zero
    """
    print("Calling divide tool.\n")
    if y == 0:
        raise ValueError("Cannot divide by zero")
    return x / y


if __name__ == "__main__":
    mcp.run()
