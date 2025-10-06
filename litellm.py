import base64
import json
import urllib.request

# Read and encode image
with open("table.jpg", "rb") as f:
    image_base64 = base64.b64encode(f.read()).decode('utf-8')

# Prepare request
url = "https://litellm.utkarpun.people.aws.dev/chat/completions"
headers = {
    "Authorization": "Bearer sk-1234",
    "Content-Type": "application/json"
}
data = {
    "model": "vllm/qwen2-5-vl-7b-instruct",
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Extract all text and tables from this document"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}}
        ]
    }]
}

# Make request
req = urllib.request.Request(
    url,
    data=json.dumps(data).encode('utf-8'),
    headers=headers
)

# Send and print response
with urllib.request.urlopen(req) as response:
    result = json.loads(response.read().decode('utf-8'))
    print(json.dumps(result, indent=2))
