import json
import boto3
import os
import logging
# from aws_lambda_powertools import Logger # Bypassing for now to fix Import Error

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize standard boto3 client
client = boto3.client('bedrock-agentcore', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

def get_user_token(event):
    """Extract Cognito JWT token from AppSync authorization header."""
    headers = event.get('request', {}).get('headers', {})
    auth = headers.get('authorization', '')
    if auth.startswith('Bearer '):
        return auth[7:]
    return auth

def handler(event, context):
    logger.info(f"DEBUG: Event keys: {list(event.keys())}")
    if 'request' in event:
        logger.info(f"DEBUG: Request: {json.dumps(event['request'])}")
    if 'identity' in event:
        logger.info(f"DEBUG: Identity: {json.dumps(event['identity'])}")
    
    info = event.get('info', {})
    field_name = info.get('fieldName')
    agent_arn = os.environ.get('AGENT_ARN', "arn:aws:bedrock-agentcore:us-east-1:132260253285:runtime/furnitureagent-6hUMr6H0ic")
    user_token = get_user_token(event)
    
    # We omit getAgentWebsocketConfig for now to avoid dependency on AgentCoreRuntimeClient
    if field_name == 'getAgentWebsocketConfig':
         return {"message": "Websocket auth currently disabled for debugging."}
    
    return handle_invoke_agent(event, agent_arn, user_token)

def handle_invoke_agent(event, agent_arn, user_token=None):
    prompt = event.get('arguments', {}).get('prompt')
    if not prompt:
        return {"message": "No prompt provided."}
    
    try:
        payload = json.dumps({"prompt": prompt, "user_token": user_token})
        invoke_params = {
            'agentRuntimeArn': agent_arn,
            'payload': payload,
            'contentType': 'application/json',
            'accept': 'text/event-stream'
        }
        
        logger.info(f"Invoking agent with token present: {bool(user_token)}")
        
        response = client.invoke_agent_runtime(**invoke_params)
        
        full_text = ""
        for event in response.get('completion', []):
            if 'chunk' in event:
                full_text += event['chunk'].get('bytes', b'').decode('utf-8')
            elif 'trace' in event:
                pass
                
        if not full_text:
             # Basic Boto3 non-streaming check if it wasn't a stream
             if 'payload' in response:
                  full_text = response['payload'].read().decode('utf-8')

        if not full_text:
            return {"message": "Agent did not return any text."}
        
        return {"message": full_text}
    except Exception as e:
        logger.error(f"Error invoking agent: {str(e)}")
        return {"message": f"Error: {str(e)}"}
