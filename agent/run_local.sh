#!/bin/bash
export GATEWAY_URL="https://furniture-gateway-5fpqqkvkjv.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp"
export GATEWAY_CLIENT_ID="1r6qjbkj6fpbpj7b4t1so2k8mv"
export GATEWAY_CLIENT_SECRET="1ksv4ngvnc3okkie6srmbj09juumgkpls5969m6kd0n75bgur07g"
export GATEWAY_TOKEN_ENDPOINT="https://furnitureappstack-furnituregateway-36029302.auth.us-east-1.amazoncognito.com/oauth2/token"
export GATEWAY_SCOPE="FurnitureGateway/invoke"
export DYNAMODB_TABLE="furniture-app-table-v2"
export MEMORY_ID="furniture_memory-sZfL9Z9dDD"
export AWS_REGION="us-east-1"
export PORT=8080

echo "Starting Agent Runtime with PID $$"
python3.13 -u agent_runtime.py 2>&1
