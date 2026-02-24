# Stage 1: Build TypeScript bridge server
FROM node:22-slim AS builder

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# Stage 2: Runtime — Document Writer Agent
# Note: node:22-slim without digest pinning is acceptable for starter kit demos
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client && \
    rm -rf /var/lib/apt/lists/*

# Install OpenClaw CLI
RUN npm install -g openclaw@latest && \
    npm cache clean --force

# Use existing 'node' user (uid 1000) from node:22-slim base image.
# K8s securityContext runAsUser: 1000 maps to this user.
RUN mkdir -p /home/node/.openclaw && \
    chown -R node:node /home/node/.openclaw

# Configure Git defaults for doc-writer commits
# Note: --system writes to /etc/gitconfig as root, readable by all users
RUN git config --system user.name "OpenClaw Doc Writer" && \
    git config --system user.email "openclaw-doc-writer@noreply"

WORKDIR /app

# Copy production dependencies and compiled bridge code
COPY --from=builder /build/node_modules/ /app/node_modules/
COPY --from=builder --chown=node:node /build/dist/ /app/dist/
COPY --chown=node:node package.json /app/
COPY --chown=node:node start-openclaw.sh /app/

RUN chmod +x /app/start-openclaw.sh && \
    mkdir -p /data/workspace && \
    chown node:node /data/workspace

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/start-openclaw.sh"]
