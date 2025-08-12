---
title: "Memory Stores and Vector Databases"
weight: 42
duration: "30 minutes"
difficulty: "intermediate"
---

# Memory Stores and Vector Databases

Learn how to implement persistent memory solutions for GenAI agents using vector databases and other storage systems to enable long-term context and knowledge retention.

## Overview

Memory stores are crucial for agentic applications, providing persistent storage for embeddings, conversation history, and learned knowledge. This enables agents to maintain context across sessions and improve over time.

## Learning Objectives

By the end of this lab, you will be able to:
- Deploy and configure vector databases (Chroma, pgvector)
- Implement persistent memory for agent applications
- Design memory architectures for different use cases
- Optimize vector search performance
- Integrate memory stores with agent frameworks

## Prerequisites

- Completed [Frameworks](/module3-genai-applications/frameworks/)
- Understanding of vector embeddings and similarity search
- Basic knowledge of database concepts

## Memory Store Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Memory Store Architecture                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Agents    │  │  Workflows  │  │   Tools     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                 │                 │              │
│  ┌─────────────────────────────────────────────────────────┤
│  │              Memory Management Layer                    │
│  └─────────────────────────────────────────────────────────┤
│         │                 │                 │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Vector DB   │  │ Graph DB    │  │ Cache       │        │
│  │ (Semantic)  │  │ (Relations) │  │ (Session)   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Lab: Implementing Memory Stores

### Step 1: Deploy ChromaDB Vector Database

```yaml
# chromadb-deployment.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: chromadb-pvc
  namespace: genai-applications
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: gp3
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chromadb
  namespace: genai-applications
  labels:
    app: chromadb
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chromadb
  template:
    metadata:
      labels:
        app: chromadb
    spec:
      containers:
      - name: chromadb
        image: chromadb/chroma:latest
        ports:
        - containerPort: 8000
        env:
        - name: CHROMA_SERVER_HOST
          value: "0.0.0.0"
        - name: CHROMA_SERVER_HTTP_PORT
          value: "8000"
        - name: PERSIST_DIRECTORY
          value: "/chroma/data"
        volumeMounts:
        - name: chromadb-storage
          mountPath: /chroma/data
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /api/v1/heartbeat
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/v1/heartbeat
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: chromadb-storage
        persistentVolumeClaim:
          claimName: chromadb-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: chromadb-service
  namespace: genai-applications
  labels:
    app: chromadb
spec:
  selector:
    app: chromadb
  ports:
  - port: 8000
    targetPort: 8000
    protocol: TCP
  type: ClusterIP
```

### Step 2: Deploy PostgreSQL with pgvector Extension

```yaml
# pgvector-deployment.yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secret
  namespace: genai-applications
type: Opaque
stringData:
  POSTGRES_DB: vectordb
  POSTGRES_USER: vectoruser
  POSTGRES_PASSWORD: vectorpass123
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: genai-applications
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: gp3
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres-pgvector
  namespace: genai-applications
  labels:
    app: postgres-pgvector
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres-pgvector
  template:
    metadata:
      labels:
        app: postgres-pgvector
    spec:
      containers:
      - name: postgres
        image: pgvector/pgvector:pg16
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_DB
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: POSTGRES_DB
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: POSTGRES_USER
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: POSTGRES_PASSWORD
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - vectoruser
            - -d
            - vectordb
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - vectoruser
            - -d
            - vectordb
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: postgres-storage
        persistentVolumeClaim:
          claimName: postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-pgvector-service
  namespace: genai-applications
  labels:
    app: postgres-pgvector
spec:
  selector:
    app: postgres-pgvector
  ports:
  - port: 5432
    targetPort: 5432
    protocol: TCP
  type: ClusterIP
```

### Step 3: Create Memory Management System

