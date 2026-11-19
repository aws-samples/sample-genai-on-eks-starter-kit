docker buildx rm multiarch-builder || true

# Create a new builder instance
docker buildx create --name multiarch-builder --use

# Build for both x86_64 and ARM64
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/loan-buddy:latest --push .

# Or build locally for testing
# docker buildx build --platform linux/amd64,linux/arm64 -t loan-buddy:latest --load .

# NOTE: the container's environment (Langfuse keys, LiteLLM key, S3 bucket) is
# NOT set here. It is rendered into agentic-application-deployment.yaml by
# deploy-workshop-app.sh from your per-account /workshop/.env.local, so no
# credential is committed to this repo.
