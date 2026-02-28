import json
import boto3
import os
import re
from aws_lambda_powertools import Logger
from bedrock_agentcore.runtime import AgentCoreRuntimeClient

logger = Logger()

# Initialize Bedrock AgentCore client for standard invocations
client = boto3.client('bedrock-agentcore', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
# Initialize runtime client for WebSocket Auth
runtime_client = AgentCoreRuntimeClient(region=os.environ.get('AWS_REGION', 'us-east-1'))

def handler(event, context):
    """
    AppSync Resolver for Furniture AI Agent.
    Handles invokeAgent (unary) and getAgentWebsocketConfig (WSS auth).
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    info = event.get('info', {})
    field_name = info.get('fieldName')
    
    # Use the specific agent runtime ARN
    agent_arn = os.environ.get('AGENT_ARN', "arn:aws:bedrock-agentcore:us-east-1:132260253285:runtime/furnitureagent-6hUMr6H0ic")

    if field_name == 'getAgentWebsocketConfig':
        return handle_get_websocket_config(agent_arn)
    
    # Default: handle invokeAgent
    return handle_invoke_agent(event, agent_arn)

def handle_get_websocket_config(agent_arn):
    logger.info(f"Generating presigned WSS URL for agent: {agent_arn}")
    try:
        # Generate a presigned URL that the frontend can use directly
        presigned_url = runtime_client.generate_presigned_url(
            runtime_arn=agent_arn,
            endpoint_name='DEFAULT',
            expires=300
        )
        
        logger.info("Successfully generated presigned WSS URL")
        
        return {
            "url": presigned_url,
            "headers": "{}" # Headers are included in query params for presigned URLs
        }
    except Exception as e:
        import traceback
        logger.error(f"Error generating websocket config: {str(e)}")
        logger.error(traceback.format_exc())
        raise e

def handle_invoke_agent(event, agent_arn):
    """Existing text-to-text invocation logic."""
    prompt = event.get('arguments', {}).get('prompt')
    if not prompt:
        return {"message": "No prompt provided."}
    
    try:
        # Invoke the Agent Runtime
        payload = json.dumps({"prompt": prompt}).encode('utf-8')
        
        response = client.invoke_agent_runtime(
            agentRuntimeArn=agent_arn,
            payload=payload,
            contentType='application/json',
            accept='text/event-stream'
        )
        
        full_text = ""
        body = response.get('response')
        
        buffer = ""
        for chunk in body:
            buffer += chunk.decode('utf-8')
            while "\n\n" in buffer:
                part, buffer = buffer.split("\n\n", 1)
                match = re.search(r'^data: (.*)$', part, re.MULTILINE)
                if match:
                    try:
                        event_data = json.loads(match.group(1))
                        if 'delta' in event_data and 'text' in event_data['delta']:
                            full_text += event_data['delta']['text']
                        elif 'message' in event_data and 'content' in event_data['message']:
                            for content_item in event_data['message']['content']:
                                if 'text' in content_item:
                                    text = content_item['text']
                                    if len(text) > len(full_text):
                                        full_text = text
                    except Exception as parse_error:
                        logger.warning(f"Failed to parse SSE event: {part}, error: {parse_error}")

        if not full_text:
            return {"message": "Agent did not return any text."}
            
        return {"message": full_text}
        
    except Exception as e:
        logger.error(f"Error invoking agent: {str(e)}")
        return {"message": f"Error: {str(e)}"}
