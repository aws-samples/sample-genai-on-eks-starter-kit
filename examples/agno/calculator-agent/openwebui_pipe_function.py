import requests
from pydantic import BaseModel


class Pipe:
    class Valves(BaseModel):
        AGENT_ENDPOINT: str = "http://calculator-agent.agno"

    def __init__(self):
        self.valves = self.Valves()

    def pipes(self):
        return [{"id": "agno-calculator-agent", "name": "Agno - Calculator Agent"}]

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
                timeout=60,
            )
            response.raise_for_status()

            if body.get("stream", False):
                return self.stream_response(response)
            else:
                return response.text
        except Exception as e:
            return f"Error: {e}"

    def stream_response(self, response):
        for line in response.iter_lines(decode_unicode=True):
            if line:
                yield line + "\n"
