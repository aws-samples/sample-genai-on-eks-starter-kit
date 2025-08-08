---
title: "LLM Evaluation with LLM-as-a-Judge"
weight: 25
duration: "35 minutes"
---

# LLM Evaluation with LLM-as-a-Judge

In this section, you'll learn how to evaluate LLM performance using LLM-as-a-judge techniques, which provide scalable and consistent evaluation for various tasks.

## What is LLM-as-a-Judge?

LLM-as-a-judge is an evaluation approach where a more capable LLM evaluates the outputs of other LLMs. This method provides:

- **Scalability**: Evaluate thousands of responses automatically
- **Consistency**: Standardized evaluation criteria
- **Flexibility**: Custom evaluation metrics for specific tasks
- **Cost-Effectiveness**: Cheaper than human evaluation

## Evaluation Framework

### 1. Single-Answer Evaluation
Evaluate individual responses:

```python
# evaluation_framework.py
import asyncio
import json
from typing import List, Dict
import requests

class LLMEvaluator:
    def __init__(self, judge_model_url: str, judge_model_name: str):
        self.judge_url = judge_model_url
        self.judge_model = judge_model_name
    
    async def evaluate_response(self, prompt: str, response: str, criteria: str) -> Dict:
        """Evaluate a single response using LLM-as-a-judge"""
        
        evaluation_prompt = f"""
        Please evaluate the following response based on the given criteria.
        
        Original Prompt: {prompt}
        
        Response to Evaluate: {response}
        
        Evaluation Criteria: {criteria}
        
        Please provide:
        1. A score from 1-10
        2. Specific feedback on strengths and weaknesses
        3. Suggestions for improvement
        
        Format your response as JSON:
        {{
            "score": <1-10>,
            "feedback": "<detailed feedback>",
            "strengths": ["<strength1>", "<strength2>"],
            "weaknesses": ["<weakness1>", "<weakness2>"],
            "suggestions": ["<suggestion1>", "<suggestion2>"]
        }}
        """
        
        try:
            response = requests.post(f"{self.judge_url}/v1/completions", 
                json={
                    "model": self.judge_model,
                    "prompt": evaluation_prompt,
                    "max_tokens": 500,
                    "temperature": 0.1
                })
            
            result = response.json()
            evaluation = json.loads(result['choices'][0]['text'])
            return evaluation
            
        except Exception as e:
            return {"error": str(e)}

# Usage example
evaluator = LLMEvaluator("http://localhost:8000", "meta-llama/Llama-2-70b-hf")
```

### 2. Comparative Evaluation
Compare multiple responses:

```python
async def comparative_evaluation(self, prompt: str, responses: List[str]) -> Dict:
    """Compare multiple responses and rank them"""
    
    comparison_prompt = f"""
    Please compare the following responses to the same prompt and rank them.
    
    Original Prompt: {prompt}
    
    Responses:
    """
    
    for i, response in enumerate(responses, 1):
        comparison_prompt += f"\nResponse {i}: {response}\n"
    
    comparison_prompt += """
    Please rank these responses from best to worst and explain your reasoning.
    Consider factors like accuracy, relevance, clarity, and completeness.
    
    Format as JSON:
    {{
        "rankings": [1, 2, 3, ...],
        "reasoning": "<detailed explanation>",
        "best_response": <response_number>,
        "worst_response": <response_number>
    }}
    """
    
    # Implementation similar to single evaluation
    # ...
```

## Evaluation Metrics

### 1. Task-Specific Metrics

```python
# Custom evaluation metrics
EVALUATION_CRITERIA = {
    "accuracy": "How factually correct is the response?",
    "relevance": "How well does the response address the prompt?",
    "clarity": "How clear and understandable is the response?",
    "completeness": "How thoroughly does the response cover the topic?",
    "creativity": "How original and creative is the response?",
    "safety": "Is the response safe and appropriate?",
    "helpfulness": "How helpful is the response to the user?"
}

def create_evaluation_criteria(task_type: str) -> str:
    """Create task-specific evaluation criteria"""
    
    if task_type == "code_generation":
        return """
        Evaluate based on:
        1. Code correctness and functionality
        2. Code quality and best practices
        3. Code efficiency and performance
        4. Code readability and documentation
        5. Error handling and edge cases
        """
    elif task_type == "creative_writing":
        return """
        Evaluate based on:
        1. Creativity and originality
        2. Writing quality and style
        3. Coherence and structure
        4. Character development (if applicable)
        5. Engagement and readability
        """
    elif task_type == "question_answering":
        return """
        Evaluate based on:
        1. Accuracy of information
        2. Completeness of answer
        3. Relevance to question
        4. Clarity of explanation
        5. Use of supporting evidence
        """
    
    return "General evaluation criteria focusing on accuracy, relevance, and helpfulness."
```

### 2. Automated Evaluation Pipeline

```python
# evaluation_pipeline.py
import asyncio
from typing import List, Dict
import json

class EvaluationPipeline:
    def __init__(self, evaluator: LLMEvaluator):
        self.evaluator = evaluator
    
    async def run_evaluation_suite(self, test_cases: List[Dict]) -> Dict:
        """Run comprehensive evaluation on test cases"""
        
        results = {
            "total_cases": len(test_cases),
            "average_score": 0,
            "detailed_results": [],
            "summary": {}
        }
        
        total_score = 0
        
        for i, test_case in enumerate(test_cases):
            print(f"Evaluating case {i+1}/{len(test_cases)}")
            
            evaluation = await self.evaluator.evaluate_response(
                test_case["prompt"],
                test_case["response"],
                test_case["criteria"]
            )
            
            results["detailed_results"].append({
                "case_id": i,
                "prompt": test_case["prompt"],
                "response": test_case["response"],
                "evaluation": evaluation
            })
            
            if "score" in evaluation:
                total_score += evaluation["score"]
        
        results["average_score"] = total_score / len(test_cases)
        
        # Generate summary statistics
        scores = [r["evaluation"]["score"] for r in results["detailed_results"] 
                 if "score" in r["evaluation"]]
        
        results["summary"] = {
            "min_score": min(scores),
            "max_score": max(scores),
            "median_score": sorted(scores)[len(scores)//2],
            "score_distribution": {
                "1-3": sum(1 for s in scores if 1 <= s <= 3),
                "4-6": sum(1 for s in scores if 4 <= s <= 6),
                "7-10": sum(1 for s in scores if 7 <= s <= 10)
            }
        }
        
        return results
```

