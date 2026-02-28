import sys
from unittest.mock import MagicMock
sys.modules["pyaudio"] = MagicMock()

import asyncio
import os
import json
import httpx
import traceback
from datetime import datetime, timedelta

from strands import Agent
from strands.models import BedrockModel
from strands.experimental.bidi.models.nova_sonic import BidiNovaSonicModel
from strands.experimental.bidi.agent import BidiAgent
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from starlette.websockets import WebSocket, WebSocketDisconnect
from aws_lambda_powertools import Logger
import boto3

logger = Logger()

# Configuration
os.environ["BYPASS_TOOL_CONSENT"] = "true"

class GatewayTokenManager:
    def __init__(self, client_id, client_secret, token_endpoint, scope):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_endpoint = token_endpoint
        self.scope = scope
        self._token = None
        self._expires_at = None

    async def get_token(self):
        if self._token and self._expires_at and self._expires_at > datetime.now():
            return self._token
        logger.info("Fetching new Gateway access token...")
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_endpoint,
                data={
                    'grant_type': 'client_credentials',
                    'client_id': self.client_id,
                    'client_secret': self.client_secret,
                    'scope': self.scope
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )
            data = response.json()
            if 'access_token' not in data:
                logger.error(f"Failed to get token: {data}")
                raise Exception(f"Token error: {data.get('error')}")
            self._token = data['access_token']
            expires_in = data.get('expires_in', 3600) - 300
            self._expires_at = datetime.now() + timedelta(seconds=expires_in)
            return self._token

GATEWAY_URL = os.environ.get("GATEWAY_URL")
CLIENT_ID = os.environ.get("GATEWAY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GATEWAY_CLIENT_SECRET")
TOKEN_ENDPOINT = os.environ.get("GATEWAY_TOKEN_ENDPOINT")
SCOPE = os.environ.get("GATEWAY_SCOPE", "FurnitureGateway/invoke")
TEXT_MODEL_ID = os.environ.get("TEXT_MODEL_ID", "amazon.nova-lite-v1:0")
VOICE_MODEL_ID = os.environ.get("VOICE_MODEL_ID", "amazon.nova-2-sonic-v1:0")

token_manager = GatewayTokenManager(CLIENT_ID, CLIENT_SECRET, TOKEN_ENDPOINT, SCOPE)

def create_transport(mcp_url: str, access_token: str):
    return streamablehttp_client(mcp_url, headers={"Authorization": f"Bearer {access_token}"})

# -----------------
# WS Handler
# -----------------

app = BedrockAgentCoreApp()

@app.websocket
async def websocket_endpoint(websocket: WebSocket, context):
    await websocket.accept()
    logger.info("WebSocket connected directly to Agent Container /ws!")
    
    try:
        token = await token_manager.get_token()
        region = os.environ.get("AWS_REGION", "us-east-1")
        
        # The Gateway combines both Lambda tools and Stripe MCP tools automatically
        mcp_client = MCPClient(lambda: create_transport(GATEWAY_URL, token))
        
        with mcp_client:
            tools = mcp_client.list_tools_sync()
            logger.info(f"Loaded {len(tools)} tools from Gateway for Bidi streaming.")
            
            model = BidiNovaSonicModel(
                region=region,
                model_id=VOICE_MODEL_ID,
                provider_config={
                    "audio": {
                        "input_sample_rate": 16000,
                        "output_sample_rate": 16000,
                        "voice": "matthew",
                    }
                }
            )
            
            bidi_agent = BidiAgent(
                model=model,
                tools=tools,
                system_prompt="You are a helpful AI furniture assistant. Be concise. IMPORTANT: When providing URLs or payment links, never insert spaces within the URL."
            )
            
            async def handle_websocket_input():
                while True:
                    try:
                        message = await websocket.receive_json()
                        if message.get("type") == "bidi_text_input":
                            text = message.get("text", "")
                            logger.info(f"Received WS text input: {text}")
                            await bidi_agent.send(text)
                            continue
                        else:
                            return message
                    except WebSocketDisconnect:
                        logger.info("Client disconnected during input processing")
                        raise
                    except Exception as e:
                        logger.error(f"WS receive error: {e}")
                        raise
                        
            await bidi_agent.run(inputs=[handle_websocket_input], outputs=[websocket.send_json])

    except WebSocketDisconnect:
        logger.info("Client disconnected from /ws")
    except Exception as e:
        logger.error(f"WebSocket unhandled error: {e}")
        logger.error(traceback.format_exc())
    finally:
        try:
            await websocket.close()
        except:
            pass


# -----------------
# Unary REST Handler
# -----------------

async def get_tools_and_invoke(payload):
    try:
        token = await token_manager.get_token()
        region = os.environ.get("AWS_REGION", "us-east-1")
        
        # The Gateway combines both Lambda tools and Stripe MCP tools automatically
        mcp_client = MCPClient(lambda: create_transport(GATEWAY_URL, token))
        
        with mcp_client:
            tools = mcp_client.list_tools_sync()
            logger.info(f"Loaded {len(tools)} tools from Gateway for Unary invocation.")
                
            text_model = BedrockModel(region_name=region, model_id=TEXT_MODEL_ID)
            
            agent = Agent(
                model=text_model, 
                tools=tools, 
                callback_handler=None,
                system_prompt="You are a helpful AI furniture assistant. Be concise. IMPORTANT: When providing URLs or payment links, never insert spaces within the URL."
            )
            
            prompt = payload.get("prompt", "Hello")
            async for event in agent.stream_async(prompt):
                if hasattr(event, "model_dump"):
                    yield event.model_dump()
                elif hasattr(event, "dict"):
                    yield event.dict()
                elif isinstance(event, dict):
                    yield event
                else:
                    yield {"type": "event", "content": str(event)}
    except Exception as e:
        error_msg = f"Fatal error: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        yield {"type": "error", "message": error_msg, "trace": traceback.format_exc()}

@app.entrypoint
async def agent_invocation(payload, context):
    async for event in get_tools_and_invoke(payload):
         yield event

if __name__ == "__main__":
    app.run()
