# Stage 1: Build TypeScript bridge server
FROM node:22-slim AS builder

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# Stage 2: Runtime — Document Writer Agent
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client && \
    rm -rf /var/lib/apt/lists/*

# Install OpenClaw CLI
RUN npm install -g openclaw@latest && \
    npm cache clean --force

# Create non-root user
RUN groupadd -r openclaw && useradd -r -g openclaw -m openclaw

# Pre-generate openclaw config (skip onboard at runtime)
RUN mkdir -p /home/openclaw/.config/openclaw && \
    echo '{"auth":{"method":"env"},"gateway":{"port":18789}}' > /home/openclaw/.config/openclaw/openclaw.json && \
    chown -R openclaw:openclaw /home/openclaw/.config

# Configure Git defaults for doc-writer commits
RUN git config --system user.name "OpenClaw Doc Writer" && \
    git config --system user.email "openclaw-doc-writer@noreply"

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
