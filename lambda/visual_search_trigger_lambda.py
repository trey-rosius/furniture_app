import boto3
import os
import json
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.data_classes import event_source, S3Event

logger = Logger()
tracer = Tracer()

lambda_client = boto3.client('lambda')
DURABLE_FUNCTION_ARN = os.environ.get('DURABLE_FUNCTION_ARN')

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@event_source(data_class=S3Event)
def lambda_handler(event: S3Event, context):
    logger.info("Visual Search Triggered")
    
    for record in event.records:
        bucket = record.s3.bucket.name
        key = record.s3.get_object.key
        
        logger.info(f"Triggering Durable Search for s3://{bucket}/{key}")
        
        if DURABLE_FUNCTION_ARN:
            # Invoke the durable function asynchronously
            lambda_client.invoke(
                FunctionName=f"{DURABLE_FUNCTION_ARN}",
                InvocationType='Event',
                Payload=json.dumps({
                    "bucket": bucket,
                    "key": key,
                    "requestId": key
                })
            )
            
    return {"status": "success"}
