variable "region" {
  type    = string
  default = "us-west-2"
}
variable "name" {
  type    = string
  default = "genai-on-eks"
}
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.96.0"
    }
  }
}
provider "aws" {
  region = var.region
}

# S3 Bucket for MLflow
resource "aws_s3_bucket" "mlflow" {
  bucket_prefix = "${var.name}-bucket-mlflow-"
  force_destroy = true
}

# Block public access to the S3 bucket
resource "aws_s3_bucket_public_access_block" "mlflow" {
  bucket = aws_s3_bucket.mlflow.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable server-side encryption for the S3 bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "mlflow" {
  bucket = aws_s3_bucket.mlflow.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "mlflow_bucket_name" {
  value = aws_s3_bucket.mlflow.id
}

resource "aws_iam_role" "mlflow_s3_access" {
  name = "${var.name}-${var.region}-mlflow-s3-access"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "pods.eks.amazonaws.com"
      }
      Action = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

resource "aws_iam_role_policy" "mlflow_s3_access" {
  role = aws_iam_role.mlflow_s3_access.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ]
      Resource = [
        "arn:aws:s3:::${var.name}-bucket-mlflow-*",
        "arn:aws:s3:::${var.name}-bucket-mlflow-*/*"
      ]
    }]
  })
}

resource "aws_eks_pod_identity_association" "mlflow_s3" {
  cluster_name    = var.name
  namespace       = "mlflow"  
  service_account = "mlflow"  
  role_arn        = aws_iam_role.mlflow_s3_access.arn
}
