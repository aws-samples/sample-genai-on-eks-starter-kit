#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Loan Buddy Workshop Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DEPLOYMENT_TEMPLATE="${SCRIPT_DIR}/agentic-application-deployment.yaml"
DEPLOYMENT_FILE="${SCRIPT_DIR}/agentic-application-deployment.configured.yaml"

# Step 1: Check prerequisites
echo -e "${YELLOW}Step 1: Checking prerequisites...${NC}"

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}❌ kubectl not found. Please install kubectl.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ kubectl found${NC}"

# Check if we can connect to the cluster
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}❌ Cannot connect to Kubernetes cluster. Please check your kubeconfig.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Connected to Kubernetes cluster${NC}"

# Step 2: Get S3 bucket name from Terraform
echo -e "\n${YELLOW}Step 2: Retrieving S3 bucket name from Terraform...${NC}"

# Try to find the langfuse terraform directory
# First try the full starter kit path
LANGFUSE_TF_DIR="${SCRIPT_DIR}/../../../../../components/o11y/langfuse"

# If that doesn't exist, try the workshop-only path
if [ ! -d "$LANGFUSE_TF_DIR" ]; then
    # Look for it in common workshop locations
    if [ -d "/workshop/components/o11y/langfuse" ]; then
        LANGFUSE_TF_DIR="/workshop/components/o11y/langfuse"
    elif [ -d "$(pwd | sed 's|/workshops/.*|/components/o11y/langfuse|')" ]; then
        LANGFUSE_TF_DIR="$(pwd | sed 's|/workshops/.*|/components/o11y/langfuse|')"
    fi
fi

# Check if we found the directory
if [ ! -d "$LANGFUSE_TF_DIR" ]; then
    echo -e "${RED}❌ Langfuse Terraform directory not found.${NC}"
    echo -e "${YELLOW}⚠️  Please provide the S3 bucket name manually:${NC}"
    read -p "   S3 Bucket Name: " S3_BUCKET_NAME
    
    if [ -z "$S3_BUCKET_NAME" ]; then
        echo -e "${RED}❌ S3 bucket name is required.${NC}"
        exit 1
    fi
else
    # Navigate to the langfuse component directory
    cd "$LANGFUSE_TF_DIR"

    # Get the S3 bucket name from Terraform output
    S3_BUCKET_NAME=$(terraform output -raw langfuse_bucket_name 2>/dev/null)

    if [ -z "$S3_BUCKET_NAME" ]; then
        echo -e "${RED}❌ Could not retrieve S3 bucket name from Terraform.${NC}"
        echo -e "${YELLOW}⚠️  Please provide the S3 bucket name manually:${NC}"
        read -p "   S3 Bucket Name: " S3_BUCKET_NAME
        
        if [ -z "$S3_BUCKET_NAME" ]; then
            echo -e "${RED}❌ S3 bucket name is required.${NC}"
            exit 1
        fi
    fi
fi

echo -e "${GREEN}✅ S3 Bucket: ${S3_BUCKET_NAME}${NC}"

# Step 3: Get AWS region
echo -e "\n${YELLOW}Step 3: Getting AWS region...${NC}"

# Try to get region from environment variable first
if [ -z "$REGION" ]; then
    # Try to load from .env file in multiple locations
    for ENV_FILE in "${SCRIPT_DIR}/../../../../../.env" "/workshop/.env" "$(pwd | sed 's|/workshops/.*|/.env|')"; do
        if [ -f "$ENV_FILE" ]; then
            source "$ENV_FILE"
            break
        fi
    done
fi

# If still not set, try AWS CLI default region
if [ -z "$REGION" ]; then
    REGION=$(aws configure get region 2>/dev/null || echo "")
fi

# If still not set, prompt user
if [ -z "$REGION" ]; then
    echo -e "${YELLOW}⚠️  AWS region not found in environment.${NC}"
    echo -e "${YELLOW}   Please enter your AWS region (e.g., us-west-2):${NC}"
    read -p "   Region: " REGION
    
    if [ -z "$REGION" ]; then
        echo -e "${RED}❌ AWS region is required.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ AWS Region: ${REGION}${NC}"

