import asyncio
import os
import json
import httpx
from datetime import datetime, timedelta
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from aws_lambda_powertools import Logger
import boto3

logger = Logger()

class GatewayTokenManager:
    """Manages OAuth tokens for AgentCore Gateway with automatic refresh"""
    def __init__(self, client_id, client_secret, token_endpoint, scope):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_endpoint = token_endpoint
        self.scope = scope
        self._token = None
        self._expires_at = None

    async def get_token(self):
        if self._token and self._expires_at > datetime.now():
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

# Configuration from Environment Variables
GATEWAY_URL = os.environ.get("GATEWAY_URL")
CLIENT_ID = os.environ.get("GATEWAY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GATEWAY_CLIENT_SECRET")
TOKEN_ENDPOINT = os.environ.get("GATEWAY_TOKEN_ENDPOINT")
SCOPE = os.environ.get("GATEWAY_SCOPE", "FurnitureGateway/invoke")
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-pro-v1:0")

token_manager = GatewayTokenManager(CLIENT_ID, CLIENT_SECRET, TOKEN_ENDPOINT, SCOPE)

def create_transport(mcp_url: str, access_token: str):
    return streamablehttp_client(mcp_url, headers={"Authorization": f"Bearer {access_token}"})

async def get_tools_and_invoke(prompt):
    """Manage MCP session and agent stream"""
    token = await token_manager.get_token()
    
    # Bedrock Model configuration
    model = BedrockModel(
        inference_profile_id=MODEL_ID,
        streaming=True
    )

    # Use MCPClient context manager to keep the transport alive during interaction
    mcp_client = MCPClient(lambda: create_transport(GATEWAY_URL, token))
    
    with mcp_client:
        tools = mcp_client.list_tools_sync()
        agent = Agent(
            model=model,
            tools=tools,
            callback_handler=None
        )
        
        # We need to exhaust the generator while the context is open
        # or yield from it. yield from is not available for async generators in this way.
        async for event in agent.stream_async(prompt):
            yield event

app = BedrockAgentCoreApp()

@app.entrypoint
async def agent_invocation(payload, context):
    """
    Handler for AgentCore Runtime invocation.
    """
    user_message = payload.get("prompt", "")
    logger.info(f"Processing message: {user_message}")

    async for event in get_tools_and_invoke(user_message):
        yield event

if __name__ == "__main__":
    app.run()
