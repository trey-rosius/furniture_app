import sys
import subprocess
print("DEBUG: agent_runtime.py starting...", flush=True)

# Bypassing problematic imports for debugging
from unittest.mock import MagicMock
sys.modules["pyaudio"] = MagicMock()
# sys.modules["aws_sdk_bedrock_runtime"] = MagicMock() # Mocking didn't help if it's imported deep in strands

import asyncio
import os
import json
import httpx
import traceback
from datetime import datetime, timedelta

from strands import Agent
from strands.models import BedrockModel
# from strands.experimental.bidi.models.nova_sonic import BidiNovaSonicModel # CRASHING: ModuleNotFound
# from strands.experimental.bidi.agent import BidiAgent # Depends on it

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

# Gateway ARN: arn:aws:bedrock-agentcore:us-east-1:132260253285:gateway/furnituregateway-iwz7nicp8r
ENCODED_GW_ARN = "arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A132260253285%3Agateway%2Ffurnituregateway-iwz7nicp8r"
GATEWAY_URL = os.environ.get("GATEWAY_URL", f"https://bedrock-agentcore.us-east-1.amazonaws.com/gateways/{ENCODED_GW_ARN}/mcp")
CLIENT_ID = os.environ.get("GATEWAY_CLIENT_ID", "1lfpkr6r9s5d1a33a2lv7ueup4")
CLIENT_SECRET = os.environ.get("GATEWAY_CLIENT_SECRET", "") 
TOKEN_ENDPOINT = os.environ.get("GATEWAY_TOKEN_ENDPOINT", "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_2stKOWX3B/token")
SCOPE = os.environ.get("GATEWAY_SCOPE", "FurnitureGateway/invoke")
TEXT_MODEL_ID = os.environ.get("TEXT_MODEL_ID", "amazon.nova-lite-v1:0")

token_manager = GatewayTokenManager(CLIENT_ID, CLIENT_SECRET, TOKEN_ENDPOINT, SCOPE)

def create_transport(mcp_url: str, access_token: str):
    return streamablehttp_client(mcp_url, headers={"Authorization": f"Bearer {access_token}"})

app = BedrockAgentCoreApp()

@app.websocket
async def websocket_endpoint(websocket: WebSocket, context):
    await websocket.accept()
    logger.info("WebSocket connected. Bidi currently disabled for debugging.")
    await websocket.send_json({"type": "error", "message": "Bidi currently disabled due to dependency issue."})
    await websocket.close()

# -----------------
# Unary REST Handler
# -----------------

async def get_tools_and_invoke(payload):
    try:
        user_token = payload.get("user_token")
        if user_token:
            logger.info("Using propagated user token for gateway tools")
            token = user_token
        else:
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
                system_prompt="You are a helpful AI furniture assistant. Be concise."
            )
            
            prompt = payload.get("prompt", "Hello")
            async for event in agent.stream_async(prompt):
                if isinstance(event, dict):
                    output = {}
                    if "delta" in event and isinstance(event["delta"], dict) and "text" in event["delta"]:
                        output["delta"] = {"text": event["delta"]["text"]}
                    if output:
                        yield output
                elif hasattr(event, "delta") and hasattr(event.delta, "text"):
                    yield {"delta": {"text": event.delta.text}}
    except Exception as e:
        error_msg = f"Fatal error: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        yield {"type": "error", "message": error_msg}

@app.entrypoint
async def agent_invocation(payload, context):
    logger.info(f"Invoking agent with payload: {payload}")
    async for event in get_tools_and_invoke(payload):
         yield event

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