```python
# memory_management.py
import chromadb
import psycopg2
import numpy as np
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime
import json
import hashlib

@dataclass
class MemoryItem:
    content: str
    embedding: List[float]
    metadata: Dict[str, Any]
    timestamp: datetime
    memory_type: str  # 'episodic', 'semantic', 'procedural'

class VectorMemoryStore:
    def __init__(self, chroma_host: str = "chromadb-service", chroma_port: int = 8000):
        self.client = chromadb.HttpClient(host=chroma_host, port=chroma_port)
        self.collections = {}
    
    def create_collection(self, name: str, metadata: Optional[Dict] = None):
        """Create a new collection for storing memories"""
        try:
            collection = self.client.create_collection(
                name=name,
                metadata=metadata or {}
            )
            self.collections[name] = collection
            return collection
        except Exception as e:
            # Collection might already exist
            collection = self.client.get_collection(name=name)
            self.collections[name] = collection
            return collection
    
    def add_memory(self, collection_name: str, memory: MemoryItem):
        """Add a memory item to the collection"""
        collection = self.collections.get(collection_name)
        if not collection:
            collection = self.create_collection(collection_name)
        
        # Generate unique ID
        memory_id = hashlib.md5(
            f"{memory.content}{memory.timestamp}".encode()
        ).hexdigest()
        
        collection.add(
            embeddings=[memory.embedding],
            documents=[memory.content],
            metadatas=[{
                **memory.metadata,
                "timestamp": memory.timestamp.isoformat(),
                "memory_type": memory.memory_type
            }],
            ids=[memory_id]
        )
        
        return memory_id
    
    def search_memories(self, collection_name: str, query_embedding: List[float], 
                       n_results: int = 5, where: Optional[Dict] = None):
        """Search for similar memories"""
        collection = self.collections.get(collection_name)
        if not collection:
            return []
        
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where
        )
        
        return results
    
    def get_collection_stats(self, collection_name: str):
        """Get statistics about a collection"""
        collection = self.collections.get(collection_name)
        if not collection:
            return {}
        
        return {
            "count": collection.count(),
            "name": collection_name
        }

class PostgreSQLMemoryStore:
    def __init__(self, host: str = "postgres-pgvector-service", 
                 port: int = 5432, database: str = "vectordb",
                 user: str = "vectoruser", password: str = "vectorpass123"):
        
        self.connection_params = {
            "host": host,
            "port": port,
            "database": database,
            "user": user,
            "password": password
        }
        self.conn = None
        self.connect()
        self.setup_tables()
    
    def connect(self):
        """Connect to PostgreSQL database"""
        try:
            self.conn = psycopg2.connect(**self.connection_params)
            self.conn.autocommit = True
            
            # Enable pgvector extension
            with self.conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
                
        except Exception as e:
            print(f"Failed to connect to PostgreSQL: {e}")
            raise
    
    def setup_tables(self):
        """Set up memory tables"""
        with self.conn.cursor() as cur:
            # Create memories table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id SERIAL PRIMARY KEY,
                    content TEXT NOT NULL,
                    embedding vector(1536),  -- OpenAI embedding dimension
                    metadata JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    memory_type VARCHAR(50),
                    agent_id VARCHAR(100),
                    session_id VARCHAR(100)
                );
            """)
            
            # Create index for vector similarity search
            cur.execute("""
                CREATE INDEX IF NOT EXISTS memories_embedding_idx 
                ON memories USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100);
            """)
            
            # Create conversations table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    session_id VARCHAR(100) NOT NULL,
                    agent_id VARCHAR(100) NOT NULL,
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    metadata JSONB
                );
            """)
    
    def add_memory(self, content: str, embedding: List[float], 
                   memory_type: str, agent_id: str, session_id: str,
                   metadata: Optional[Dict] = None):
        """Add a memory to PostgreSQL"""
        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO memories (content, embedding, memory_type, agent_id, session_id, metadata)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (
                content,
                embedding,
                memory_type,
                agent_id,
                session_id,
                json.dumps(metadata or {})
            ))
            
            return cur.fetchone()[0]
    
    def search_similar_memories(self, query_embedding: List[float], 
                               agent_id: str, limit: int = 5,
                               memory_type: Optional[str] = None):
        """Search for similar memories using vector similarity"""
        with self.conn.cursor() as cur:
            where_clause = "WHERE agent_id = %s"
            params = [query_embedding, agent_id]
            
            if memory_type:
                where_clause += " AND memory_type = %s"
                params.append(memory_type)
            
            cur.execute(f"""
                SELECT id, content, metadata, timestamp, memory_type,
                       embedding <=> %s as distance
                FROM memories
                {where_clause}
                ORDER BY embedding <=> %s
                LIMIT %s;
            """, params + [query_embedding, limit])
            
            return cur.fetchall()
    
    def add_conversation_turn(self, session_id: str, agent_id: str, 
                             role: str, content: str, metadata: Optional[Dict] = None):
        """Add a conversation turn"""
        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO conversations (session_id, agent_id, role, content, metadata)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id;
            """, (session_id, agent_id, role, content, json.dumps(metadata or {})))
            
            return cur.fetchone()[0]
    
    def get_conversation_history(self, session_id: str, limit: int = 50):
        """Get conversation history for a session"""
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT role, content, timestamp, metadata
                FROM conversations
                WHERE session_id = %s
                ORDER BY timestamp DESC
                LIMIT %s;
            """, (session_id, limit))
            
            return cur.fetchall()

class HybridMemoryManager:
    """Combines multiple memory stores for comprehensive memory management"""
    
    def __init__(self):
        self.vector_store = VectorMemoryStore()
        self.sql_store = PostgreSQLMemoryStore()
        self.embedding_model = None  # Would be initialized with actual embedding model
    
    def initialize_agent_memory(self, agent_id: str):
        """Initialize memory collections for a new agent"""
        collections = [
            f"{agent_id}_episodic",    # Specific experiences and events
            f"{agent_id}_semantic",    # General knowledge and facts
            f"{agent_id}_procedural"   # Skills and procedures
        ]
        
        for collection_name in collections:
            self.vector_store.create_collection(
                collection_name,
                metadata={"agent_id": agent_id, "type": collection_name.split("_")[1]}
            )
    
    def store_experience(self, agent_id: str, session_id: str, 
                        experience: str, context: Dict[str, Any]):
        """Store an experience in both vector and SQL stores"""
        
        # Generate embedding (mock implementation)
        embedding = self._generate_embedding(experience)
        
        # Store in vector database for similarity search
        memory_item = MemoryItem(
            content=experience,
            embedding=embedding,
            metadata=context,
            timestamp=datetime.now(),
            memory_type="episodic"
        )
        
        vector_id = self.vector_store.add_memory(
            f"{agent_id}_episodic", 
            memory_item
        )
        
        # Store in SQL database for structured queries
        sql_id = self.sql_store.add_memory(
            content=experience,
            embedding=embedding,
            memory_type="episodic",
            agent_id=agent_id,
            session_id=session_id,
            metadata=context
        )
        
        return {"vector_id": vector_id, "sql_id": sql_id}
    
    def retrieve_relevant_memories(self, agent_id: str, query: str, 
                                  memory_type: str = "episodic", limit: int = 5):
        """Retrieve memories relevant to a query"""
        
        # Generate query embedding
        query_embedding = self._generate_embedding(query)
        
        # Search vector store
        vector_results = self.vector_store.search_memories(
            f"{agent_id}_{memory_type}",
            query_embedding,
            n_results=limit
        )
        
        # Search SQL store
        sql_results = self.sql_store.search_similar_memories(
            query_embedding,
            agent_id,
            limit=limit,
            memory_type=memory_type
        )
        
        return {
            "vector_results": vector_results,
            "sql_results": sql_results
        }
    
    def _generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text (mock implementation)"""
        # In real implementation, this would use an actual embedding model
        # For demo purposes, return random embedding
        return np.random.rand(1536).tolist()
    
    def get_memory_statistics(self, agent_id: str):
        """Get memory statistics for an agent"""
        stats = {}
        
        for memory_type in ["episodic", "semantic", "procedural"]:
            collection_name = f"{agent_id}_{memory_type}"
            stats[memory_type] = self.vector_store.get_collection_stats(collection_name)
        
        return stats

# Example usage and testing
class MemoryStoreDemo:
    def __init__(self):
        self.memory_manager = HybridMemoryManager()
    
    def run_demo(self):
        """Run a comprehensive demo of memory store functionality"""
        
        agent_id = "demo_agent_001"
        session_id = "session_123"
        
        print("=== Memory Store Demo ===\n")
        
        # Initialize agent memory
        print("1. Initializing agent memory...")
        self.memory_manager.initialize_agent_memory(agent_id)
        
        # Store some experiences
        print("2. Storing experiences...")
        experiences = [
            {
                "experience": "User asked about machine learning algorithms",
                "context": {"topic": "ML", "difficulty": "beginner", "satisfaction": 0.8}
            },
            {
                "experience": "Successfully helped user debug Python code",
                "context": {"topic": "programming", "language": "python", "success": True}
            },
            {
                "experience": "User requested information about neural networks",
                "context": {"topic": "AI", "subtopic": "neural_networks", "depth": "intermediate"}
            }
        ]
        
        for exp in experiences:
            result = self.memory_manager.store_experience(
                agent_id, session_id, exp["experience"], exp["context"]
            )
            print(f"Stored experience: {result}")
        
        # Retrieve relevant memories
        print("\n3. Retrieving relevant memories...")
        query = "Help with programming"
        memories = self.memory_manager.retrieve_relevant_memories(
            agent_id, query, memory_type="episodic", limit=3
        )
        print(f"Relevant memories for '{query}':")
        print(f"Vector results: {len(memories['vector_results']['documents'][0]) if memories['vector_results']['documents'] else 0}")
        print(f"SQL results: {len(memories['sql_results'])}")
        
        # Get statistics
        print("\n4. Memory statistics:")
        stats = self.memory_manager.get_memory_statistics(agent_id)
        for memory_type, stat in stats.items():
            print(f"{memory_type}: {stat}")

if __name__ == "__main__":
    demo = MemoryStoreDemo()
    demo.run_demo()
```

