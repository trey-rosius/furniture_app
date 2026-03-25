import boto3
import os
import json
import base64
import uuid
from decimal import Decimal
from aws_lambda_powertools import Logger, Tracer
from aws_durable_execution_sdk_python import (
    DurableContext,
    StepContext,
    durable_execution,
    durable_step,
)

logger = Logger()
tracer = Tracer()

# Clients
bedrock = boto3.client("bedrock-runtime")
s3vectors = boto3.client("s3vectors")
lambda_client = boto3.client('lambda')
events_client = boto3.client('events')
s3_client = boto3.client('s3')

MODEL_ID = 'amazon.nova-2-multimodal-embeddings-v1:0'
BATCH_GET_ITEM_LAMBDA = os.environ.get('BATCH_GET_ITEM_LAMBDA')

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)
        
@durable_step
def get_image_step(step_context: StepContext, bucket: str, key: str) -> str:
    """Download image from S3 and return base64 string."""
    step_context.logger.info(f"Downloading s3://{bucket}/{key}")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    image_bytes = response['Body'].read()
    return base64.b64encode(image_bytes).decode('utf-8')

@durable_step
def generate_embedding_step(step_context: StepContext, key: str, bucket: str) -> str:
    """Invoke Bedrock Nova to generate multimodal embedding asynchronously."""
    step_context.logger.info(f"Starting async embedding from Bedrock Nova for s3://{bucket}/{key}")
    
    image_format = "png" if key.lower().endswith('.png') else "jpeg"
    if key.lower().endswith(('.jpg', '.jpeg')):
        image_format = "jpeg"
        
    native_request = {
        "taskType": "SEGMENTED_EMBEDDING",
        "segmentedEmbeddingParams": {
            "embeddingPurpose": "GENERIC_INDEX",
            "embeddingDimension": 3072,
            "image": {
                "format": image_format,
                "detailLevel": "STANDARD_IMAGE",
                "source": {
                    "s3Location": {
                        "uri": f"s3://{bucket}/{key}"
                    }
                }
            },
        },
    }
    
    bedrock_response = bedrock.start_async_invoke(
        modelId=MODEL_ID,
        modelInput=native_request,
        outputDataConfig={
            's3OutputDataConfig': {
                's3Uri': f"s3://{bucket}/async-embeddings/"
            }
        }
    )
    return bedrock_response['invocationArn']

import time
import urllib.parse

@durable_step
def poll_embedding_job_step(step_context: StepContext, invocation_arn: str) -> list:
    """Poll Bedrock to check if the async embedding job is complete, then fetch results."""
    step_context.logger.info(f"Polling job {invocation_arn}")
    
    # 5 minutes lambda timeout allows 300s. We will poll max 20 times (every 3 seconds).
    for _ in range(40):
        status_response = bedrock.get_async_invoke(invocationArn=invocation_arn)
        status = status_response['status']
        
        if status == 'Completed':
            s3_output_uri = status_response['outputDataConfig']['s3OutputDataConfig']['s3Uri']
            parsed_uri = urllib.parse.urlparse(s3_output_uri)
            output_bucket = parsed_uri.netloc
            output_prefix = urllib.parse.unquote_plus(parsed_uri.path.lstrip('/'))
            
            response = s3_client.list_objects_v2(Bucket=output_bucket, Prefix=output_prefix)
            jsonl_key = next((obj['Key'] for obj in response.get('Contents', []) if obj['Key'].endswith('.jsonl')), None)
            
            if not jsonl_key:
                raise Exception(f"Job completed but no .jsonl file found at {output_prefix}")
                
            embedding_obj = s3_client.get_object(Bucket=output_bucket, Key=jsonl_key)
            embedding_data = json.loads(embedding_obj['Body'].read().decode('utf-8'))
            return embedding_data.get("embedding", [])
            
        elif status in ['Failed', 'Stopped']:
            raise Exception(f"Async embedding job failed or stopped with status: {status}. Reason: {status_response.get('failureMessage')}")
            
        time.sleep(3)
        
    raise Exception(f"Timeout waiting for async embedding job {invocation_arn}")

@durable_step
def search_vectors_step(step_context: StepContext, query_vector: list) -> list:
    """Query S3 Vectors and return product UUIDs."""
    step_context.logger.info(f"Querying S3 Vectors index: {os.environ['VECTOR_INDEX']}")
    
    vector_response = s3vectors.query_vectors(
        vectorBucketName=os.environ['VECTOR_BUCKET'],
        indexName=os.environ['VECTOR_INDEX'],
        queryVector={"float32": query_vector},
        topK=5,
        returnMetadata=True
    )
    
    results = vector_response.get("vectors", [])
    return [match['metadata']['prod_uuid'] for match in results if 'prod_uuid' in match.get('metadata', {})]

@durable_step
def fetch_product_details_step(step_context: StepContext, uuids: list) -> list:
    """Invoke BatchGetItem Lambda to retrieve products."""
    if not uuids or not BATCH_GET_ITEM_LAMBDA:
        return []
        
    step_context.logger.info(f"Invoking {BATCH_GET_ITEM_LAMBDA} for {len(uuids)} UUIDs")
    batch_response = lambda_client.invoke(
        FunctionName=BATCH_GET_ITEM_LAMBDA,
        InvocationType='RequestResponse',
        Payload=json.dumps({"uuids": uuids})
    )
    return json.loads(batch_response['Payload'].read())



@durable_step
def emit_results_step(step_context: StepContext, results: list, status: str = "SUCCESS", message: str = ""):
    """Notify EventBridge with search results."""
    step_context.logger.info(f"Emitting {len(results)} results to EventBridge with status {status}")
    
    events_client.put_events(
        Entries=[{
            'Source': 'com.furniture.search',
            'DetailType': 'VisualSearchResult',
            'Detail': json.dumps({
                'status': status,
                'message': message,
                'results': results
            }, cls=DecimalEncoder),
            'EventBusName': os.environ['EVENT_BUS_NAME']
        }]
    )

@durable_execution
def lambda_handler(event: dict, context: DurableContext) -> dict:
    """
    Durable Visual Search Orchestrator.
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    bucket = event.get('bucket')
    key = event.get('key')
    request_id = event.get('requestId', str(uuid.uuid4()))
    
    if not bucket or not key:
        status_msg = "Missing bucket or key"
        logger.error(status_msg)
        return {"status": "error", "message": status_msg}
        
    try:
        # 1. Generate Embedding (Async Invoke)
        invocation_arn = context.step(generate_embedding_step(key, bucket))
        
        # 2. Poll for Embedding Completion
        embedding = context.step(poll_embedding_job_step(invocation_arn))
        
        # 3. Search Vectors
        uuids = context.step(search_vectors_step(embedding))
        
        if not uuids:
            logger.info("No matching vectors found. Skipping product details fetch.")
            context.step(emit_results_step([], "SUCCESS", "No products found."))
            return {"status": "success", "results_count": 0, "message": "No products found"}
        
        # 4. Fetch Details
        products = context.step(fetch_product_details_step(uuids))
        
        # 5. Emit Results
        context.step(emit_results_step(products, "SUCCESS", "Products matched successfully."))
        
        return {"status": "success", "results_count": len(products)}
    except Exception as e:
        logger.exception("Visual Search Workflow Failed")
        error_msg = str(e)
        context.step(emit_results_step([], "ERROR", error_msg))
        return {"status": "error", "message": error_msg}
