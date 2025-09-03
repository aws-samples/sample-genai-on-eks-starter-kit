import boto3
import logging
import os
import json
from botocore.exceptions import ClientError
from typing import Optional, Dict, Any, Union
from PIL import Image
import io
import base64
import secrets


S3_ENDPOINT_URL = os.getenv('S3_ENDPOINT_URL')  # e.g., 'http://minio.minio.svc.cluster.local:9000'
S3_ACCESS_KEY = os.getenv('S3_ACCESS_KEY')
S3_SECRET_KEY = os.getenv('S3_SECRET_KEY')
S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME', 'loan-buddy-bucket')


# Configure logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# --- S3 Client Initialization ---
s3_client = None
if S3_ENDPOINT_URL and S3_ACCESS_KEY and S3_SECRET_KEY:
    try:
        s3_client = boto3.client(
            's3',
            endpoint_url=S3_ENDPOINT_URL,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            config=boto3.session.Config(signature_version='s3v4')
        )
        logger.info(f"Successfully created S3 client for endpoint {S3_ENDPOINT_URL}")

        # Check if bucket exists, and create if it doesn't
        try:
            s3_client.head_bucket(Bucket=S3_BUCKET_NAME)
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                logger.info(f"Bucket '{S3_BUCKET_NAME}' does not exist. Creating it now.")
                s3_client.create_bucket(Bucket=S3_BUCKET_NAME)
            else:
                raise  # Re-raise other client errors
    except Exception as e:
        logger.error(f"Failed to initialize S3 client or create bucket: {e}")
        s3_client = None
else:
    logger.warning("S3/MinIO environment variables not set. S3 functions will not work.")



def store_object(content: str, object_key: str) -> bool:
    """
    Store content (base64 encoded image) to S3 bucket
    
    Args:
        content: Base64 encoded image string
        object_key: Unique key for the object in S3
        
    Returns:
        bool: True if successful, False otherwise
    """

    if not s3_client:
        logger.error("S3 client not initialized. Cannot store object.")
        return False

    try:
        # Upload the string content directly
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=object_key,
            Body=content,
            ContentType='text/plain'
        )

        logger.info(f"Successfully stored content to s3://{S3_BUCKET_NAME}/{object_key}")
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
    
    if not s3_client:
        logger.error("S3 client not initialized. Cannot load object.")
        return None
        
    try:
        
        # Get the object
        response = s3_client.get_object(
            Bucket=S3_BUCKET_NAME,
            Key=object_key
        )
        
        # Read and return the content
        content = response['Body'].read().decode('utf-8')
        logger.info(f"Successfully loaded content from s3://{bucket_name}/{object_key}")
        return content
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            logger.warning(f"The object s3://{S3_BUCKET_NAME}/{object_key} does not exist.")
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
    
    if not s3_client:
        logger.error("S3 client not initialized. Cannot load object.")
        return False
    
    try:
        
        # Upload the image bytes directly
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=object_key,
            Body=image_bytes,
            ContentType='image/jpeg'
        )

        logger.info(f"Successfully stored image bytes to s3://{S3_BUCKET_NAME}/{object_key}")
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
    
    if not s3_client:
        logger.error("S3 client not initialized. Cannot load object.")
        return None
    
    try:
        # Create S3 client
        
        # Get the object
        response = s3_client.get_object(
            Bucket=S3_BUCKET_NAME,
            Key=object_key
        )
        
        # Read and return the content as bytes
        content = response['Body'].read()
        logger.info(f"Successfully loaded image bytes from s3://{S3_BUCKET_NAME}/{object_key}")
        return content
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            logger.warning(f"The object s3://{S3_BUCKET_NAME}/{object_key} does not exist.")
        else:
            logger.error(f"Error loading image bytes from S3: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading image bytes from S3: {e}")
        return None



def encode_image_from_bytes(image_bytes: bytes) -> str:
    """
    Encode image bytes to base64 string
    
    Args:
        image_bytes: Raw image bytes
        
    Returns:
        str: Base64 encoded image string
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
        
        # Convert RGBA to RGB if necessary (JPEG doesn't support transparency)
        if image.mode in ('RGBA', 'LA'):
            # Create a white background
            background = Image.new('RGB', image.size, (255, 255, 255))
            # Paste the image on the white background
            if image.mode == 'RGBA':
                background.paste(image, mask=image.split()[-1])  # Use alpha channel as mask
            else:
                background.paste(image)
            image = background
        elif image.mode not in ('RGB', 'L'):
            # Convert other modes to RGB
            image = image.convert('RGB')
        
        # Resize image for better processing
        image = image.resize((2400, 1600), Image.Resampling.LANCZOS)
        
        # Save to bytes buffer
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG")
        buffer.seek(0)
        
        # Convert to base64
        return base64.b64encode(buffer.read()).decode("utf-8")
    except Exception as e:
        logger.error(f"Error encoding image from bytes: {e}")
        raise
    
    
def generate_256_bit_hex_key():
    """
    Generates a cryptographically strong 256-bit random key 
    and returns it as a hexadecimal string.
    """
    # 256 bits is 32 bytes (256 / 8 = 32)
    key_bytes = secrets.token_bytes(32)
    # Convert bytes to a hexadecimal string
    key_hex = key_bytes.hex()
    return key_hex    



def encode_image(image_source):
    """Encode image to base64 string"""
    if isinstance(image_source, bytes):
        image = Image.open(io.BytesIO(image_source))
    elif isinstance(image_source, str):
        # File path
        with open(image_source, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode("utf-8")
    else:
        image = Image.open(image_source)
    
    # Convert RGBA to RGB if necessary (JPEG doesn't support transparency)
    if image.mode in ('RGBA', 'LA'):
        # Create a white background
        background = Image.new('RGB', image.size, (255, 255, 255))
        # Paste the image on the white background
        if image.mode == 'RGBA':
            background.paste(image, mask=image.split()[-1])  # Use alpha channel as mask
        else:
            background.paste(image)
        image = background
    elif image.mode not in ('RGB', 'L'):
        # Convert other modes to RGB
        image = image.convert('RGB')
    
    # Resize image for better processing
    image = image.resize((2400, 1600), Image.Resampling.LANCZOS)
    
    # Save to bytes buffer
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    buffer.seek(0)
    
    # Convert to base64
    return base64.b64encode(buffer.read()).decode("utf-8")

