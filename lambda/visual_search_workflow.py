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

@durable_step
def get_image_step(step_context: StepContext, bucket: str, key: str) -> str:
    """Download image from S3 and return base64 string."""
    step_context.logger.info(f"Downloading s3://{bucket}/{key}")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    image_bytes = response['Body'].read()
    return base64.b64encode(image_bytes).decode('utf-8')

@durable_step
def generate_embedding_step(step_context: StepContext, base64_image: str, key: str) -> list:
    """Invoke Bedrock Nova to generate multimodal embedding."""
    step_context.logger.info("Generating embedding from Bedrock Nova")
    
    image_format = "png" if key.lower().endswith('.png') else "jpeg"
    if key.lower().endswith(('.jpg', '.jpeg')):
        image_format = "jpeg"
        
    native_request = {
        "taskType": "SINGLE_EMBEDDING",
        "singleEmbeddingParams": {
            "embeddingPurpose": "GENERIC_INDEX",
            "embeddingDimension": 3072,
            "image": {
                "format": image_format,
                "detailLevel": "STANDARD_IMAGE",
                "source": {"bytes": base64_image},
            },
        },
    }
    
    bedrock_response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=json.dumps(native_request)
    )
    result = json.loads(bedrock_response['body'].read())
    return result["embeddings"][0]["embedding"]

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

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

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
        # 1. Get Image
        base64_image = context.step(get_image_step(bucket, key))
        
        # 2. Generate Embedding
        embedding = context.step(generate_embedding_step(base64_image, key))
        
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
