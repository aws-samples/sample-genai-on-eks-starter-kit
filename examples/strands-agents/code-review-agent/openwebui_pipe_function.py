import requests
from pydantic import BaseModel


class Pipe:
    class Valves(BaseModel):
        AGENT_ENDPOINT: str = "http://code-review-agent.strands-agents"
        REQUEST_TIMEOUT: int = 120

    def __init__(self):
        self.valves = self.Valves()

    def pipes(self):
        return [
            {
                "id": "strands_agents_code_review_agent",
                "name": "Strands Agents - Code Review Agent",
            }
        ]

    def pipe(self, body: dict, __user__: dict):
        messages = body.get("messages", [])
        last_user_message = next(
            (m for m in reversed(messages) if m.get("role") == "user"), None
        )

        if not last_user_message:
            return

        message = last_user_message["content"]
        if message.startswith("### Task"):
            print("Skip: ### Task")
            return

        print("Latest user message:", message)

        try:
            response = requests.post(
                url=self.valves.AGENT_ENDPOINT,
                json={"prompt": message},
                headers={"Content-Type": "application/json"},
                stream=True,
                timeout=self.valves.REQUEST_TIMEOUT,
            )
            response.raise_for_status()

            if body.get("stream", False):
                return self.stream_response(response)
            else:
                return response.text
        except requests.exceptions.Timeout:
            return "Error: Request timed out. The agent may be busy, please try again."
        except requests.exceptions.ConnectionError:
            return "Error: Could not connect to agent. Please verify it is running."
        except Exception as e:
            return f"Error: {e}"

    def stream_response(self, response):
        for line in response.iter_lines(decode_unicode=True):
            if line:
                yield line + "\n"
