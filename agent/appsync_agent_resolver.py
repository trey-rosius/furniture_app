import json
import boto3
import os
import re
import logging

# Use standard logging to avoid dependency issues
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize standard boto3 client
client = boto3.client('bedrock-agentcore', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

TABLE_NAME = os.environ.get('PRODUCT_TABLE')
table = dynamodb.Table(TABLE_NAME) if TABLE_NAME else None

def get_presigned_url(s3_uri):
    if not s3_uri or not s3_uri.startswith('s3://'):
        return None
    try:
        bucket_and_key = s3_uri.replace('s3://', '')
        parts = bucket_and_key.split('/')
        bucket = parts[0]
        key = '/'.join(parts[1:])
        
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=3600
        )
        return url
    except Exception as e:
        logger.warning(f"Error generating presigned URL for {s3_uri}: {e}")
        return None

def enrich_product(item):
    """Enrich product item with real data from DynamoDB and S3 presigned URLs."""
    if not table:
        return item
    
    pk = item.get('PK')
    sk = item.get('SK')
    prod_uuid = item.get('prod_uuid') or item.get('id') or item.get('productId')
    
    # Map prod_uuid to PK/SK if needed
    if not pk and prod_uuid:
        pk = f"PROD#{prod_uuid}"
        sk = f"PROD#{prod_uuid}"
    
    # If we have PK/SK, fetch the latest from DDB
    if pk and sk:
        try:
            logger.info(f"Enriching product {pk} from DynamoDB")
            response = table.get_item(Key={'PK': pk, 'SK': sk})
            if 'Item' in response:
                # Merge the DDB item into the tool output, preferring DDB data
                ddb_item = response['Item']
                # Ensure Decimal values are converted to float/int
                for k, v in ddb_item.items():
                    if hasattr(v, 'to_integral_value'): # Check if it's a Decimal
                        ddb_item[k] = float(v)
                # Ensure PK/SK are strings
                if 'PK' in ddb_item: ddb_item['PK'] = str(ddb_item['PK'])
                if 'SK' in ddb_item: ddb_item['SK'] = str(ddb_item['SK'])
                item.update(ddb_item)
        except Exception as e:
            logger.error(f"Error fetching product details from DDB: {e}")
    
    # Ensure we have a presigned URL for the image
    image_uri = item.get('image_uri')
    if image_uri:
        presigned_url = get_presigned_url(image_uri)
        if presigned_url:
            item['image_url'] = presigned_url
            item['image'] = presigned_url # Overwrite for frontend compatibility
            
    return item

def handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    
    info = event.get('info', {})
    field_name = info.get('fieldName')
    
    # Use the specific agent runtime ARN
    agent_arn = os.environ.get('AGENT_RUNTIME_ARN')

    if field_name == 'getAgentWebsocketConfig':
        return handle_get_websocket_config(agent_arn)
    
    return handle_invoke_agent(event, agent_arn)

def handle_get_websocket_config(agent_arn):
    import uuid
    import urllib.parse
    from botocore.auth import SigV4QueryAuth
    from botocore.awsrequest import AWSRequest
    
    logger.info(f"Generating presigned WSS URL for agent: {agent_arn}")
    try:
        region = os.environ.get('AWS_REGION', 'us-east-1')
        session = boto3.Session()
        credentials = session.get_credentials().get_frozen_credentials()
        
        host = f"bedrock-agentcore.{region}.amazonaws.com"
        encoded_arn = urllib.parse.quote(agent_arn, safe="")
        session_id = str(uuid.uuid4())
        path = f"/runtimes/{encoded_arn}/ws"
        
        query_params = {
            "qualifier": "DEFAULT",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id
        }
        query_string = urllib.parse.urlencode(query_params)
        https_url = f"https://{host}{path}?{query_string}"
        
        request = AWSRequest(method="GET", url=https_url, headers={"host": host})
        
        signer = SigV4QueryAuth(
            credentials=credentials,
            service_name="bedrock-agentcore",
            region_name=region,
            expires=300,
        )
        signer.add_auth(request)
        
        ws_url = request.url.replace("https://", "wss://")
        
        logger.info(f"Generated WebSocket URL successfully")
        return {
            "url": ws_url,
            "headers": "{}"
        }
    except Exception as e:
        import traceback
        logger.error(f"Error generating websocket config: {str(e)}")
        logger.error(traceback.format_exc())
        raise e

