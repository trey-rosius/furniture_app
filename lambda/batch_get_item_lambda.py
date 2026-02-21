import boto3
import os
import json
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger, Tracer

logger = Logger()
tracer = Tracer()

DYNAMODB_TABLE = os.environ.get('DYNAMODB_TABLE')
dynamodb = boto3.resource('dynamodb')

@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    """
    Expects event: {"uuids": ["...", "..."]}
    """
    uuid_list = event.get('uuids', [])
    if not uuid_list:
        logger.warning("No UUIDs provided to batch_get_item")
        return []

    # Construct the keys for BatchGetItem
    request_keys = [
        {
            'PK': f"PROD#{uid}",
            'SK': f"PROD#{uid}"
        } for uid in uuid_list
    ]

    try:
        # BatchGetItem can take up to 100 items at once
        response = dynamodb.batch_get_item(
            RequestItems={
                DYNAMODB_TABLE: {
                    'Keys': request_keys,
                    'ConsistentRead': False
                }
            }
        )

        # Extract the items from the specific table result
        items = response.get('Responses', {}).get(DYNAMODB_TABLE, [])
        
        # Log unprocessed keys for debugging
        unprocessed = response.get('UnprocessedKeys', {})
        if unprocessed:
            logger.info(f"{len(unprocessed)} keys were not processed.")

        return items

    except ClientError as e:
        logger.error(f"Error in batch_get_item: {e.response['Error']['Message']}")
        return []
