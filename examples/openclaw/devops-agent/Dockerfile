# Stage 1: Build TypeScript bridge server
FROM node:22-slim AS builder

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# Stage 2: Runtime — DevOps Agent with kubectl, helm, AWS CLI
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip && \
    rm -rf /var/lib/apt/lists/*

# Install kubectl
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" && \
    chmod +x kubectl && mv kubectl /usr/local/bin/

# Install Helm
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Install AWS CLI v2
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then \
      curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o awscliv2.zip; \
    else \
      curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip; \
    fi && \
    unzip -q awscliv2.zip && ./aws/install && \
    rm -rf awscliv2.zip aws/

# Install OpenClaw CLI
RUN npm install -g openclaw@latest && \
    npm cache clean --force

# Create non-root user
RUN groupadd -r openclaw && useradd -r -g openclaw -m openclaw

# Pre-generate openclaw config (skip onboard at runtime)
RUN mkdir -p /home/openclaw/.config/openclaw && \
    echo '{"auth":{"method":"env"},"gateway":{"port":18789}}' > /home/openclaw/.config/openclaw/openclaw.json && \
    chown -R openclaw:openclaw /home/openclaw/.config

WORKDIR /app

# Copy production dependencies and compiled bridge code
COPY --from=builder /build/node_modules/ /app/node_modules/
COPY --from=builder --chown=openclaw:openclaw /build/dist/ /app/dist/
COPY --chown=openclaw:openclaw package.json /app/
COPY --chown=openclaw:openclaw start-openclaw.sh /app/

RUN chmod +x /app/start-openclaw.sh && \
    mkdir -p /data/workspace && \
    chown openclaw:openclaw /data/workspace

USER openclaw

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/start-openclaw.sh"]
