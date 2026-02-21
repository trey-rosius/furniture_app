import json
import boto3
import os
import re
from aws_lambda_powertools import Logger

logger = Logger()

# Initialize Bedrock AgentCore client
client = boto3.client('bedrock-agentcore', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

def handler(event, context):
    """
    AppSync Resolver for invoking the Furniture AI Agent.
    Parses SSE response from the agent to return the final message.
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    prompt = event.get('arguments', {}).get('prompt')
    if not prompt:
        return {"message": "No prompt provided."}
    
    agent_arn = os.environ.get('AGENT_ARN')
    if not agent_arn:
        agent_arn = "arn:aws:bedrock-agentcore:us-east-1:132260253285:runtime/furnitureagent-6hUMr6H0ic"
    
    try:
        # Invoke the Agent Runtime
        payload = json.dumps({"prompt": prompt}).encode('utf-8')
        
        response = client.invoke_agent_runtime(
            agentRuntimeArn=agent_arn,
            payload=payload,
            contentType='application/json',
            accept='text/event-stream' # Request SSE
        )
        
        # Read the streaming response body
        # For SSE, we need to iterate over the chunks
        full_text = ""
        body = response.get('response')
        
        # Buffer to accumulate lines
        buffer = ""
        for chunk in body:
            buffer += chunk.decode('utf-8')
            while "\n\n" in buffer:
                part, buffer = buffer.split("\n\n", 1)
                # Parse SSE format: "data: {json}\n"
                match = re.search(r'^data: (.*)$', part, re.MULTILINE)
                if match:
                    try:
                        event_data = json.loads(match.group(1))
                        # Bedrock AgentCore/Strands SSE events often have 'text' delta
                        if 'delta' in event_data and 'text' in event_data['delta']:
                            full_text += event_data['delta']['text']
                        # Or 'message' object at the end
                        elif 'message' in event_data and 'content' in event_data['message']:
                            for content_item in event_data['message']['content']:
                                if 'text' in content_item:
                                    # This might be the full final text
                                    text = content_item['text']
                                    if len(text) > len(full_text):
                                        full_text = text
                    except Exception as parse_error:
                        logger.warning(f"Failed to parse SSE event: {part}, error: {parse_error}")

        logger.info(f"Aggregated agent response: {full_text}")
        
        if not full_text:
            return {"message": "Agent did not return any text."}
            
        return {"message": full_text}
        
    except Exception as e:
        logger.error(f"Error invoking agent: {str(e)}")
        return {"message": f"Error: {str(e)}"}
