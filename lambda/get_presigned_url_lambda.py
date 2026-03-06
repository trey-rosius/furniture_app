import boto3
# Rebuild-1
import os
import json
from aws_lambda_powertools import Logger, Tracer

logger = Logger()
tracer = Tracer()

s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    
    uri = event['arguments']['uri']
    
    if uri.startswith('s3://'):
        bucket_and_key = uri.replace('s3://', '')
        parts = bucket_and_key.split('/')
        bucket = parts[0]
        key = '/'.join(parts[1:])
    else:
        # Fallback to catalog bucket if just a key is provided
        bucket = os.environ['BUCKET_NAME']
        key = uri
    
    try:
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket,
                'Key': key
            },
            ExpiresIn=3600
        )
        return url
    except Exception as e:
        logger.exception(f"Error generating presigned URL for {uri}")
        raise e
