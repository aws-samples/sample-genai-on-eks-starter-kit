import json
import requests
from pydantic import BaseModel


class Pipe:
    class Valves(BaseModel):
        AGENT_ENDPOINT: str = "http://doc-writer.openclaw:8080/message"
        AGENT_AUTH_TOKEN: str = ""
        REQUEST_TIMEOUT: int = 300

    def __init__(self):
        self.valves = self.Valves()

    def pipes(self):
        return [
            {
                "id": "openclaw-doc-writer",
                "name": "OpenClaw - Document Writer",
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

        headers = {"Content-Type": "application/json"}
        if self.valves.AGENT_AUTH_TOKEN:
            headers["Authorization"] = f"Bearer {self.valves.AGENT_AUTH_TOKEN}"

        try:
            response = requests.post(
                url=self.valves.AGENT_ENDPOINT,
                json={"message": message},
                headers=headers,
                stream=True,
                timeout=self.valves.REQUEST_TIMEOUT,
            )
            response.raise_for_status()

            if body.get("stream", False):
                return self.stream_response(response)
            else:
                return self.collect_response(response)
        except Exception as e:
            return f"Error: {e}"

    def stream_response(self, response):
        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                return
            try:
                parsed = json.loads(data)
                if "content" in parsed:
                    yield parsed["content"]
                elif "error" in parsed:
                    yield f"\n\nError: {parsed['error']}"
            except json.JSONDecodeError:
                continue

    def collect_response(self, response):
        parts = []
        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                parsed = json.loads(data)
                if "content" in parsed:
                    parts.append(parsed["content"])
            except json.JSONDecodeError:
                continue
        return "".join(parts)
