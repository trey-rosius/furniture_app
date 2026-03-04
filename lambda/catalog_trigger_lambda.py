import boto3
import os
import json
from aws_lambda_powertools import Logger, Tracer

logger = Logger()
tracer = Tracer()

sfn_client = boto3.client('stepfunctions')
STATE_MACHINE_ARN = os.environ.get('STATE_MACHINE_ARN')

@logger.inject_lambda_context
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    logger.info("GraphQL Event received to trigger catalog processing")
    
    if STATE_MACHINE_ARN:
        logger.info(f"Triggering workflow {STATE_MACHINE_ARN}")
        # The Step Functions map state is configured to read the entire catalog/
        # bucket prefix directly, so no specific input is needed for listObjectsV2
        sfn_client.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps({"source": "graphql_trigger"})
        )
        return True
    
    return False
