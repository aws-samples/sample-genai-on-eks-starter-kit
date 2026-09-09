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

# S3 bucket for Tempo trace blocks (Beyla spans land here via the distributor).
resource "aws_s3_bucket" "tempo" {
  bucket_prefix = "${var.name}-bucket-tempo-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "tempo" {
  bucket = aws_s3_bucket.tempo.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tempo" {
  bucket = aws_s3_bucket.tempo.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "tempo_bucket_name" {
  value = aws_s3_bucket.tempo.id
}

output "tempo_s3_role_arn" {
  value = aws_iam_role.tempo_s3_access.arn
}

resource "aws_iam_role" "tempo_s3_access" {
  name = "${var.name}-${var.region}-tempo-s3-access"
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

resource "aws_iam_role_policy" "tempo_s3_access" {
  role = aws_iam_role.tempo_s3_access.name
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
        "arn:aws:s3:::${var.name}-bucket-tempo-*",
        "arn:aws:s3:::${var.name}-bucket-tempo-*/*"
      ]
    }]
  })
}

# tempo-distributed's components share the "tempo" ServiceAccount in ns "tempo".
resource "aws_eks_pod_identity_association" "tempo_s3" {
  cluster_name    = var.name
  namespace       = "tempo"
  service_account = "tempo"
  role_arn        = aws_iam_role.tempo_s3_access.arn
}