# Step 4: Get LiteLLM API key
echo -e "\n${YELLOW}Step 4: Getting LiteLLM API key...${NC}"

if [ -z "$AGENT_KEY" ]; then
    echo -e "${YELLOW}⚠️  AGENT_KEY not found in environment.${NC}"
    echo -e "${YELLOW}   Please enter your LiteLLM API key (Virtual Key from Module 2):${NC}"
    read -p "   API Key: " AGENT_KEY
    
    if [ -z "$AGENT_KEY" ]; then
        echo -e "${RED}❌ API key is required.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ LiteLLM API Key: ${AGENT_KEY:0:10}...${NC}"

# Step 5: Get Langfuse credentials
echo -e "\n${YELLOW}Step 5: Getting Langfuse credentials...${NC}"

# Try to load from .env file if not already set
if [ -z "$LANGFUSE_PUBLIC_KEY" ] || [ -z "$LANGFUSE_SECRET_KEY" ]; then
    for ENV_FILE in "${SCRIPT_DIR}/../../../../../.env" "/workshop/.env" "$(pwd | sed 's|/workshops/.*|/.env|')"; do
        if [ -f "$ENV_FILE" ]; then
            source "$ENV_FILE"
            break
        fi
    done
fi

# If still not set, prompt user
if [ -z "$LANGFUSE_PUBLIC_KEY" ]; then
    echo -e "${YELLOW}⚠️  LANGFUSE_PUBLIC_KEY not found in environment.${NC}"
    echo -e "${YELLOW}   Please enter your Langfuse public key:${NC}"
    read -p "   Public Key: " LANGFUSE_PUBLIC_KEY
fi

if [ -z "$LANGFUSE_SECRET_KEY" ]; then
    echo -e "${YELLOW}⚠️  LANGFUSE_SECRET_KEY not found in environment.${NC}"
    echo -e "${YELLOW}   Please enter your Langfuse secret key:${NC}"
    read -p "   Secret Key: " LANGFUSE_SECRET_KEY
fi

if [ -z "$LANGFUSE_PUBLIC_KEY" ] || [ -z "$LANGFUSE_SECRET_KEY" ]; then
    echo -e "${RED}❌ Langfuse credentials are required.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Langfuse Public Key: ${LANGFUSE_PUBLIC_KEY:0:10}...${NC}"
echo -e "${GREEN}✅ Langfuse Secret Key: ${LANGFUSE_SECRET_KEY:0:10}...${NC}"

# Step 6: Create workshop namespace
echo -e "\n${YELLOW}Step 6: Creating workshop namespace...${NC}"

if kubectl get namespace workshop &> /dev/null; then
    echo -e "${GREEN}✅ Namespace 'workshop' already exists${NC}"
else
    kubectl create namespace workshop
    echo -e "${GREEN}✅ Created namespace 'workshop'${NC}"
fi

# Step 7: Create service account in workshop namespace
echo -e "\n${YELLOW}Step 7: Setting up service account for S3 access...${NC}"

# Check if langfuse service account exists in langfuse namespace
if ! kubectl get serviceaccount langfuse -n langfuse &> /dev/null; then
    echo -e "${RED}❌ Langfuse service account not found in langfuse namespace.${NC}"
    echo -e "${RED}   Please make sure Langfuse is deployed first.${NC}"
    exit 1
fi

# Copy the service account to workshop namespace
kubectl get serviceaccount langfuse -n langfuse -o yaml | \
  sed 's/namespace: langfuse/namespace: workshop/' | \
  grep -v '^\s*resourceVersion:' | \
  grep -v '^\s*uid:' | \
  grep -v '^\s*creationTimestamp:' | \
  kubectl apply -f - &> /dev/null

echo -e "${GREEN}✅ Service account 'langfuse' created in workshop namespace${NC}"

# Step 7b: Create Pod Identity Association for workshop namespace
echo -e "\n${YELLOW}Step 7b: Creating Pod Identity Association for S3 access...${NC}"

