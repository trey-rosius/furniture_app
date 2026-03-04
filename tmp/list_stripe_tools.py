import os
import json
import httpx
import boto3

def get_secret(secret_name):
    region = "us-east-1"
    client = boto3.client('secretsmanager', region_name=region)
    response = client.get_secret_value(SecretId=secret_name)
    return response.get('SecretString') or response.get('SecretBinary')

stripe_secret_name = "StripeApiKey" # Or whatever it is
secret_data = get_secret(stripe_secret_name)
stripe_key = json.loads(secret_data).get("api_key_value")

payload = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
}

resp = httpx.post("https://mcp.stripe.com", 
                 headers={"Authorization": f"Bearer {stripe_key}"},
                 json=payload)
print(json.dumps(resp.json(), indent=2))
