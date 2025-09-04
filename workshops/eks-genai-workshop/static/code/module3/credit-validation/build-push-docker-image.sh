docker buildx rm multiarch-builder || true

# Create a new builder instance
docker buildx create --name multiarch-builder --use

# Build for both x86_64 and ARM64
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/loan-buddy:latest --push .

# Or build locally for testing
# docker buildx build --platform linux/amd64,linux/arm64 -t loan-buddy:latest --load .


        - name: LANGFUSE_URL
          value: "http://langfuse-web.langfuse.svc.cluster.local:3000"
        - name: LANGFUSE_PUBLIC_KEY
          value: "lf_pk_1234567890"
        - name: LANGFUSE_SECRET_KEY  
          value: "lf_sk_1234567890"
        - name: GATEWAY_URL
          value: "http://litellm.litellm.svc.cluster.local:4000"  
        - name: GATEWAY_MODEL_ACCESS_KEY
          value: "sk-4qgicypE01dIhc5mPsBWDQ"
        - name: S3_BUCKET_NAME
          value: "langfuse"
        - name: S3_ENDPOINT_URL
          value: "http://langfuse-s3.langfuse.svc.cluster.local:9000"
        - name: S3_ACCESS_KEY
          value: "minio"
        - name: S3_SECRET_KEY
          value: "password123"
        - name: MCP_ADDRESS_VALIDATOR
          value: "http://mcp-address-validator:8000"
        - name: MCP_EMPLOYMENT_VALIDATOR
          value: "http://mcp-employment-validator:8000"
        - name: MCP_IMAGE_PROCESSOR
          value: "http://mcp-image-processor:8000"
