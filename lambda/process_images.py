import boto3
import json
import os
import urllib.parse
import uuid
import random
from decimal import Decimal
from botocore.exceptions import ClientError
from urllib.parse import urlparse
from aws_lambda_powertools import Logger, Tracer

# --- CONFIGURATION ---
SOURCE_BUCKET = os.environ.get("SOURCE_BUCKET", "furniture-app-bucket")
VECTOR_BUCKET = os.environ.get("VECTOR_BUCKET", "furniture-app-vector-bucket")
VECTOR_INDEX = os.environ.get("VECTOR_INDEX", "furniture-app-index")
DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "furniture-app-table")


logger = Logger()
tracer = Tracer()

# Clients
s3 = boto3.client('s3')
s3vectors = boto3.client('s3vectors')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(DYNAMODB_TABLE)

@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    logger.info(f"Received Payload: {json.dumps(event)}")
    
    s3_uri = event.get('S3Uri', '')
    media_file_uri = event.get('mediaFileUri', '')

    if not s3_uri or not media_file_uri:
        logger.error("Missing S3Uri or mediaFileUri in payload.")
        return {"status": "error", "message": "Missing paths"}

    try:
        # 1. Locate the .jsonl file in the Bedrock result folder
        parsed_uri = urlparse(s3_uri)
        result_prefix = urllib.parse.unquote_plus(parsed_uri.path.lstrip('/'))
        
        logger.info(f"Scanning result folder: {result_prefix}")
        response = s3.list_objects_v2(Bucket=SOURCE_BUCKET, Prefix=result_prefix)
        
        jsonl_key = next((obj['Key'] for obj in response.get('Contents', []) if obj['Key'].endswith('.jsonl')), None)
        
        if not jsonl_key:
            logger.error(f"No .jsonl file found in {result_prefix}")
            return {"status": "error", "message": "No embedding file found"}

        # 2. Read Embedding Data
        embedding_obj = s3.get_object(Bucket=SOURCE_BUCKET, Key=jsonl_key)
        embedding_data = json.loads(embedding_obj['Body'].read().decode('utf-8'))
        embedding = embedding_data.get('embedding')

        # 3. Decode Path & Fetch Metadata
        # We no longer "fix" the catalog path; we use the path as provided.
        parsed_media = urlparse(media_file_uri)
        media_path = urllib.parse.unquote_plus(parsed_media.path.lstrip('/'))
        metadata_key = media_path.rsplit('.', 1)[0] + '.json'
        
        logger.info(f"Fetching metadata from: {metadata_key}")
        meta_obj = s3.get_object(Bucket=SOURCE_BUCKET, Key=metadata_key)
        metadata = json.loads(meta_obj['Body'].read().decode('utf-8'))

        # 4. Generate Unique ID & Extract Info
        new_product_uuid = str(uuid.uuid4())
        category = metadata.get('cat', 'Uncategorized')
        random_price = Decimal(str(round(random.uniform(50.0, 1500.0), 2)))

        # 5. Save to DynamoDB
        logger.info(f"Saving UUID {new_product_uuid} to DynamoDB with price ${random_price}")
        table.put_item(
            Item={
                'PK': f"PROD#{new_product_uuid}",
                'SK': f"PROD#{new_product_uuid}",
                'productName': metadata.get('productName'),
                'imageFile': metadata.get('imageFile'),
                'category': category,
                'subCategory': metadata.get('sub'),
                'level': metadata.get('lvl'),
                'image_uri': media_file_uri,
                'price': random_price,
                'original_productId': metadata.get('productId')
            }
        )

        # 6. Save to S3 Vectors
        logger.info(f"Ingesting into S3 Vector Index")
        s3vectors.put_vectors(
            vectorBucketName=VECTOR_BUCKET,
            indexName=VECTOR_INDEX,
            vectors=[{
                'key': new_product_uuid,
                'data': {'float32': embedding},
                'metadata': {
                    'cat': category,
                    'sub': metadata.get('sub'),
                    'prod_uuid': new_product_uuid
                }
            }]
        )

        return {"status": "success", "uuid": new_product_uuid}

    except Exception as e:
        logger.exception("CRITICAL ERROR in process_images lambda")
        raise e