### Step 4: Create Memory Store Configuration

```yaml
# memory-store-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: memory-store-config
  namespace: genai-applications
data:
  memory_management.py: |
    # [Include the Python code from Step 3]
  
  requirements.txt: |
    chromadb==0.4.18
    psycopg2-binary==2.9.9
    numpy==1.24.3
    
  demo_runner.py: |
    import subprocess
    import sys
    import time
    
    # Install requirements
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
    
    # Wait for services to be ready
    print("Waiting for services to be ready...")
    time.sleep(30)
    
    # Run the demo
    exec(open("memory_management.py").read())
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: memory-demo-app
  namespace: genai-applications
spec:
  replicas: 1
  selector:
    matchLabels:
      app: memory-demo-app
  template:
    metadata:
      labels:
        app: memory-demo-app
    spec:
      containers:
      - name: demo-app
        image: python:3.11-slim
        command: ["/bin/bash"]
        args: ["-c", "while true; do sleep 30; done"]
        volumeMounts:
        - name: demo-code
          mountPath: /app
        workingDir: /app
        resources:
          requests:
            cpu: 200m
            memory: 512Mi
          limits:
            cpu: 500m
            memory: 1Gi
      volumes:
      - name: demo-code
        configMap:
          name: memory-store-config
```

### Step 5: Deploy and Test Memory Stores

