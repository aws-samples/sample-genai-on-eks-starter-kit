# S3 Buckets we wish to create
locals {
  buckets = {
    langfuse = {
      name      = "langfuse"
    }
    milvus = {
      name      = "milvus"
    }
  }
}

# Buckets
resource "aws_s3_bucket" "s3-buckets" {  
  for_each = locals.buckets

  bucket_prefix = "${var.name}-bucket-${each.value.name}-"
  force_destroy = true
}

# Block public access to the S3 buckets
resource "aws_s3_bucket_public_access_block" "s3-buckets" {
  for_each = locals.buckets
  bucket   = aws_s3_bucket.s3-buckets[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable server-side encryption for the S3 buckets
resource "aws_s3_bucket_server_side_encryption_configuration" "s3-buckets" {
  for_each = locals.buckets
  bucket   = aws_s3_bucket.s3-buckets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "langfuse_bucket_name" {
  value = aws_s3_bucket.s3-buckets["langfuse"].id
}

output "milvus_bucket_name" {
  value = aws_s3_bucket.s3-buckets["milvus"].id
}
