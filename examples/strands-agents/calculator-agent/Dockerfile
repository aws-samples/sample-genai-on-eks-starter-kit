FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY __init__.py .
COPY agent.py .
EXPOSE 80
CMD ["fastapi", "run", "agent.py", "--proxy-headers", "--port", "80"]