def handle_invoke_agent(event, agent_arn):
    prompt = event.get('arguments', {}).get('prompt')
    if not prompt:
        return {"message": "No prompt provided."}
    
    try:
        # Invoke the Agent Runtime
        payload = json.dumps({"prompt": prompt}).encode('utf-8')
        
        logger.info(f"Invoking agent {agent_arn} with prompt: {prompt}")
        
        response = client.invoke_agent_runtime(
            agentRuntimeArn=agent_arn,
            payload=payload,
            contentType='application/json',
            accept='text/event-stream'
        )
        
        full_text = ""
        products = []
        # The key for the stream in bedrock-agentcore is 'response'
        body = response.get('response')
        
        if not body:
            logger.error(f"No response stream found in boto3 response. Keys: {list(response.keys())}")
            return {"message": "Error: No response stream from agent."}
            
        buffer = ""
        for chunk in body:
            decoded_chunk = chunk.decode('utf-8')
            logger.info(f"Received raw chunk: {decoded_chunk}")
            buffer += decoded_chunk
            # SSE handling
            while "\n\n" in buffer:
                part, buffer = buffer.split("\n\n", 1)
                match = re.search(r'^data: (.*)$', part, re.MULTILINE)
                if match:
                    try:
                        event_data = json.loads(match.group(1))
                        logger.info(f"Parsed event: {event_data}")
                        
                        # Support Strands event types
                        event_type = event_data.get('type')
                        
                        if event_type == 'text' or event_type == 'delta':
                             content = event_data.get('content', '') or event_data.get('text', '')
                             if isinstance(content, dict):
                                 full_text += content.get('text', '')
                             else:
                                 full_text += content
                        elif event_type == 'tool_output':
                             # This is where the product results are!
                             output = event_data.get('content', [])
                             if isinstance(output, str):
                                 try:
                                     output = json.loads(output)
                                 except:
                                     pass
                             
                             if isinstance(output, list):
                                 # We assume these are the products found by the tool
                                 for item in output:
                                     if isinstance(item, dict):
                                         if 'metadata' in item:
                                             item.update(item['metadata'])
                                         
                                         enriched_item = enrich_product(item)
                                         if 'productName' in enriched_item or 'name' in enriched_item:
                                             products.append(enriched_item)

                        # Support both delta and message formats (Bedrock fallbacks)
                        if 'delta' in event_data and 'text' in event_data['delta']:
                            full_text += event_data['delta']['text']
                        elif 'message' in event_data and 'content' in event_data['message']:
                            # For Bedrock message events, the content is an array of content items
                            current_block_text = ""
                            for content_item in event_data['message']['content']:
                                if 'text' in content_item:
                                    current_block_text += content_item['text']
                            # If this is a final message that includes all text, use it
                            if len(current_block_text) > len(full_text):
                                full_text = current_block_text
                        elif 'text' in event_data:
                            # Direct text key (fallback)
                            if event_data['text'] not in full_text:
                                full_text += event_data['text']
                    except Exception as parse_error:
                        logger.warning(f"Failed to parse SSE event: {part}, error: {parse_error}")

        logger.info(f"Final full text: {full_text}")
        logger.info(f"Collected products: {len(products)}")
        
        if not full_text:
            return {"message": "Agent did not return any text.", "products": products}
            
        return {"message": full_text, "products": products}
        
    except Exception as e:
        import traceback
        logger.error(f"Error invoking agent: {str(e)}")
        logger.error(traceback.format_exc())
        return {"message": f"Error: {str(e)}"}
