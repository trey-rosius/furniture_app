from mcp.server.fastmcp import FastMCP
import httpx
import os
import json
import boto3

mcp = FastMCP("StripeProxy", host="0.0.0.0", port=8000, stateless_http=True)
print("Stripe Proxy v12 starting on port 8000...")

REGION = os.environ.get("REGION", os.environ.get("AWS_REGION", "us-east-1"))

def get_secret(secret_name):
    """Retrieve secret from AWS Secrets Manager."""
    client = boto3.client('secretsmanager', region_name=REGION)
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

async def call_upstream(tool_name: str, arguments: dict):
    if not STRIPE_KEY:
        return {"error": "Stripe API Key not configured"}
    
    async with httpx.AsyncClient() as client:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        }
        resp = await client.post("https://mcp.stripe.com", 
                                headers={"Authorization": f"Bearer {STRIPE_KEY}"},
                                json=payload)
        return resp.json()

@mcp.tool()
async def checkout_sessions_create(mode: str, success_url: str, line_items: list, cancel_url: str = None):
    """Create a Stripe Checkout Session to generate a payment link."""
    args = {
        "mode": mode,
        "success_url": success_url,
        "line_items": line_items
    }
    if cancel_url:
        args["cancel_url"] = cancel_url
    return await call_upstream("create_checkout_session", args)

@mcp.tool()
async def payment_links_create(line_items: list):
    """Create a Stripe Payment Link."""
    return await call_upstream("create_payment_link", {"line_items": line_items})

@mcp.tool()
async def stripe_rpc(method: str, params: dict = None):
    """Generic bridge for any other Stripe operation."""
    method_map = {
        "payment_links.create": "create_payment_link",
        "checkout_sessions_create": "create_checkout_session",
    }
    tool_name = method_map.get(method, method)
    return await call_upstream(tool_name, params or {})

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
