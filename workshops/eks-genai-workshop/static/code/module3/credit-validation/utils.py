import boto3
import logging
import os
import json
from botocore.exceptions import ClientError
from typing import Optional, Dict, Any, Union

bucket_name = os.getenv('S3_BUCKET_NAME', '')

# Configure logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

def store_object(content: str, object_key: str) -> bool:
    """
    Store content (base64 encoded image) to S3 bucket
    
    Args:
        content: Base64 encoded image string
        object_key: Unique key for the object in S3
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create S3 client with optional region
        s3_client = boto3.client('s3')
        
        # Upload the string content directly
        s3_client.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=content,
            ContentType='text/plain'
        )
        
        logger.info(f"Successfully stored content to s3://{bucket_name}/{object_key}")
        return True
        
    except ClientError as e:
        logger.error(f"Error storing content to S3: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error storing content to S3: {e}")
        return False
    
def load_object(object_key: str) -> Optional[str]:
    """
    Load content (base64 encoded image) from S3 bucket
    
    Args:
        object_key: Unique key for the object in S3
        
    Returns:
        str: Base64 encoded image string if successful, None otherwise
    """
    try:
        # Create S3 client with optional region
        s3_client = boto3.client('s3')
        
        # Get the object
        response = s3_client.get_object(
            Bucket=bucket_name,
            Key=object_key
        )
        
        # Read and return the content
        content = response['Body'].read().decode('utf-8')
        logger.info(f"Successfully loaded content from s3://{bucket_name}/{object_key}")
        return content
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            logger.warning(f"The object s3://{bucket_name}/{object_key} does not exist.")
        else:
            logger.error(f"Error loading content from S3: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading content from S3: {e}")
        return None

def store_image_bytes(image_bytes: bytes, object_key: str) -> bool:
    """
    Store image bytes directly to S3 bucket
    
    Args:
        image_bytes: Raw image bytes
        object_key: Unique key for the object in S3
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create S3 client
        s3_client = boto3.client('s3')
        
        # Upload the image bytes directly
        s3_client.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=image_bytes,
            ContentType='image/jpeg'
        )
        
        logger.info(f"Successfully stored image bytes to s3://{bucket_name}/{object_key}")
        return True
        
    except ClientError as e:
        logger.error(f"Error storing image bytes to S3: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error storing image bytes to S3: {e}")
        return False

def load_image_bytes(object_key: str) -> Optional[bytes]:
    """
    Load image bytes from S3 bucket
    
    Args:
        object_key: Unique key for the object in S3
        
    Returns:
        bytes: Image bytes if successful, None otherwise
    """
    try:
        # Create S3 client
        s3_client = boto3.client('s3')
        
        # Get the object
        response = s3_client.get_object(
            Bucket=bucket_name,
            Key=object_key
        )
        
        # Read and return the content as bytes
        content = response['Body'].read()
        logger.info(f"Successfully loaded image bytes from s3://{bucket_name}/{object_key}")
        return content
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            logger.warning(f"The object s3://{bucket_name}/{object_key} does not exist.")
        else:
            logger.error(f"Error loading image bytes from S3: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading image bytes from S3: {e}")
        return None
