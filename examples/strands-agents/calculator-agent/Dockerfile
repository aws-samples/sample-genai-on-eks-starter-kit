# Use a specific Python version with better wheel support
FROM python:3.11-slim

# Install system dependencies needed for some packages
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Upgrade pip and install build tools, then install requirements
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY __init__.py .
COPY agent.py .

EXPOSE 80

CMD ["fastapi", "run", "agent.py", "--proxy-headers", "--port", "80"]
