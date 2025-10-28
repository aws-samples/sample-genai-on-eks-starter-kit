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

# S3 Bucket for Milvus
resource "aws_s3_bucket" "milvus" {
  bucket_prefix = "${var.name}-bucket-milvus-"
  force_destroy = true
}

# Block public access to the S3 bucket
resource "aws_s3_bucket_public_access_block" "milvus" {
  bucket = aws_s3_bucket.milvus.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable server-side encryption for the S3 bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "milvus" {
  bucket = aws_s3_bucket.milvus.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "milvus_bucket_name" {
  value = aws_s3_bucket.milvus.id
}

resource "aws_iam_role" "milvus_s3_access" {
  name = "${var.name}-${var.region}-milvus-s3-access"
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

resource "aws_iam_role_policy" "milvus_s3_access" {
  role = aws_iam_role.milvus_s3_access.name
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
        "arn:aws:s3:::${var.name}-bucket-milvus-*",
        "arn:aws:s3:::${var.name}-bucket-milvus-*/*"
      ]
    }]
  })
}

resource "aws_eks_pod_identity_association" "milvus_s3" {
  cluster_name    = var.name
  namespace       = "milvus"  
  service_account = "milvus"  
  role_arn        = aws_iam_role.milvus_s3_access.arn
}