```bash
# Create namespace
kubectl create namespace genai-applications

# Deploy ChromaDB
kubectl apply -f chromadb-deployment.yaml

# Deploy PostgreSQL with pgvector
kubectl apply -f pgvector-deployment.yaml

# Deploy demo application
kubectl apply -f memory-store-config.yaml

# Wait for deployments
kubectl wait --for=condition=available --timeout=300s deployment/chromadb -n genai-applications
kubectl wait --for=condition=available --timeout=300s deployment/postgres-pgvector -n genai-applications
kubectl wait --for=condition=available --timeout=300s deployment/memory-demo-app -n genai-applications

# Run the memory store demo
kubectl exec -it deployment/memory-demo-app -n genai-applications -- python demo_runner.py
```

## Advanced Memory Patterns

### 1. Hierarchical Memory

```python
# hierarchical_memory.py
from typing import Dict, List, Any
from datetime import datetime, timedelta
import json

class HierarchicalMemory:
    """Implements hierarchical memory with different retention policies"""
    
    def __init__(self, memory_manager):
        self.memory_manager = memory_manager
        self.retention_policies = {
            "working": timedelta(hours=1),      # Short-term working memory
            "short_term": timedelta(days=7),    # Short-term memory
            "long_term": timedelta(days=365),   # Long-term memory
            "permanent": None                   # Permanent memory
        }
    
    def store_with_hierarchy(self, agent_id: str, content: str, 
                           importance_score: float, context: Dict[str, Any]):
        """Store memory with appropriate hierarchy level"""
        
        # Determine hierarchy level based on importance
        if importance_score >= 0.9:
            hierarchy = "permanent"
        elif importance_score >= 0.7:
            hierarchy = "long_term"
        elif importance_score >= 0.4:
            hierarchy = "short_term"
        else:
            hierarchy = "working"
        
        # Add hierarchy information to context
        enhanced_context = {
            **context,
            "hierarchy": hierarchy,
            "importance_score": importance_score,
            "retention_until": self._calculate_retention_date(hierarchy)
        }
        
        return self.memory_manager.store_experience(
            agent_id, 
            context.get("session_id", "default"),
            content,
            enhanced_context
        )
    
    def _calculate_retention_date(self, hierarchy: str) -> str:
        """Calculate retention date based on hierarchy"""
        policy = self.retention_policies.get(hierarchy)
        if policy is None:
            return "permanent"
        
        retention_date = datetime.now() + policy
        return retention_date.isoformat()
    
    def cleanup_expired_memories(self, agent_id: str):
        """Clean up expired memories based on retention policies"""
        # Implementation would query and delete expired memories
        pass

class ContextualMemory:
    """Implements contextual memory that considers situational factors"""
    
    def __init__(self, memory_manager):
        self.memory_manager = memory_manager
    
    def store_contextual_memory(self, agent_id: str, content: str,
                               context: Dict[str, Any]):
        """Store memory with rich contextual information"""
        
        enhanced_context = {
            **context,
            "emotional_state": self._analyze_emotional_context(content),
            "topic_category": self._categorize_topic(content),
            "interaction_quality": self._assess_interaction_quality(context),
            "user_satisfaction": context.get("satisfaction", 0.5)
        }
        
        return self.memory_manager.store_experience(
            agent_id,
            context.get("session_id", "default"),
            content,
            enhanced_context
        )
    
    def _analyze_emotional_context(self, content: str) -> str:
        """Analyze emotional context of the content"""
        # Simplified emotion analysis
        positive_words = ["good", "great", "excellent", "happy", "satisfied"]
        negative_words = ["bad", "terrible", "frustrated", "angry", "disappointed"]
        
        content_lower = content.lower()
        positive_count = sum(1 for word in positive_words if word in content_lower)
        negative_count = sum(1 for word in negative_words if word in content_lower)
        
        if positive_count > negative_count:
            return "positive"
        elif negative_count > positive_count:
            return "negative"
        else:
            return "neutral"
    
    def _categorize_topic(self, content: str) -> str:
        """Categorize the topic of the content"""
        # Simplified topic categorization
        categories = {
            "technical": ["code", "programming", "algorithm", "debug", "error"],
            "educational": ["learn", "explain", "understand", "teach", "concept"],
            "creative": ["create", "design", "write", "generate", "imagine"],
            "analytical": ["analyze", "compare", "evaluate", "assess", "review"]
        }
        
        content_lower = content.lower()
        scores = {}
        
        for category, keywords in categories.items():
            scores[category] = sum(1 for keyword in keywords if keyword in content_lower)
        
        return max(scores, key=scores.get) if max(scores.values()) > 0 else "general"
    
    def _assess_interaction_quality(self, context: Dict[str, Any]) -> float:
        """Assess the quality of the interaction"""
        # Simplified quality assessment
        factors = {
            "success": context.get("success", False),
            "satisfaction": context.get("satisfaction", 0.5),
            "completion": context.get("task_completed", False),
            "clarity": context.get("response_clarity", 0.5)
        }
        
        quality_score = 0.0
        if factors["success"]:
            quality_score += 0.3
        quality_score += factors["satisfaction"] * 0.3
        if factors["completion"]:
            quality_score += 0.2
        quality_score += factors["clarity"] * 0.2
        
        return min(quality_score, 1.0)
```

