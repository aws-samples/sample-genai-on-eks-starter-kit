from fastmcp import FastMCP
import rag

mcp = FastMCP("Code Review")


@mcp.tool(description="Search the indexed codebase for relevant code snippets by semantic similarity")
def search_code(query: str) -> str:
    """Search the indexed codebase for relevant code snippets.

    Args:
        query: A natural language description of what code to search for.

    Returns:
        Formatted search results with file paths, line numbers, and code content.
    """
    print(f"Calling search_code tool: {query}\n")
    results = rag.search(query, top_k=5)
    if not results:
        return "No relevant code found."

    formatted = []
    for r in results:
        formatted.append(
            f"--- {r['file_path']} (lines {r['line_start']}-{r['line_end']}, "
            f"type: {r['chunk_type']}, relevance: {r['score']:.3f}) ---\n"
            f"{r['content']}"
        )
    return "\n\n".join(formatted)


@mcp.tool(description="Retrieve the full content of an indexed source file")
def get_file(file_path: str) -> str:
    """Retrieve the full content of an indexed source file.

    Args:
        file_path: The file name to retrieve (e.g., "service.py", "models.py").

    Returns:
        The full content of the file, or an error message if not found.
    """
    print(f"Calling get_file tool: {file_path}\n")
    content = rag.get_file_content(file_path)
    if content is None:
        return f"File '{file_path}' not found in the index."
    return f"--- {file_path} ---\n{content}"


@mcp.tool(description="List all indexed source files in the codebase")
def list_files() -> str:
    """List all source files that have been indexed.

    Returns:
        A list of indexed file names.
    """
    print("Calling list_files tool\n")
    files = rag.list_indexed_files()
    if not files:
        return "No files indexed."
    return "Indexed files:\n" + "\n".join(f"  - {f}" for f in files)


# Initialize RAG on startup
print("Code Review MCP Server: Initializing RAG...")
rag.initialize()
print("Code Review MCP Server: Ready")

if __name__ == "__main__":
    mcp.run()
