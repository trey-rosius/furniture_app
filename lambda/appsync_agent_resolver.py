import json
import boto3
import os
import re
import datetime
import hashlib
import hmac
import urllib.parse
import uuid
import logging
from botocore.exceptions import ClientError
from botocore.auth import SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from aws_lambda_powertools import Logger

logger = Logger()

class AgentResolver:
    def _extract_products_from_tool_result(self, tool_result, product_list):
        """Helper to extract products from a tool result object."""
        content = tool_result.get('content', [])
        for part in content:
            if 'text' in part:
                try:
                    data = json.loads(part['text'])
                    if isinstance(data, list):
                        # Filter for things that look like products
                        for p in data:
                            if isinstance(p, dict) and ('productName' in p or 'price' in p):
                                product_list.append(p)
                except:
                    pass

    def _find_and_extract_products(self, data, product_list):
        """Recursively search for tool results or product-like lists in any data structure."""
        if isinstance(data, dict):
            # Check for direct matches
            if 'tool_result' in data:
                self._extract_products_from_tool_result(data['tool_result'], product_list)
            if 'toolResult' in data:
                self._extract_products_from_tool_result(data['toolResult'], product_list)
            if 'products' in data and isinstance(data['products'], list):
                # De-duplicate by PK or name
                existing_pks = {p.get('PK') for p in product_list if p.get('PK')}
                for p in data['products']:
                    if isinstance(p, dict) and p.get('PK') not in existing_pks:
                        product_list.append(p)
            
            # Recurse
            for v in data.values():
                self._find_and_extract_products(v, product_list)
        elif isinstance(data, list):
            for item in data:
                self._find_and_extract_products(item, product_list)

    def handle_invoke_agent(self, event):
        prompt = event.get('arguments', {}).get('prompt', '')
        if not prompt:
            return {"message": "Please provide a prompt.", "products": []}
            
        runtime = boto3.client('bedrock-agentcore')
        agent_arn = os.environ.get('AGENT_ARN')
        
        try:
            response = runtime.invoke_agent_runtime(
                agentRuntimeArn=agent_arn,
                payload=json.dumps({"prompt": prompt}),
                accept='text/event-stream'
            )
            
            full_text = ""
            all_products = []
            body = response.get('response')
            
            buffer = ""
            for chunk in body:
                raw_chunk = chunk.decode('utf-8')
                buffer += raw_chunk
                print(f"DEBUG: Received chunk: {raw_chunk}", flush=True)
                
                while "\n\n" in buffer:
                    part, buffer = buffer.split("\n\n", 1)
                    print(f"DEBUG: Processing part: {part}", flush=True)
                    match = re.search(r'^data: (.*)$', part, re.MULTILINE | re.DOTALL)
                    if match:
                        data_raw = match.group(1).strip()
                        print(f"DEBUG: data_raw: {data_raw}", flush=True)
                        try:
                            # Try parsing as JSON first
                            event_data = None
                            try:
                                event_data = json.loads(data_raw)
                            except:
                                # Handle literal string representations (repr output)
                                if data_raw.startswith('{') or data_raw.startswith('['):
                                    import ast
                                    try:
                                        event_data = ast.literal_eval(data_raw)
                                    except: pass
                            
                            if not event_data or not isinstance(event_data, dict):
                                print(f"DEBUG: Could not parse event_data or not dict: {data_raw[:100]}", flush=True)
                                continue

                            print(f"DEBUG: Parsed event type: {event_data.get('type')}", flush=True)

                            # 1. Error handling
                            if event_data.get('type') == 'error':
                                full_text = f"Agent Error: {event_data.get('message')}"
                                logger.error(full_text)
                                continue

                            # 2. Capture Text from various event styles
                            # Delta text
                            if 'delta' in event_data and 'text' in event_data['delta']:
                                full_text += event_data['delta']['text']
                            
                            # Bedrock contentBlockDelta
                            if 'event' in event_data and 'contentBlockDelta' in event_data['event']:
                                delta = event_data['event']['contentBlockDelta'].get('delta', {})
                                if 'text' in delta:
                                    full_text += delta['text']
                            
                            # Full message replay
                            if 'message' in event_data and 'content' in event_data['message']:
                                for part_item in event_data['message']['content']:
                                    if 'text' in part_item:
                                        if len(part_item['text']) > len(full_text):
                                            full_text = part_item['text']

                            # 3. Capture Products/Tool Results recursively
                            before_count = len(all_products)
                            self._find_and_extract_products(event_data, all_products)

                        except Exception as parse_error:
                            logger.error(f"Event skipped: {parse_error}")

            if not full_text and not all_products:
                return {"message": "Agent did not return any text.", "products": []}
                
            return {
                "message": full_text if full_text else "Here are the products I found:",
                "products": all_products[:10]
            }
            
        except Exception as e:
            print(f"DEBUG: invoking agent exception: {str(e)}", flush=True)
            logger.error(f"Error invoking agent: {str(e)}")
            return {"message": f"Error: {str(e)}", "products": []}

    def handle_get_agent_websocket_config(self, event):
        agent_arn = os.environ.get('AGENT_ARN')
        region = os.environ.get('AWS_REGION', 'us-east-1')
        
        if not agent_arn:
            logger.error("AGENT_ARN environment variable not set.")
            return {"url": ""}
            
        try:
            # Try using the library first
            try:
                from bedrock_agentcore.runtime import AgentCoreRuntimeClient
                client = AgentCoreRuntimeClient(region=region)
                url = client.generate_presigned_url(
                    runtime_arn=agent_arn,
                    endpoint_name='DEFAULT'
                )
                logger.info(f"Generated URL using library: {url}")
                return {"url": url, "headers": "{}"}
            except (ImportError, AttributeError) as e:
                logger.warning(f"Library not available or missing method: {e}. Falling back to manual SigV4.")
                url = self._generate_presigned_ws_url(agent_arn, region)
                return {"url": url, "headers": "{}"}
        except Exception as e:
            logger.error(f"Error generating websocket URL: {str(e)}")
            return {"url": "", "headers": "{}"}

    def _generate_presigned_ws_url(self, agent_arn, region):
        method = 'GET'
        service = 'bedrock-agentcore'
        host = f'bedrock-agentcore.{region}.amazonaws.com'
        
        # URL encode the ARN
        encoded_arn = urllib.parse.quote(agent_arn, safe='')
        canonical_uri = f'/runtimes/{encoded_arn}/ws'
        
        # Datetimes
        now = datetime.datetime.utcnow()
        amz_date = now.strftime('%Y%m%dT%H%M%SZ')
        datestamp = now.strftime('%Y%m%d')
        
        session = boto3.Session()
        credentials = session.get_credentials().get_frozen_credentials()
        
        # Query string
        params = {
            'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
            'X-Amz-Credential': f'{credentials.access_key}/{datestamp}/{region}/{service}/aws4_request',
            'X-Amz-Date': amz_date,
            'X-Amz-Expires': '300',
            'X-Amz-SignedHeaders': 'host',
            'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': str(uuid.uuid4()),
            'qualifier': 'DEFAULT'
        }
        if credentials.token:
            params['X-Amz-Security-Token'] = credentials.token
            
        # Use botocore for reliable signing if possible
        try:
            https_url = f"https://{host}{canonical_uri}"
            request = AWSRequest(method="GET", url=https_url, params=params)
            signer = SigV4QueryAuth(credentials, service, region, expires=300)
            signer.add_auth(request)
            url = request.url.replace("https://", "wss://")
            logger.info(f"Generated WebSocket URL using botocore: {url}")
            return url
        except Exception as e:
            logger.warning(f"Botocore signing failed: {e}. Falling back to manual implementation.")
            
            # Manual fallback with correct encoding
            def aws_quote(s):
                return urllib.parse.quote(s, safe='-._~')

            sorted_keys = sorted(params.keys())
            canonical_querystring = '&'.join([f"{aws_quote(k)}={aws_quote(params[k])}" for k in sorted_keys])
            
            canonical_headers = f'host:{host}\n'
            signed_headers = 'host'
            payload_hash = hashlib.sha256(''.encode('utf-8')).hexdigest()
            
            canonical_request = f"{method}\n{canonical_uri}\n{canonical_querystring}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
            
            credential_scope = f"{datestamp}/{region}/{service}/aws4_request"
            string_to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
            
            def sign(key, msg):
                return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()

            kDate = sign(('AWS4' + credentials.secret_key).encode('utf-8'), datestamp)
            kRegion = sign(kDate, region)
            kService = sign(kRegion, service)
            kSigning = sign(kService, 'aws4_request')
            
            signature = hmac.new(kSigning, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
            
            url = f"wss://{host}{canonical_uri}?{canonical_querystring}&X-Amz-Signature={signature}"
            logger.info(f"Generated WebSocket URL using manual fallback: {url}")
            return url

def handler(event, context):
    resolver = AgentResolver()
    field = event.get('info', {}).get('fieldName')
    
    if field == 'invokeAgent':
        return resolver.handle_invoke_agent(event)
    elif field == 'getAgentWebsocketConfig':
        return resolver.handle_get_agent_websocket_config(event)
    
    return {"message": "Unknown field", "products": []}