### 2. Memory Consolidation

```python
# memory_consolidation.py
import asyncio
from typing import List, Dict, Any
from datetime import datetime, timedelta

class MemoryConsolidation:
    """Implements memory consolidation processes"""
    
    def __init__(self, memory_manager):
        self.memory_manager = memory_manager
    
    async def consolidate_memories(self, agent_id: str):
        """Consolidate memories by identifying patterns and relationships"""
        
        print(f"Starting memory consolidation for agent {agent_id}")
        
        # Get recent memories
        recent_memories = await self._get_recent_memories(agent_id, days=7)
        
        # Identify patterns
        patterns = self._identify_patterns(recent_memories)
        
        # Create consolidated memories
        for pattern in patterns:
            consolidated_memory = self._create_consolidated_memory(pattern)
            
            # Store consolidated memory
            self.memory_manager.store_experience(
                agent_id,
                "consolidation_session",
                consolidated_memory["content"],
                consolidated_memory["context"]
            )
        
        print(f"Consolidated {len(patterns)} memory patterns")
    
    async def _get_recent_memories(self, agent_id: str, days: int = 7) -> List[Dict]:
        """Get recent memories for consolidation"""
        # Mock implementation - would query actual memory stores
        return [
            {
                "content": "User asked about Python debugging",
                "context": {"topic": "programming", "language": "python"},
                "timestamp": datetime.now() - timedelta(days=1)
            },
            {
                "content": "User needed help with Python error handling",
                "context": {"topic": "programming", "language": "python"},
                "timestamp": datetime.now() - timedelta(days=2)
            },
            {
                "content": "Explained Python best practices",
                "context": {"topic": "programming", "language": "python"},
                "timestamp": datetime.now() - timedelta(days=3)
            }
        ]
    
    def _identify_patterns(self, memories: List[Dict]) -> List[Dict]:
        """Identify patterns in memories"""
        patterns = []
        
        # Group by topic
        topic_groups = {}
        for memory in memories:
            topic = memory["context"].get("topic", "general")
            if topic not in topic_groups:
                topic_groups[topic] = []
            topic_groups[topic].append(memory)
        
        # Create patterns for topics with multiple memories
        for topic, topic_memories in topic_groups.items():
            if len(topic_memories) >= 3:  # Minimum threshold for pattern
                patterns.append({
                    "type": "topic_pattern",
                    "topic": topic,
                    "memories": topic_memories,
                    "frequency": len(topic_memories)
                })
        
        return patterns
    
    def _create_consolidated_memory(self, pattern: Dict) -> Dict:
        """Create a consolidated memory from a pattern"""
        
        if pattern["type"] == "topic_pattern":
            topic = pattern["topic"]
            frequency = pattern["frequency"]
            
            content = f"User frequently asks about {topic}. " \
                     f"This topic has come up {frequency} times recently. " \
                     f"Consider proactive assistance in this area."
            
            context = {
                "memory_type": "consolidated",
                "pattern_type": "topic_frequency",
                "topic": topic,
                "frequency": frequency,
                "importance_score": min(frequency * 0.2, 1.0)
            }
            
            return {"content": content, "context": context}
        
        return {"content": "", "context": {}}

# Usage example
async def run_consolidation_demo():
    memory_manager = HybridMemoryManager()
    consolidator = MemoryConsolidation(memory_manager)
    
    agent_id = "consolidation_demo_agent"
    
    # Initialize and run consolidation
    memory_manager.initialize_agent_memory(agent_id)
    await consolidator.consolidate_memories(agent_id)

if __name__ == "__main__":
    asyncio.run(run_consolidation_demo())
```

