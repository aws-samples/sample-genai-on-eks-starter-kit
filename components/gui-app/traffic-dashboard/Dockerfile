# Multi-stage build for the Agentic Traffic Studio Next.js app.
# Build context is this directory; the app lives in ./app.

FROM node:22-alpine AS deps
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /build/node_modules ./node_modules
COPY app/ ./
# Auth.js validates its env at request time, not build time, so no secrets are
# needed (or baked in) here.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs
# `output: standalone` traces the server plus only the node_modules it needs.
COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /build/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /build/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
