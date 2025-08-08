---
title: "Multi-Agent Systems"
weight: 44
duration: "30 minutes"
difficulty: "advanced"
---

# Multi-Agent Systems and A2A Communication

Learn how to design and implement multi-agent systems with Agent-to-Agent (A2A) communication patterns for complex GenAI workflows.

## Overview

Multi-agent systems enable sophisticated AI applications by coordinating multiple specialized agents that can communicate, collaborate, and distribute tasks effectively.

## Learning Objectives

By the end of this lab, you will be able to:
- Design multi-agent architectures
- Implement A2A communication patterns
- Create agent orchestration workflows
- Handle conflict resolution and task distribution
- Monitor multi-agent system performance

## Prerequisites

- Completed [MCP Integration](/module3-genai-applications/mcp-integration/)
- Understanding of distributed systems concepts
- Familiarity with agent architectures

## Multi-Agent Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Multi-Agent System Architecture             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Coordinator │  │ Task Queue  │  │ Message Bus │        │
│  │   Agent     │  │   Manager   │  │   (Redis)   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                 │                 │              │
│  ┌─────────────────────────────────────────────────────────┤
│  │              Agent Communication Layer                  │
│  └─────────────────────────────────────────────────────────┤
│         │                 │                 │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Document    │  │ Analysis    │  │ Generation  │        │
│  │ Agent       │  │ Agent       │  │ Agent       │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Lab: Implementing Multi-Agent Systems

### Step 1: Deploy Message Bus (Redis)

```yaml
# redis-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis-message-bus
  namespace: genai-applications
  labels:
    app: redis-message-bus
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis-message-bus
  template:
    metadata:
      labels:
        app: redis-message-bus
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        command: ["redis-server"]
        args: ["--appendonly", "yes"]
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
        volumeMounts:
        - name: redis-data
          mountPath: /data
      volumes:
      - name: redis-data
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: redis-message-bus-service
  namespace: genai-applications
  labels:
    app: redis-message-bus
spec:
  selector:
    app: redis-message-bus
  ports:
  - port: 6379
    targetPort: 6379
    protocol: TCP
  type: ClusterIP
```

### Step 2: Create Multi-Agent Framework

