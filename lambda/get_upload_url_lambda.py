import boto3
# Force rebuild with xray-sdk
# Rebuild-1
import os
import json
from botocore.config import Config
from aws_lambda_powertools import Logger, Tracer

logger = Logger()
tracer = Tracer()

s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    
    file_name = event['arguments']['fileName']
    content_type = event['arguments']['contentType']
    bucket_name = os.environ['BUCKET_NAME']
    
    # Key must be in visuals/ folder as per requirement
    key = f"visuals/{file_name}"
    
    try:
        url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': bucket_name,
                'Key': key,
                'ContentType': content_type
            },
            ExpiresIn=3600
        )
        
        return {
            "url": url,
            "key": key
        }
    except Exception as e:
        logger.exception("Error generating presigned URL")
        raise e
