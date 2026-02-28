from mcp.server.fastmcp import FastMCP
import httpx
import os
import json
import boto3
mcp = FastMCP("StripeBridge", host="0.0.0.0", stateless_http=True)

client = boto3.client('secretsmanager')
def get_secret(secret_name):
    """Retrieve secret from AWS Secrets Manager."""
    
    try:
        response = client.get_secret_value(SecretId=secret_name)
        return response.get('SecretString') or response.get('SecretBinary')
    except Exception:
        return None

STRIPE_SECRET_NAME = os.environ.get("STRIPE_SECRET_NAME", "bedrock-agentcore-identity!default/apikey/StripeDirectKey")
secret_data = get_secret(STRIPE_SECRET_NAME)

STRIPE_KEY = None
if secret_data:
    try:
        # The secret is stored as {"api_key_value":"..."}
        STRIPE_KEY = json.loads(secret_data).get("api_key_value")
    except Exception:
        STRIPE_KEY = secret_data # Fallback if not JSON

@mcp.tool()
async def stripe_rpc(method: str, params: dict = None):
    """Bridge to the official Stripe MCP server for any Stripe operation."""
    if not STRIPE_KEY:
        return {"error": "Stripe API Key not configured"}
        
    async with httpx.AsyncClient() as client:
        resp = await client.post("https://mcp.stripe.com", 
                                headers={"Authorization": f"Bearer {STRIPE_KEY}"},
                                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
        return resp.json()

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