## Performance Optimization

### 1. Vector Index Optimization

```python
# vector_optimization.py
import time
from typing import List, Dict, Any

class VectorIndexOptimizer:
    """Optimizes vector database performance"""
    
    def __init__(self, vector_store):
        self.vector_store = vector_store
    
    def optimize_collection(self, collection_name: str):
        """Optimize a vector collection for better performance"""
        
        collection = self.vector_store.collections.get(collection_name)
        if not collection:
            print(f"Collection {collection_name} not found")
            return
        
        # Get collection statistics
        stats = collection.count()
        print(f"Optimizing collection {collection_name} with {stats} items")
        
        # Perform optimization (implementation depends on vector DB)
        # This is a placeholder for actual optimization logic
        
    def benchmark_search_performance(self, collection_name: str, 
                                   query_embeddings: List[List[float]],
                                   n_results: int = 5):
        """Benchmark search performance"""
        
        collection = self.vector_store.collections.get(collection_name)
        if not collection:
            return {}
        
        search_times = []
        
        for query_embedding in query_embeddings:
            start_time = time.time()
            
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=n_results
            )
            
            search_time = time.time() - start_time
            search_times.append(search_time)
        
        return {
            "avg_search_time": sum(search_times) / len(search_times),
            "min_search_time": min(search_times),
            "max_search_time": max(search_times),
            "total_queries": len(query_embeddings)
        }
```

