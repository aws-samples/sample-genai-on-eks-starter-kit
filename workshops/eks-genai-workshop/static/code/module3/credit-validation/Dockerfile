FROM --platform=$BUILDPLATFORM python:3.12-slim

ARG TARGETPLATFORM
ARG BUILDPLATFORM

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY credit-underwriting-agent.py .
COPY mcp-address-validator.py .
COPY mcp-image-processor.py .
COPY mcp-income-employment-validator.py .

COPY utils.py .
COPY *.png .

EXPOSE 8080

ENV PYTHONUNBUFFERED=1


