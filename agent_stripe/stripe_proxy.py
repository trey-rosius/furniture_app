from mcp.server.fastmcp import FastMCP
from mcp import ClientSession
from mcp.client.sse import sse_client
import os
import json
import boto3
import uvicorn

mcp = FastMCP("StripeProxy", host="0.0.0.0", port=8000, stateless_http=True)
print("Stripe Proxy v11 starting with FastMCP Streamable-HTTP...")

REGION = os.environ.get("REGION", os.environ.get("AWS_REGION", "us-east-1"))
STRIPE_SECRET_NAME = os.environ.get("STRIPE_SECRET_NAME", "bedrock-agentcore-identity!default/apikey/StripeDirectKey")

_stripe_key = None

def get_stripe_key():
    global _stripe_key
    if _stripe_key is not None:
        return _stripe_key
    
    client = boto3.client('secretsmanager', region_name=REGION)
    try:
        response = client.get_secret_value(SecretId=STRIPE_SECRET_NAME)
        data = response.get('SecretString') or response.get('SecretBinary')
        if data:
            try:
                _stripe_key = json.loads(data).get("api_key_value")
            except Exception:
                _stripe_key = data # Fallback
        return _stripe_key
    except Exception as e:
        print(f"Error retrieving secret: {e}")
        return None

@mcp.tool()
async def stripe_rpc(tool_name: str, params: dict = None):
    """Bridge to the official Stripe MCP server for any Stripe operation."""
    key = get_stripe_key()
    if not key:
        return {"error": "Stripe API Key not configured"}
        
    headers = {"Authorization": f"Bearer {key}"}
    
    try:
        # Establish the SSE connection to Stripe
        async with sse_client(url="https://mcp.stripe.com/sse", headers=headers) as streams:
            async with ClientSession(*streams) as session:
                # Initialize the MCP protocol handshake
                await session.initialize()
                
                # Execute the tool natively on Stripe's side
                result = await session.call_tool(tool_name, params or {})
                
                # Parse the standard MCP CallToolResult object back to a serializable dictionary
                content_list = []
                for item in result.content:
                    if item.type == "text":
                        content_list.append(json.loads(item.text) if item.text.startswith("{") else item.text)
                
                return {"result": content_list}
                
    except Exception as e:
        return {"error": f"Stripe MCP session failed: {str(e)}"}

@mcp.tool()
async def list_stripe_tools():
    """Returns the exact, up-to-date list of tools defined by the upstream Stripe MCP server."""
    key = get_stripe_key()
    if not key:
        return {"error": "Stripe API Key not configured"}
        
    headers = {"Authorization": f"Bearer {key}"}
    
    try:
        async with sse_client(url="https://mcp.stripe.com/sse", headers=headers) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                
                # Ask Stripe what tools it currently supports
                tools = await session.list_tools()
                
                # Return the names and descriptions to your AgentCore orchestrator
                return [{"name": t.name, "description": t.description} for t in tools.tools]
                
    except Exception as e:
        return {"error": f"Failed to list Stripe tools: {str(e)}"}

if __name__ == "__main__":
    # Use streamable-http for compatibility with Bedrock AgentCore
    mcp.run(transport="streamable-http")