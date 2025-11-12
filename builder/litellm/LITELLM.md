# LiteLLM

- Create a buildkit container using `builder/litellm/pod-buildkit.yaml`

- On the buildkit container (`kubectl -n litellm exec -it buildkit -- sh`), first install AWS CLI and setup ECR credentials by using the command similar to the one below

```
mkdir -p /root/.temp
cd /root/.temp

apk add aws-cli

export ECR_PASSWORD=$(aws ecr-public get-login-password --region us-east-1)
export AUTH=$(echo -n "AWS:${ECR_PASSWORD}" | base64 -w 0)

mkdir -p ~/.docker
cat << EOF > ~/.docker/config.json
{
  "auths": {
    "public.ecr.aws": {
      "auth": "${AUTH}"
    }
  }
}
EOF
```

- Then, copy the Dockerfile files into the buildkit container using `kubectl cp ./builder/litellm/Dockerfile litellm/buildkit:/root/.temp/Dockerfile`

- Then, build and push the image to ECR by using the command similar to the one below

```
public_ecr_alias=t0h7h1e6

buildctl build --frontend dockerfile.v0 \
  --local context=/root/.temp --local dockerfile=/root/.temp \
  --output type=image,name=public.ecr.aws/$public_ecr_alias/litellm:v1.79.1-mlflow,push=true
```
