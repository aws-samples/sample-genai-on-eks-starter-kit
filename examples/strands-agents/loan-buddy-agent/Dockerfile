FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY __init__.py .
COPY utils.py .
COPY agent.py .
EXPOSE 8080
CMD ["fastapi", "run", "agent.py", "--proxy-headers", "--port", "8080"]
