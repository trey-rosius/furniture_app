import sys
print("DEBUG: STARTING SCRIPT", file=sys.stderr, flush=True)
print("DEBUG: Agent runtime starting...", file=sys.stderr, flush=True)
from unittest.mock import MagicMock
# Mock pyaudio for server environment
sys.modules["pyaudio"] = MagicMock()

import asyncio
import os
import json
import httpx
import traceback
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Optional
# 
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
                    'client_secret': self.client_secret
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
TEXT_MODEL_ID = os.environ.get("TEXT_MODEL_ID", "us.anthropic.claude-3-haiku-20240307-v1:0")
VOICE_MODEL_ID = os.environ.get("VOICE_MODEL_ID", "amazon.nova-2-sonic-v1:0")

token_manager = GatewayTokenManager(CLIENT_ID, CLIENT_SECRET, TOKEN_ENDPOINT, SCOPE)

def create_transport(mcp_url: str, access_token: str):
    return streamablehttp_client(mcp_url, headers={"Authorization": f"Bearer {access_token}"})

# -----------------
# WS Handler
# -----------------

app = BedrockAgentCoreApp()


async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for voice chat."""
    await websocket.accept()
    logger.info("New WebSocket connection accepted")
    
    connection_id = str(uuid.uuid4())
    
    # Send connection start message
    await websocket.send_json({
        "type": "bidi_connection_start",
        "connection_id": connection_id,
        "model": VOICE_MODEL_ID
    })

    try:
        token = await token_manager.get_token()
        region = os.environ.get("AWS_REGION", "us-east-1")
        
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
                system_prompt="You are a helpful AI furniture assistant. Be concise."
            )

            logger.info(f"Agent initialized for connection {connection_id}")

            async def input_handler():
                """Handle incoming messages from the client."""
                while True:
                    try:
                        message = await websocket.receive_json()
                        
                        # Check if it's a text message from the client
                        if message.get("type") == "bidi_text_input":
                            text = message.get("text", "")
                            logger.info(f"Received text input: {text}")
                            # Send the text to the agent
                            await bidi_agent.send(text)
                            # Continue to next message without returning this one
                            continue
                        elif message.get("type") == "bidi_audio_input":
                            audio_b64 = message.get("audio", "")
                            if audio_b64:
                                import base64
                                audio_bytes = base64.b64decode(audio_b64)
                                return {"type": "bidi_audio_input", "audio": audio_bytes}
                        
                        # Pass through other message types to agent.run
                        return message
                    except Exception as e:
                        logger.error(f"Error in input_handler: {e}")
                        return None

            async def output_handler(event):
                """Send outgoing messages to the client."""
                try:
                    # BidiOutputEvent might be a pydantic model
                    if hasattr(event, "model_dump"):
                        out_msg = event.model_dump()
                    elif isinstance(event, dict):
                        out_msg = event.copy()
                    else:
                        out_msg = {"type": "event", "content": str(event)}

                    # Base64 encode audio bytes if present for JSON transport
                    if "audio" in out_msg and isinstance(out_msg["audio"], bytes):
                        import base64
                        out_msg["audio"] = base64.b64encode(out_msg["audio"]).decode("utf-8")
                        out_msg["type"] = "bidi_audio_output"
                    
                    await websocket.send_json(out_msg)
                except Exception as e:
                    logger.error(f"Error in output_handler: {e}")

            logger.info("Starting bidi agent loop")
            await bidi_agent.run(
                inputs=[input_handler],
                outputs=[output_handler]
            )
            logger.info("Bidi agent loop finished")
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for {connection_id}")
    except Exception as e:
        logger.exception(f"Error in websocket_endpoint for {connection_id}: {e}")
    finally:
        try:
            await websocket.close()
        except:
            pass
        logger.info(f"WebSocket closed for {connection_id}")

# Register the WebSocket route explicitly for Starlette
app.add_websocket_route("/ws", websocket_endpoint)


# -----------------
# Unary REST Handler
# -----------------

async def invoke_agent_stream(payload):
    """Stream response for unary invocation."""
    try:
        token = await token_manager.get_token()
        region = os.environ.get("AWS_REGION", "us-east-1")
        mcp_client = MCPClient(lambda: create_transport(GATEWAY_URL, token))
        
        with mcp_client:
            tools = mcp_client.list_tools_sync()
            text_model = BedrockModel(region_name=region, model_id=TEXT_MODEL_ID)
            
            agent = Agent(
                model=text_model, 
                tools=tools, 
                system_prompt="You are a helpful AI furniture assistant."
            )
            
            prompt = payload.get("prompt", "Hello")
            async for event in agent.stream_async(prompt):
                if hasattr(event, "model_dump"):
                    yield event.model_dump()
                elif isinstance(event, dict):
                    yield event
                else:
                    yield {"type": "event", "content": str(event)}
    except Exception as e:
        logger.exception("Unary invocation failed")
        yield {"type": "error", "message": str(e)}

@app.entrypoint
async def agent_invocation(payload, context):
    async for event in invoke_agent_stream(payload):
         yield event

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"DEBUG: IN MAIN BLOCK, port={port}", flush=True)
    try:
        print("DEBUG: Calling app.run()...", flush=True)
        app.run(port=port)
        print("DEBUG: app.run() returned normally", flush=True)
    except Exception as e:
        print(f"DEBUG: app.run() failed with error: {e}", flush=True)
        traceback.print_exc()
        sys.exit(1)