### 2. Memory Usage Monitoring

```python
# memory_monitoring.py
import psutil
import time
from typing import Dict, Any

class MemoryUsageMonitor:
    """Monitors memory usage of memory stores"""
    
    def __init__(self):
        self.metrics = []
    
    def collect_metrics(self, duration_seconds: int = 60):
        """Collect memory usage metrics"""
        
        end_time = time.time() + duration_seconds
        
        while time.time() < end_time:
            metrics = {
                "timestamp": time.time(),
                "cpu_percent": psutil.cpu_percent(),
                "memory_percent": psutil.virtual_memory().percent,
                "disk_usage": psutil.disk_usage('/').percent
            }
            
            self.metrics.append(metrics)
            time.sleep(5)  # Collect every 5 seconds
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary of collected metrics"""
        
        if not self.metrics:
            return {}
        
        cpu_values = [m["cpu_percent"] for m in self.metrics]
        memory_values = [m["memory_percent"] for m in self.metrics]
        
        return {
            "avg_cpu": sum(cpu_values) / len(cpu_values),
            "max_cpu": max(cpu_values),
            "avg_memory": sum(memory_values) / len(memory_values),
            "max_memory": max(memory_values),
            "sample_count": len(self.metrics)
        }
```

## Troubleshooting

### Common Issues

1. **ChromaDB Connection Issues**: Check service availability and network policies
2. **PostgreSQL Connection Errors**: Verify credentials and database initialization
3. **Vector Search Performance**: Optimize index settings and query parameters
4. **Memory Leaks**: Monitor memory usage and implement cleanup procedures

### Diagnostic Commands

```bash
# Check ChromaDB status
kubectl logs deployment/chromadb -n genai-applications

# Check PostgreSQL status
kubectl logs deployment/postgres-pgvector -n genai-applications

# Test ChromaDB connectivity
kubectl exec -it deployment/memory-demo-app -n genai-applications -- \
  curl http://chromadb-service:8000/api/v1/heartbeat

# Test PostgreSQL connectivity
kubectl exec -it deployment/postgres-pgvector -n genai-applications -- \
  psql -U vectoruser -d vectordb -c "SELECT version();"
```

## Best Practices

1. **Data Modeling**: Design memory schemas based on access patterns
2. **Indexing**: Create appropriate indexes for vector and metadata searches
3. **Retention Policies**: Implement memory cleanup based on importance and age
4. **Backup Strategy**: Regular backups of memory stores
5. **Performance Monitoring**: Continuous monitoring of search performance

## Next Steps

Continue with [MCP Integration](/module3-genai-applications/mcp-integration/) to learn about Model Context Protocol for tool integration.