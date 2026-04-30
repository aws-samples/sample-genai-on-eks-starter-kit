# Demo Walkthrough

This guide walks you through the demo environment deployed by `./cli demo-setup`, including setup steps and usage instructions for each component.

## Deployed Components

The demo environment includes:

### AI Gateway

**LiteLLM**

- Unified API gateway for multiple LLM providers
- Request routing and load balancing
- Usage tracking and observability
- Access: `litellm.<DOMAIN>/ui`

### LLM Models

**vLLM with Qwen3 Models**

Two models are deployed:

| Model | Quantization | Hardware | Performance | Mode |
|-------|-------------|----------|-------------|------|
| [Qwen3-30B-A3B-Instruct-2507-FP8](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507-FP8) | FP8 (8-bit) | Single g6e | ~75 tokens/sec | MoE, non-thinking |
| [Qwen3-32B-FP8](https://huggingface.co/Qwen/Qwen3-32B-FP8) | FP8 (8-bit) | Single g6e | ~15 tokens/sec | Dense, thinking & non-thinking |

!!! info "Model Characteristics"
    - **Fast Model**: MoE architecture optimized for speed
    - **Slow Model**: Dense model with reasoning capabilities

### Observability

**Langfuse**

- LLM observability and analytics
- Trace tracking and debugging
- Cost and performance monitoring
- Access: `langfuse.<DOMAIN>`

### GUI Application

**Open WebUI**

- Chat interface for LLM interaction
- Document RAG capabilities
- AI agent integration
- Function/tool marketplace
- Access: `openwebui.<DOMAIN>`

### Vector Database

**Qdrant**

- High-performance vector database
- Used for RAG document embeddings
- REST and gRPC API support

### Embedding Models

**Text Embedding Inference (TEI) with Qwen3-Embedding**

| Model | Quantization | Hardware |
|-------|-------------|----------|
| [Qwen3-Embedding-4B](https://huggingface.co/Qwen/Qwen3-Embedding-4B) | BF16 (16-bit) | Single r7i |

### MCP Server

**Calculator MCP Server**

- Built with FastMCP 2.0
- Basic calculator operations
- Demonstrates MCP server implementation

### AI Agent

**Strands Calculator Agent**

- Built with Strands Agents framework
- Stateful calculator with memory
- Integrated with Open WebUI

## Demo Setup

After running `./cli demo-setup`, configure Open WebUI:

### 1. Access Open WebUI

Navigate to `openwebui.<DOMAIN>` in your browser.

### 2. Agent Functions (Auto-Registered)

Agent pipe functions are automatically registered when agents are installed:

```bash
./cli strands-agents calculator-agent install
```

The `Strands Agents - Calculator Agent` function appears in Open WebUI automatically.

### 3. Add Optional Functions

Add the Time Token Tracker function from the marketplace:

1. Navigate to Functions in Open WebUI
2. Search for "Time Token Tracker"
3. Click install

[Time Token Tracker on Open WebUI →](https://openwebui.com/f/owndev/time_token_tracker)

See [Open WebUI Functions documentation](https://docs.openwebui.com/features/plugin/functions/#%EF%B8%8F-how-to-use-functions) for more details.

### 4. Configure RAG Embedding Model

Set up Open WebUI to use the deployed Qwen3-Embedding model:

1. Navigate to **Admin Panel** → **Settings** → **Documents**
2. Set the embedding model endpoint
3. Get the API key from `.env.local` (check `LITELLM_API_KEY`)
4. Save configuration

[RAG Embedding Support documentation →](https://docs.openwebui.com/features/rag#rag-embedding-support)

## Using the Demo

### Chat with LLM Models

Interact with deployed models through Open WebUI:

1. **Start a Conversation**
    - Select a model from the dropdown
    - Type your message and press Enter
    - Try both the fast and slow models

2. **Compare Models**
    - Fast model (Qwen3-30B-A3B): Better for quick responses
    - Slow model (Qwen3-32B): Better for complex reasoning

[Chat Features Overview →](https://docs.openwebui.com/features/chat-features)

!!! tip "Model Selection"
    Use the fast model for general chat and the slow model when you need detailed reasoning or step-by-step thinking.

### Document RAG

Use the RAG feature to chat with your documents:

1. **Upload Documents**
    - Click the document icon in the chat interface
    - Select files to upload (PDF, TXT, DOCX, etc.)
    - Wait for embedding processing

2. **Query Documents**
    - Ask questions about uploaded documents
    - The system retrieves relevant chunks using Qdrant
    - Responses are grounded in your documents

3. **Manage Collections**
    - View and organize document collections
    - Update or delete documents as needed

[RAG Tutorial →](https://docs.openwebui.com/tutorials/tips/rag-tutorial)

### Calculator Agent

Explore the Strands Calculator Agent:

1. **Select the Agent**
    - In Open WebUI, select `Strands Agents - Calculator Agent`
    - The agent maintains memory across conversations

2. **Perform Calculations**
    ```
    You: Add 15 and 27
    Agent: The result is 42

    You: Multiply that by 2
    Agent: The result is 84

    You: What's the current total?
    Agent: 84
    ```

3. **Reset Calculator**
    ```
    You: Reset the calculator
    Agent: Calculator has been reset
    ```

!!! example "Agent Features"
    - **Memory**: Continues calculations across messages
    - **Context Aware**: Understands "that" and "the result"
    - **Stateful**: Maintains current value

**Source Code**: `examples/strands-agents/calculator-agent/`

### LiteLLM Dashboard

Monitor and manage API requests:

1. **Access Dashboard**
    - Navigate to `litellm.<DOMAIN>/ui`
    - Credentials in `.env.local`:
        - Username: `LITELLM_UI_USERNAME`
        - Password: `LITELLM_UI_PASSWORD`

2. **Features**
    - Request logs and metrics
    - Model routing configuration
    - Rate limiting and budgets
    - API key management

[LiteLLM Proxy Server documentation →](https://docs.litellm.ai/docs/simple_proxy)

!!! info "Request Flow"
    Open WebUI → LiteLLM Proxy → vLLM/Model

### Langfuse Dashboard

Track LLM observability and analytics:

1. **Access Dashboard**
    - Navigate to `langfuse.<DOMAIN>`
    - Credentials in `.env.local`:
        - Email: `LANGFUSE_USERNAME`
        - Password: `LANGFUSE_PASSWORD`

2. **Features**
    - Trace visualization
    - Cost tracking
    - Performance metrics
    - User analytics
    - Model comparisons

3. **Integration**
    - LiteLLM automatically logs to Langfuse
    - All requests from Open WebUI are tracked
    - Agent interactions are captured

[Langfuse Features →](https://langfuse.com/docs/core-features)

## Verification

Verify all components are running:

```bash
# Check pods
kubectl get pods -n litellm
kubectl get pods -n vllm
kubectl get pods -n langfuse
kubectl get pods -n openwebui
kubectl get pods -n qdrant
kubectl get pods -n tei

# Check services
kubectl get svc --all-namespaces

# Check ingress endpoints
kubectl get ingress --all-namespaces
```

All pods should show `Running` status.

## Troubleshooting

### Component Not Accessible

Check ingress and service configuration:

```bash
kubectl describe ingress <name> -n <namespace>
kubectl describe svc <name> -n <namespace>
```

### Model Not Loading

Check pod logs:

```bash
kubectl logs -f deploy/vllm-<model> -n vllm
```

Common issues:

- Insufficient GPU memory
- Model download in progress
- Incorrect model path

### RAG Not Working

Verify embedding model:

```bash
kubectl get pods -n tei
kubectl logs -f deploy/tei-qwen3-embedding -n tei
```

Check Open WebUI embedding configuration in Admin Panel.

## Next Steps

- Explore different models and their capabilities
- Build custom agents using the Strands Agents framework
- Create MCP servers with FastMCP 2.0
- Integrate with your own applications via LiteLLM API
- Monitor costs and performance with Langfuse

## Reference Materials

- [Open WebUI Documentation](https://docs.openwebui.com)
- [LiteLLM Documentation](https://docs.litellm.ai)
- [Langfuse Documentation](https://langfuse.com/docs)
- [vLLM Documentation](https://docs.vllm.ai)
- [Strands Agents Documentation](https://strandsagents.com)
- [FastMCP Documentation](https://gofastmcp.com)