# Get the cluster name from .env file
CLUSTER_NAME=""
for ENV_FILE in "${SCRIPT_DIR}/../../../../../.env" "/workshop/.env" "$(pwd | sed 's|/workshops/.*|/.env|')"; do
    if [ -f "$ENV_FILE" ]; then
        source "$ENV_FILE"
        if [ ! -z "$EKS_CLUSTER_NAME" ]; then
            CLUSTER_NAME="$EKS_CLUSTER_NAME"
            break
        fi
    fi
done

# Fallback to default if not found
if [ -z "$CLUSTER_NAME" ]; then
    CLUSTER_NAME="genai-on-eks"
fi

echo -e "${BLUE}Cluster name: ${CLUSTER_NAME}${NC}"

# Get the IAM role ARN from Terraform output
ROLE_ARN=""
if [ -d "$LANGFUSE_TF_DIR" ]; then
    cd "$LANGFUSE_TF_DIR"
    ROLE_ARN=$(terraform output -raw langfuse_s3_role_arn 2>/dev/null || echo "")
fi

if [ -z "$ROLE_ARN" ] || [ "$ROLE_ARN" == "None" ]; then
    echo -e "${YELLOW}⚠️  Could not retrieve IAM role ARN from Terraform.${NC}"
    echo -e "${YELLOW}   Make sure you have run: terraform apply${NC}"
    echo -e "${YELLOW}   in the langfuse component directory.${NC}"
    echo -e "${YELLOW}   Skipping Pod Identity Association creation.${NC}"
    echo -e "${YELLOW}   The application may not be able to access S3.${NC}"
else
    echo -e "${BLUE}Using IAM role: ${ROLE_ARN}${NC}"
    
    # Check if Pod Identity Association already exists for workshop namespace using AWS CLI
    EXISTING_ASSOC=$(aws eks list-pod-identity-associations \
      --cluster-name "$CLUSTER_NAME" \
      --namespace workshop \
      --service-account langfuse \
      --query 'associations[0].associationArn' \
      --output text 2>/dev/null)
    
    if [ ! -z "$EXISTING_ASSOC" ] && [ "$EXISTING_ASSOC" != "None" ]; then
        echo -e "${GREEN}✅ Pod Identity Association already exists for workshop namespace${NC}"
    else
        # Create the Pod Identity Association for workshop namespace using AWS CLI
        echo -e "${BLUE}Creating Pod Identity Association...${NC}"
        
        CREATE_OUTPUT=$(aws eks create-pod-identity-association \
          --cluster-name "$CLUSTER_NAME" \
          --namespace workshop \
          --service-account langfuse \
          --role-arn "$ROLE_ARN" 2>&1)
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Pod Identity Association created for workshop namespace${NC}"
        else
            # Check if it already exists (common error)
            if echo "$CREATE_OUTPUT" | grep -q "ResourceInUseException\|AlreadyExistsException"; then
                echo -e "${GREEN}✅ Pod Identity Association already exists for workshop namespace${NC}"
            else
                echo -e "${RED}❌ Failed to create Pod Identity Association${NC}"
                echo -e "${YELLOW}   Error: ${CREATE_OUTPUT}${NC}"
                echo -e "${YELLOW}   The application may not be able to access S3.${NC}"
                echo -e "${YELLOW}   You can create it manually with:${NC}"
                echo -e "${YELLOW}   aws eks create-pod-identity-association \\${NC}"
                echo -e "${YELLOW}     --cluster-name ${CLUSTER_NAME} \\${NC}"
                echo -e "${YELLOW}     --namespace workshop \\${NC}"
                echo -e "${YELLOW}     --service-account langfuse \\${NC}"
                echo -e "${YELLOW}     --role-arn ${ROLE_ARN}${NC}"
            fi
        fi
    fi
fi

# Step 8: Configure deployment file
echo -e "\n${YELLOW}Step 8: Configuring deployment file...${NC}"

# Create a configured version of the deployment file
cp "$DEPLOYMENT_TEMPLATE" "$DEPLOYMENT_FILE"

