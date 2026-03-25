import os
import json
import boto3
import stripe
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("StripeProxy", host="0.0.0.0", port=8000, stateless_http=True)
print("Stripe Proxy v14 (Native + Bridge) starting on port 8000...")

REGION = os.environ.get("AWS_REGION", "us-east-1")

def get_secret(secret_name):
    """Retrieve secret from AWS Secrets Manager."""
    client = boto3.client('secretsmanager', region_name=REGION)
    try:
        response = client.get_secret_value(SecretId=secret_name)
        return response.get('SecretString') or response.get('SecretBinary')
    except Exception as e:
        print(f"Error fetching secret {secret_name}: {e}")
        return None

STRIPE_SECRET_NAME = os.environ.get("STRIPE_SECRET_NAME", "bedrock-agentcore-identity!default/apikey/StripeDirectKey")
secret_data = get_secret(STRIPE_SECRET_NAME)

if secret_data:
    try:
        secret_json = json.loads(secret_data)
        stripe.api_key = secret_json.get("api_key_value") or secret_json.get("STRIPE_API_KEY")
        print("Successfully loaded Stripe API Key from JSON")
    except Exception:
        stripe.api_key = secret_data.strip()
        print("Loaded Stripe API Key as raw string")
else:
    print("WARNING: Stripe API Key not found")

@mcp.tool()
async def create_stripe_payment_link(name: str, amount_cents: str, currency: str = "usd"):
    """Create a persistent Stripe Payment Link (Shorter URL) for a specific product name and price."""
    try:
        print(f"DEBUG: Creating payment link for {name} ({amount_cents} {currency})")
        price = stripe.Price.create(
            unit_amount=int(amount_cents),
            currency=currency,
            product_data={"name": name},
        )
        plink = stripe.PaymentLink.create(line_items=[{"price": price.id, "quantity": 1}])
        return {
            "url": plink.url, 
            "id": plink.id, 
            "summary": f"SUCCESS: Payment link created. The exact URL is: {plink.url}"
        }
    except Exception as e:
        print(f"Error in create_stripe_payment_link: {e}")
        return {"error": str(e)}

@mcp.tool()
async def checkout_sessions_create(mode: str, success_url: str, line_items: list, cancel_url: str = "https://example.com/cancel"):
    """Create a Stripe Checkout Session. Returns a long checkout URL."""
    try:
        print(f"DEBUG: Creating checkout session...")
        # Ensure types are correct for Stripe SDK
        for item in line_items:
            if 'price_data' in item and 'unit_amount' in item['price_data']:
                item['price_data']['unit_amount'] = int(item['price_data']['unit_amount'])
            if 'quantity' in item:
                item['quantity'] = int(item['quantity'])

        params = {
            "mode": mode,
            "success_url": success_url,
            "line_items": line_items,
            "cancel_url": cancel_url,
        }
        session = stripe.checkout.Session.create(**params)
        return {"url": session.url, "id": session.id}
    except Exception as e:
        print(f"Error in checkout_sessions_create: {e}")
        return {"error": str(e)}

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