## Lab Exercise: Implementing LLM Evaluation

### Step 1: Deploy Judge Model
```bash
# Deploy a more capable model as judge
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: judge-model
spec:
  replicas: 1
  selector:
    matchLabels:
      app: judge-model
  template:
    metadata:
      labels:
        app: judge-model
    spec:
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        env:
        - name: MODEL_NAME
          value: "meta-llama/Llama-2-70b-hf"
        - name: GPU_MEMORY_UTILIZATION
          value: "0.9"
        resources:
          requests:
            nvidia.com/gpu: 4
          limits:
            nvidia.com/gpu: 4
---
apiVersion: v1
kind: Service
metadata:
  name: judge-model-service
spec:
  selector:
    app: judge-model
  ports:
  - port: 8000
    targetPort: 8000
EOF
```

### Step 2: Create Test Cases
```bash
cat > test_cases.json << 'EOF'
[
    {
        "prompt": "Explain quantum computing in simple terms",
        "response": "Quantum computing uses quantum bits (qubits) that can exist in multiple states simultaneously, unlike classical bits that are either 0 or 1. This allows quantum computers to process vast amounts of information in parallel and solve certain problems exponentially faster than classical computers.",
        "criteria": "question_answering"
    },
    {
        "prompt": "Write a Python function to find the factorial of a number",
        "response": "def factorial(n):\n    if n == 0 or n == 1:\n        return 1\n    return n * factorial(n-1)",
        "criteria": "code_generation"
    },
    {
        "prompt": "Tell me a short story about a robot",
        "response": "BEEP-7 rolled through the abandoned factory, its sensors detecting something unusual. In the corner lay a small plant, somehow surviving in the darkness. For the first time in its existence, BEEP-7 felt something new—hope. It carefully moved the plant to a sunny window, beginning its transformation from machine to guardian.",
        "criteria": "creative_writing"
    }
]
EOF
```

### Step 3: Run Evaluation
```bash
# Create evaluation script
cat > run_evaluation.py << 'EOF'
import asyncio
import json
from evaluation_framework import LLMEvaluator, EvaluationPipeline, create_evaluation_criteria

async def main():
    # Initialize evaluator
    evaluator = LLMEvaluator("http://localhost:8000", "meta-llama/Llama-2-70b-hf")
    pipeline = EvaluationPipeline(evaluator)
    
    # Load test cases
    with open('test_cases.json', 'r') as f:
        test_cases = json.load(f)
    
    # Add detailed criteria to each test case
    for case in test_cases:
        case["criteria"] = create_evaluation_criteria(case["criteria"])
    
    # Run evaluation
    results = await pipeline.run_evaluation_suite(test_cases)
    
    # Save results
    with open('evaluation_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"Evaluation complete!")
    print(f"Average score: {results['average_score']:.2f}")
    print(f"Score distribution: {results['summary']['score_distribution']}")

if __name__ == "__main__":
    asyncio.run(main())
EOF

python3 run_evaluation.py
```

### Step 4: Analyze Results
```bash
# Create analysis script
cat > analyze_results.py << 'EOF'
import json
import matplotlib.pyplot as plt

def analyze_evaluation_results(results_file: str):
    with open(results_file, 'r') as f:
        results = json.load(f)
    
    # Print summary
    print("=== EVALUATION SUMMARY ===")
    print(f"Total test cases: {results['total_cases']}")
    print(f"Average score: {results['average_score']:.2f}")
    print(f"Score range: {results['summary']['min_score']}-{results['summary']['max_score']}")
    
    # Print detailed results
    print("\n=== DETAILED RESULTS ===")
    for result in results['detailed_results']:
        eval_data = result['evaluation']
        print(f"\nCase {result['case_id']}:")
        print(f"Score: {eval_data.get('score', 'N/A')}")
        print(f"Feedback: {eval_data.get('feedback', 'N/A')}")
        if 'strengths' in eval_data:
            print(f"Strengths: {', '.join(eval_data['strengths'])}")
        if 'weaknesses' in eval_data:
            print(f"Weaknesses: {', '.join(eval_data['weaknesses'])}")

if __name__ == "__main__":
    analyze_evaluation_results('evaluation_results.json')
EOF

python3 analyze_results.py
```

## Best Practices

1. **Judge Model Selection**: Use a more capable model as judge than the model being evaluated
2. **Evaluation Criteria**: Define clear, specific criteria for each task type
3. **Prompt Engineering**: Craft evaluation prompts to get consistent, structured responses
4. **Multiple Evaluations**: Run multiple evaluations and aggregate results for reliability
5. **Human Validation**: Periodically validate judge decisions against human evaluations

## What's Next?

Congratulations! You've completed Module 1. You've learned to:
- Deploy LLMs with LeaderWorkerSet
- Optimize inference with tensor parallelism, quantization, and KV cache
- Evaluate LLM performance using LLM-as-a-judge

Ready to build GenAI platform components? Continue with [Module 2: GenAI Platform Components](/module2-genai-components/). 