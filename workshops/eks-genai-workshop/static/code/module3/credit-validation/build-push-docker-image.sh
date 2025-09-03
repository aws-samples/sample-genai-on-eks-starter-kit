docker buildx rm multiarch-builder || true

# Create a new builder instance
docker buildx create --name multiarch-builder --use

# Build for both x86_64 and ARM64
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/loan-buddy:latest --push .

# Or build locally for testing
# docker buildx build --platform linux/amd64,linux/arm64 -t loan-buddy:latest --load .