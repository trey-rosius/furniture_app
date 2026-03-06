FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app

# Install system dependencies if needed


# Copy entire project (respecting .dockerignore)
COPY . .

# Install dependencies




# Install from requirements file
RUN python -m pip install --no-cache-dir -r requirements.txt

# Set AWS region & required app environment variables
ENV AWS_REGION=us-east-1
ENV AWS_DEFAULT_REGION=us-east-1
ENV GATEWAY_URL="https://furnituregateway-iwz7nicp8r.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp"
ENV GATEWAY_CLIENT_ID="4og267ochobnl2gshd3pgqgkn8"
ENV GATEWAY_CLIENT_SECRET="qsq40c5otvvvap6ripq3a7fgpbgbcm4md1tv68i0c9qmth8gsd6"
ENV GATEWAY_TOKEN_ENDPOINT="https://agentcore-324a1e63.auth.us-east-1.amazoncognito.com/oauth2/token"
ENV GATEWAY_SCOPE="FurnitureGateway/invoke"
ENV DYNAMODB_TABLE="furniture-app-table-v2"
ENV MEMORY_ID="furniture_memory-sZfL9Z9dDD"
ENV PORT=8080


# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1


RUN python -m pip install aws_opentelemetry_distro_genai_beta>=0.1.2


# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

# Use the full module path
CMD ["opentelemetry-instrument", "python", "agent_runtime.py"]
