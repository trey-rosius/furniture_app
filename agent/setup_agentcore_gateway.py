import boto3
import json
import os

REGION = 'us-east-1'
GATEWAY_ID = 'furnituregateway-iwz7nicp8r'

# 1. Stripe Proxy ARN (AgentCore Runtime)
STRIPE_AGENT_URL = (
    "https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/"
    "arn%3Aaws%3Abedrock-agentcore%3Aus-east-1%3A132260253285%3Aruntime%2Ffurniture_stripe_agent-8htUoh6sPM"
    "/invocations?qualifier=DEFAULT"
)

# 2. OAuth2 Credential Provider ARN
COGNITO_PROVIDER_ARN = 'arn:aws:bedrock-agentcore:us-east-1:132260253285:token-vault/default/oauth2credentialprovider/StripeRuntimeAuth'

# 3. Correct Lambda Tools ARN (Found via CLI)
LAMBDA_ARN = 'arn:aws:lambda:us-east-1:132260253285:function:FurnitureAppStack-AgentCoreToolsLambdaCE3FBE66-Qu6EdW8cAxYd'

# 4. Path to the tools schema
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), 'tools_schema.json')

client = boto3.client('bedrock-agentcore-control', region_name=REGION)

def configure_gateway_stack():
    print(f"--- Configuring AgentCore Gateway: {GATEWAY_ID} ---")

    with open(SCHEMA_PATH, 'r') as f:
        tools = json.load(f)

    # Clean up
    existing = client.list_gateway_targets(gatewayIdentifier=GATEWAY_ID)['items']
    for e in existing:
        if e['name'] in ['FurnitureLambdaTarget', 'StripeMCPTarget']:
            print(f"Deleting old target: {e['name']}...")
            client.delete_gateway_target(gatewayIdentifier=GATEWAY_ID, targetId=e['targetId'])

    # ----- TARGET 1: AWS LAMBDA -----
    print("\nAdding Lambda Target...")
    lambda_response = client.create_gateway_target(
        name='FurnitureLambdaTarget',
        gatewayIdentifier=GATEWAY_ID,
        targetConfiguration={
            'mcp': {
                'lambda': {
                    'lambdaArn': LAMBDA_ARN,
                    'toolSchema': {
                        'inlinePayload': tools
                    }
                }
            }
        },
        credentialProviderConfigurations=[
            {
                'credentialProviderType': 'GATEWAY_IAM_ROLE'
            }
        ]
    )
    print(f"Lambda Target Created: {lambda_response['targetId']}")

    # ----- TARGET 2: STRIPE MCP SERVER -----
    print("\nAdding Stripe MCP Target...")
    mcp_response = client.create_gateway_target(
        name='StripeMCPTarget',
        gatewayIdentifier=GATEWAY_ID,
        targetConfiguration={
            'mcp': {
                'mcpServer': {
                    'endpoint': STRIPE_AGENT_URL
                }
            }
        },
        credentialProviderConfigurations=[
            {
                'credentialProviderType': 'OAUTH',
                'credentialProvider': {
                    'oauthCredentialProvider': {
                        'providerArn': COGNITO_PROVIDER_ARN,
                        'scopes': ['FurnitureGateway/invoke']
                    }
                }
            }
        ]
    )
    print(f"Stripe MCP Target Created: {mcp_response['targetId']}")

if __name__ == "__main__":
    try:
        configure_gateway_stack()
        print("\nSUCCESS: All targets attached to Gateway.")
    except Exception as e:
        print(f"\nERROR: {e}")
