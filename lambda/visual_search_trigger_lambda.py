import boto3
import os
import json
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.utilities.data_classes import event_source, SQSEvent, S3Event

logger = Logger()
tracer = Tracer()

lambda_client = boto3.client('lambda')
DURABLE_FUNCTION_ARN = os.environ.get('DURABLE_FUNCTION_ARN')

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@event_source(data_class=SQSEvent)
def lambda_handler(event: SQSEvent, context):
    logger.info("Visual Search SQS Event Triggered")
    
    for sqs_record in event.records:
        try:
            body = json.loads(sqs_record.body)
            # Skip S3 Test Events
            if "Event" in body and body["Event"] == "s3:TestEvent":
                continue
                
            s3_event = S3Event(body)
            for record in s3_event.records:
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
        except Exception as e:
            logger.error(f"Error processing SQS record, triggering DLQ routing: {e}")
            raise # Let SQS automatically route it to DLQ after max retries
            
    return {"status": "success"}