# Replace placeholders using sed - do S3_BUCKET_NAME and AWS_REGION separately to avoid conflicts
sed -i.bak \
  -e "s|value: \"lf_pk_1234567890\"|value: \"${LANGFUSE_PUBLIC_KEY}\"|g" \
  -e "s|value: \"lf_sk_1234567890\"|value: \"${LANGFUSE_SECRET_KEY}\"|g" \
  -e "s|value: \"sk-4qgicypE01dIhc5mPsBWDQ\"|value: \"${AGENT_KEY}\"|g" \
  -e "s|value: \"sk-SSar1N3WA6zAmTIHzmkxIg\"|value: \"${AGENT_KEY}\"|g" \
  "$DEPLOYMENT_FILE"

# Replace S3_BUCKET_NAME placeholders (only after S3_BUCKET_NAME env var)
sed -i.bak2 \
  -e "/S3_BUCKET_NAME/{n;s|value: \"<>\"|value: \"${S3_BUCKET_NAME}\"|;}" \
  "$DEPLOYMENT_FILE"

# Replace AWS_REGION placeholders (only after AWS_REGION env var)
sed -i.bak3 \
  -e "/AWS_REGION/{n;s|value: \"<>\"|value: \"${REGION}\"|;}" \
  "$DEPLOYMENT_FILE"

# Clean up backup files
rm -f "${DEPLOYMENT_FILE}.bak" "${DEPLOYMENT_FILE}.bak2" "${DEPLOYMENT_FILE}.bak3"

echo -e "${GREEN}✅ Deployment file configured: ${DEPLOYMENT_FILE}${NC}"

# Step 9: Deploy the application
echo -e "\n${YELLOW}Step 9: Deploying Loan Buddy application...${NC}"

kubectl apply -f "$DEPLOYMENT_FILE"

echo -e "${GREEN}✅ Application deployed${NC}"

# Step 10: Wait for deployments to be ready
echo -e "\n${YELLOW}Step 10: Waiting for deployments to be ready...${NC}"
echo -e "${BLUE}This may take a few minutes...${NC}"

kubectl rollout status deployment/loan-buddy-agent -n workshop --timeout=5m
kubectl rollout status deployment/mcp-address-validator -n workshop --timeout=5m
kubectl rollout status deployment/mcp-employment-validator -n workshop --timeout=5m
kubectl rollout status deployment/mcp-image-processor -n workshop --timeout=5m

# Step 10b: Ensure Pod Identity credentials are available
echo -e "\n${YELLOW}Step 10b: Verifying Pod Identity credentials...${NC}"

check_and_restart_for_credentials() {
    local deployment=$1
    local namespace=$2

    # Check if credentials are injected
    if kubectl exec deployment/${deployment} -n ${namespace} -- env 2>/dev/null | grep -q "AWS_CONTAINER_CREDENTIALS_FULL_URI"; then
        echo -e "${GREEN}✅ ${deployment}: Pod Identity credentials found${NC}"
    else
        echo -e "${YELLOW}⚠️  ${deployment}: No credentials found, restarting to pick up Pod Identity...${NC}"
        kubectl rollout restart deployment/${deployment} -n ${namespace}
        kubectl rollout status deployment/${deployment} -n ${namespace} --timeout=120s
        echo -e "${GREEN}✅ ${deployment}: Restarted with Pod Identity credentials${NC}"
    fi
}

check_and_restart_for_credentials "loan-buddy-agent" "workshop"
check_and_restart_for_credentials "mcp-address-validator" "workshop"
check_and_restart_for_credentials "mcp-employment-validator" "workshop"
check_and_restart_for_credentials "mcp-image-processor" "workshop"

# Step 11: Verify deployment
echo -e "\n${YELLOW}Step 11: Verifying deployment...${NC}"

kubectl get pods -n workshop

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "1. Port-forward the service:"
echo -e "   ${YELLOW}kubectl port-forward service/loan-buddy-agent 8080:8080 -n workshop${NC}"
echo ""
echo -e "2. In another terminal, watch the logs:"
echo -e "   ${YELLOW}kubectl logs -f deployment/loan-buddy-agent -n workshop${NC}"
echo ""
echo -e "3. Test the application:"
echo -e "   ${YELLOW}cd ${SCRIPT_DIR}${NC}"
echo -e "   ${YELLOW}curl -X POST -F \"image_file=@./example1.png\" http://localhost:8080/api/process_credit_application_with_upload${NC}"
echo ""
echo -e "${GREEN}Happy testing! 🚀${NC}"
