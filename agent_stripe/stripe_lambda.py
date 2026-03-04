import os
import json
import boto3
import httpx

def get_secret(secret_name):
    """Retrieve secret from AWS Secrets Manager."""
    region = os.environ.get("AWS_REGION", "us-east-1")
    client = boto3.client('secretsmanager', region_name=region)
    try:
        response = client.get_secret_value(SecretId=secret_name)
        return response.get('SecretString') or response.get('SecretBinary')
    except Exception as e:
        print(f"Error retrieving secret: {e}")
        return None

def handler(event, context):
    """Lambda handler for Stripe Proxy tools."""
    print(f"Received event: {json.dumps(event)}")
    
    # Identify the tool being called if we have multiple
    # For now, we assume it's create_stripe_payment_link or stripe_rpc
    
    stripe_secret_name = os.environ.get("STRIPE_SECRET_NAME")
    if not stripe_secret_name:
        return {"error": "STRIPE_SECRET_NAME not configured"}
        
    secret_data = get_secret(stripe_secret_name)
    if not secret_data:
        return {"error": "Failed to retrieve Stripe API Key"}
        
    try:
        stripe_key = json.loads(secret_data).get("api_key_value")
    except Exception:
        stripe_key = secret_data # Fallback
        
    if not stripe_key:
        return {"error": "Stripe API Key not found in secret"}

    # LOGGING TOOLS FOR DIAGNOSTIC
    try:
        payload_ls = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        with httpx.Client() as client:
            resp_ls = client.post("https://mcp.stripe.com", headers={"Authorization": f"Bearer {stripe_key}"}, json=payload_ls)
            print(f"AVAILABLE TOOLS: {json.dumps(resp_ls.json())}")
    except Exception as e:
        print(f"Error listing tools: {e}")

    # Generic stripe_rpc tool implementation
    if "method" in event:
        method = event.get("method")
        params = event.get("params", {})
        
        # Mapping for common mistakes by agents
        method_map = {
            "payment_links.create": "create_payment_link",
            "paymentLinks.create": "create_payment_link",
            "paymentLinks_create": "create_payment_link",
            "payment_links_create": "create_payment_link",
        }
        tool_name = method_map.get(method, method)
        
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": params
            }
        }
        
        with httpx.Client() as client:
            resp = client.post("https://mcp.stripe.com", 
                             headers={"Authorization": f"Bearer {stripe_key}"},
                             json=payload)
            result = resp.json()
            print(f"Stripe MCP Response (rpc): {json.dumps(result)}")
            return result
    
    # Specific tool implementation for create_stripe_payment_link
    # If the tool name matches we handle it
    product_name = event.get("product_name")
    price_amount = event.get("price_amount")
    currency = event.get("currency", "usd")
    
    if product_name and price_amount:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "create_payment_link",
                "arguments": {
                    "product": product_name, # Try 'product' instead of 'product_name'
                    "price": price_amount,  # Try 'price' instead of 'price_amount'
                    "currency": currency
                }
            }
        }
        with httpx.Client() as client:
            resp = client.post("https://mcp.stripe.com", 
                             headers={"Authorization": f"Bearer {stripe_key}"},
                             json=payload)
            result = resp.json()
            print(f"Stripe MCP Response (direct): {json.dumps(result)}")
            return result

    return {"error": "Method or required parameters not found in event"}