```python
# multi_agent_system.py
import asyncio
import json
import uuid
import redis
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
import logging

class MessageType(Enum):
    TASK_REQUEST = "task_request"
    TASK_RESPONSE = "task_response"
    AGENT_REGISTRATION = "agent_registration"
    HEARTBEAT = "heartbeat"
    BROADCAST = "broadcast"

@dataclass
class Message:
    id: str
    sender_id: str
    recipient_id: str
    message_type: MessageType
    payload: Dict[str, Any]
    timestamp: str
    correlation_id: Optional[str] = None

class Agent:
    def __init__(self, agent_id: str, agent_type: str, capabilities: List[str]):
        self.agent_id = agent_id
        self.agent_type = agent_type
        self.capabilities = capabilities
        self.message_bus = None
        self.running = False
        self.message_handlers = {}
        
    async def initialize(self, redis_host: str = "redis-message-bus-service", redis_port: int = 6379):
        """Initialize agent with message bus connection"""
        self.message_bus = redis.Redis(host=redis_host, port=redis_port, decode_responses=True)
        
        # Register message handlers
        self.register_handler(MessageType.TASK_REQUEST, self.handle_task_request)
        self.register_handler(MessageType.HEARTBEAT, self.handle_heartbeat)
        
        # Register agent with system
        await self.register_agent()
        
        logging.info(f"Agent {self.agent_id} initialized")
    
    def register_handler(self, message_type: MessageType, handler: Callable):
        """Register a message handler"""
        self.message_handlers[message_type] = handler
    
    async def register_agent(self):
        """Register agent with the multi-agent system"""
        registration_message = Message(
            id=str(uuid.uuid4()),
            sender_id=self.agent_id,
            recipient_id="system",
            message_type=MessageType.AGENT_REGISTRATION,
            payload={
                "agent_type": self.agent_type,
                "capabilities": self.capabilities,
                "status": "active"
            },
            timestamp=datetime.now().isoformat()
        )
        
        await self.send_message(registration_message)
    
    async def send_message(self, message: Message):
        """Send a message via the message bus"""
        channel = f"agent_{message.recipient_id}"
        message_json = json.dumps(asdict(message))
        
        self.message_bus.publish(channel, message_json)
        logging.debug(f"Sent message {message.id} to {message.recipient_id}")
    
    async def send_task_request(self, recipient_id: str, task_type: str, task_data: Dict[str, Any]) -> str:
        """Send a task request to another agent"""
        correlation_id = str(uuid.uuid4())
        
        task_message = Message(
            id=str(uuid.uuid4()),
            sender_id=self.agent_id,
            recipient_id=recipient_id,
            message_type=MessageType.TASK_REQUEST,
            payload={
                "task_type": task_type,
                "task_data": task_data
            },
            timestamp=datetime.now().isoformat(),
            correlation_id=correlation_id
        )
        
        await self.send_message(task_message)
        return correlation_id
    
    async def send_task_response(self, recipient_id: str, correlation_id: str, result: Dict[str, Any]):
        """Send a task response"""
        response_message = Message(
            id=str(uuid.uuid4()),
            sender_id=self.agent_id,
            recipient_id=recipient_id,
            message_type=MessageType.TASK_RESPONSE,
            payload=result,
            timestamp=datetime.now().isoformat(),
            correlation_id=correlation_id
        )
        
        await self.send_message(response_message)
    
    async def handle_task_request(self, message: Message) -> Dict[str, Any]:
        """Handle incoming task requests - to be overridden by subclasses"""
        return {"status": "not_implemented", "message": "Task handler not implemented"}
    
    async def handle_heartbeat(self, message: Message) -> Dict[str, Any]:
        """Handle heartbeat messages"""
        return {"status": "alive", "agent_id": self.agent_id, "timestamp": datetime.now().isoformat()}
    
    async def start_listening(self):
        """Start listening for messages"""
        self.running = True
        pubsub = self.message_bus.pubsub()
        pubsub.subscribe(f"agent_{self.agent_id}")
        
        logging.info(f"Agent {self.agent_id} started listening for messages")
        
        while self.running:
            try:
                message = pubsub.get_message(timeout=1.0)
                if message and message['type'] == 'message':
                    await self.process_message(message['data'])
            except Exception as e:
                logging.error(f"Error processing message: {e}")
                await asyncio.sleep(1)
    
    async def process_message(self, message_data: str):
        """Process incoming message"""
        try:
            message_dict = json.loads(message_data)
            message = Message(**message_dict)
            
            # Convert string enum back to enum
            message.message_type = MessageType(message.message_type)
            
            handler = self.message_handlers.get(message.message_type)
            if handler:
                result = await handler(message)
                
                # Send response if it's a task request
                if message.message_type == MessageType.TASK_REQUEST and message.correlation_id:
                    await self.send_task_response(
                        message.sender_id,
                        message.correlation_id,
                        result
                    )
            else:
                logging.warning(f"No handler for message type: {message.message_type}")
                
        except Exception as e:
            logging.error(f"Error processing message: {e}")
    
    async def stop(self):
        """Stop the agent"""
        self.running = False
        logging.info(f"Agent {self.agent_id} stopped")

class DocumentAgent(Agent):
    def __init__(self):
        super().__init__(
            agent_id="document_agent_001",
            agent_type="document_processor",
            capabilities=["document_analysis", "text_extraction", "content_summarization"]
        )
    
    async def handle_task_request(self, message: Message) -> Dict[str, Any]:
        """Handle document processing tasks"""
        task_type = message.payload.get("task_type")
        task_data = message.payload.get("task_data", {})
        
        if task_type == "analyze_document":
            return await self.analyze_document(task_data)
        elif task_type == "extract_text":
            return await self.extract_text(task_data)
        elif task_type == "summarize_content":
            return await self.summarize_content(task_data)
        else:
            return {"status": "error", "message": f"Unknown task type: {task_type}"}
    
    async def analyze_document(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze document structure and content"""
        document_path = task_data.get("document_path", "")
        
        # Mock document analysis
        await asyncio.sleep(1)  # Simulate processing time
        
        return {
            "status": "success",
            "analysis": {
                "document_type": "PDF",
                "page_count": 10,
                "word_count": 2500,
                "language": "English",
                "topics": ["machine learning", "artificial intelligence"],
                "confidence": 0.95
            }
        }
    
    async def extract_text(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract text from document"""
        document_path = task_data.get("document_path", "")
        
        # Mock text extraction
        await asyncio.sleep(0.5)
        
        return {
            "status": "success",
            "extracted_text": f"Mock extracted text from {document_path}",
            "character_count": 15000
        }
    
    async def summarize_content(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Summarize document content"""
        content = task_data.get("content", "")
        
        # Mock summarization
        await asyncio.sleep(1.5)
        
        return {
            "status": "success",
            "summary": f"This is a mock summary of the provided content: {content[:100]}...",
            "summary_length": 200,
            "compression_ratio": 0.1
        }

class AnalysisAgent(Agent):
    def __init__(self):
        super().__init__(
            agent_id="analysis_agent_001",
            agent_type="data_analyst",
            capabilities=["data_analysis", "pattern_recognition", "insight_generation"]
        )
    
    async def handle_task_request(self, message: Message) -> Dict[str, Any]:
        """Handle analysis tasks"""
        task_type = message.payload.get("task_type")
        task_data = message.payload.get("task_data", {})
        
        if task_type == "analyze_patterns":
            return await self.analyze_patterns(task_data)
        elif task_type == "generate_insights":
            return await self.generate_insights(task_data)
        else:
            return {"status": "error", "message": f"Unknown task type: {task_type}"}
    
    async def analyze_patterns(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze patterns in data"""
        data = task_data.get("data", [])
        
        # Mock pattern analysis
        await asyncio.sleep(2)
        
        return {
            "status": "success",
            "patterns": [
                {"type": "trend", "description": "Increasing usage over time", "confidence": 0.87},
                {"type": "seasonal", "description": "Weekly cyclical pattern", "confidence": 0.92}
            ],
            "anomalies": [
                {"timestamp": "2024-01-15", "severity": "medium", "description": "Unusual spike"}
            ]
        }
    
    async def generate_insights(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate insights from analysis"""
        analysis_results = task_data.get("analysis_results", {})
        
        # Mock insight generation
        await asyncio.sleep(1)
        
        return {
            "status": "success",
            "insights": [
                {
                    "category": "performance",
                    "insight": "System performance has improved by 25% over the last month",
                    "confidence": 0.89,
                    "actionable": True
                },
                {
                    "category": "usage",
                    "insight": "Peak usage occurs on Tuesday afternoons",
                    "confidence": 0.94,
                    "actionable": True
                }
            ],
            "recommendations": [
                "Consider scaling resources during peak hours",
                "Implement caching to maintain performance improvements"
            ]
        }

class CoordinatorAgent(Agent):
    def __init__(self):
        super().__init__(
            agent_id="coordinator_agent_001",
            agent_type="coordinator",
            capabilities=["task_orchestration", "workflow_management", "agent_coordination"]
        )
        self.pending_tasks = {}
        self.agent_registry = {}
    
    async def handle_task_request(self, message: Message) -> Dict[str, Any]:
        """Handle coordination tasks"""
        task_type = message.payload.get("task_type")
        task_data = message.payload.get("task_data", {})
        
        if task_type == "orchestrate_workflow":
            return await self.orchestrate_workflow(task_data)
        elif task_type == "register_agent":
            return await self.register_agent_info(message.sender_id, task_data)
        else:
            return {"status": "error", "message": f"Unknown task type: {task_type}"}
    
    async def orchestrate_workflow(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Orchestrate a complex workflow across multiple agents"""
        workflow_id = str(uuid.uuid4())
        workflow_type = task_data.get("workflow_type", "")
        
        if workflow_type == "document_analysis_workflow":
            return await self.run_document_analysis_workflow(workflow_id, task_data)
        else:
            return {"status": "error", "message": f"Unknown workflow type: {workflow_type}"}
    
    async def run_document_analysis_workflow(self, workflow_id: str, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Run a document analysis workflow"""
        document_path = task_data.get("document_path", "")
        
        try:
            # Step 1: Document processing
            doc_correlation_id = await self.send_task_request(
                "document_agent_001",
                "analyze_document",
                {"document_path": document_path}
            )
            
            # Wait for document analysis (in real implementation, use proper async handling)
            await asyncio.sleep(2)
            
            # Step 2: Extract text
            text_correlation_id = await self.send_task_request(
                "document_agent_001",
                "extract_text",
                {"document_path": document_path}
            )
            
            await asyncio.sleep(1)
            
            # Step 3: Analyze patterns in extracted data
            analysis_correlation_id = await self.send_task_request(
                "analysis_agent_001",
                "analyze_patterns",
                {"data": ["mock", "extracted", "data"]}
            )
            
            await asyncio.sleep(3)
            
            # Step 4: Generate insights
            insights_correlation_id = await self.send_task_request(
                "analysis_agent_001",
                "generate_insights",
                {"analysis_results": {"patterns": "mock_patterns"}}
            )
            
            await asyncio.sleep(2)
            
            return {
                "status": "success",
                "workflow_id": workflow_id,
                "workflow_type": "document_analysis_workflow",
                "steps_completed": 4,
                "total_processing_time": 8,
                "result": {
                    "document_analyzed": True,
                    "text_extracted": True,
                    "patterns_identified": True,
                    "insights_generated": True
                }
            }
            
        except Exception as e:
            return {
                "status": "error",
                "workflow_id": workflow_id,
                "error": str(e)
            }
    
    async def register_agent_info(self, agent_id: str, agent_info: Dict[str, Any]) -> Dict[str, Any]:
        """Register agent information"""
        self.agent_registry[agent_id] = {
            **agent_info,
            "last_seen": datetime.now().isoformat()
        }
        
        return {
            "status": "success",
            "message": f"Agent {agent_id} registered successfully",
            "total_agents": len(self.agent_registry)
        }

# Multi-Agent System Manager
class MultiAgentSystem:
    def __init__(self):
        self.agents = {}
        self.running = False
    
    def add_agent(self, agent: Agent):
        """Add an agent to the system"""
        self.agents[agent.agent_id] = agent
    
    async def start_system(self):
        """Start all agents in the system"""
        self.running = True
        
        # Initialize all agents
        for agent in self.agents.values():
            await agent.initialize()
        
        # Start listening for all agents
        tasks = []
        for agent in self.agents.values():
            task = asyncio.create_task(agent.start_listening())
            tasks.append(task)
        
        logging.info(f"Multi-agent system started with {len(self.agents)} agents")
        
        # Wait for all agents to complete
        await asyncio.gather(*tasks)
    
    async def stop_system(self):
        """Stop all agents in the system"""
        self.running = False
        
        for agent in self.agents.values():
            await agent.stop()
        
        logging.info("Multi-agent system stopped")
    
    def get_system_status(self) -> Dict[str, Any]:
        """Get system status"""
        return {
            "total_agents": len(self.agents),
            "agent_types": {agent.agent_type for agent in self.agents.values()},
            "running": self.running
        }

# Demo application
async def run_multi_agent_demo():
    """Run multi-agent system demo"""
    
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    
    print("=== Multi-Agent System Demo ===\n")
    
    # Create multi-agent system
    mas = MultiAgentSystem()
    
    # Create agents
    document_agent = DocumentAgent()
    analysis_agent = AnalysisAgent()
    coordinator_agent = CoordinatorAgent()
    
    # Add agents to system
    mas.add_agent(document_agent)
    mas.add_agent(analysis_agent)
    mas.add_agent(coordinator_agent)
    
    # Start system in background
    system_task = asyncio.create_task(mas.start_system())
    
    # Wait for system to initialize
    await asyncio.sleep(3)
    
    # Test workflow orchestration
    print("Testing document analysis workflow...")
    
    workflow_correlation_id = await coordinator_agent.send_task_request(
        "coordinator_agent_001",
        "orchestrate_workflow",
        {
            "workflow_type": "document_analysis_workflow",
            "document_path": "/tmp/sample_document.pdf"
        }
    )
    
    print(f"Workflow started with correlation ID: {workflow_correlation_id}")
    
    # Let the workflow run
    await asyncio.sleep(10)
    
    # Get system status
    status = mas.get_system_status()
    print(f"\nSystem Status: {status}")
    
    # Stop system
    await mas.stop_system()

if __name__ == "__main__":
    asyncio.run(run_multi_agent_demo())
```

Continue with [Use Cases](/module3-genai-applications/use-cases/) to explore practical applications of multi-agent systems.