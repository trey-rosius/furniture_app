---
name: Furniture AI Skill
description: Furniture AI Visual Search & Agentic Platform Replication
---

## Context

This skill enables the replication of a sophisticated "Furniture AI" platform.
The architecture integrates **Visual Multimodal Search** (Nova Nova Multimodal
Embeddings + S3 Vectors), **Durable Orchestration** (AWS Lambda Durable
Executions + Step Functions), and a **Real-time Bidirectional Agent** (Bedrock
AgentCore + Strands + Voice). It supports automated product ingestion,
high-performance vector search, and a voice-enabled conversational assistant
with Stripe payment capabilities.

## Architecture & Components

### 1. Storage & Data Layer

- **S3 Catalog**: Replicated as `Furniture-Catalog-Bucket`. Stores raw and
  processed images.
- **S3 Vector Store**: Powered by `cdk-s3-vectors`. Uses **Nova Multimodal
  Embeddings (3072 dimensions)**.
- **DynamoDB**: `Furniture-Product-Table` (PK/SK) for metadata and product
  details.
- **KMS**: Custom key for S3 bucket and vector index encryption.

### 2. Coordination & API Layer

- **AppSync GraphQL API**:
  - **Schema**: `schema/schema.graphql` (searchProducts, ingestProduct,
    invokeAgent, getAgentWebsocketConfig).
  - **Auth**: `API_KEY` (development) and `IAM`.
- **EventBridge Bus**: `Furniture-App-Bus`.
  - Routes visual search results from Durable Lambdas back to AppSync via
    internal mutations.
  - Bridges Step Functions success events to real-time subscriptions.
- **Step Functions**: `Furniture-Ingestion-Workflow`. Orchestrates the parallel
  processing of images, embedding generation, and vector storage.

### 3. Compute Layer (Lambda Logic)

- **Ingestion Engine**: `process_images.py`. Converts images to vectors using
  Nova and saves to S3 Vectors.
- **Durable Visual Search**: `visual_search_workflow.py`. A durable Lambda that
  handles long-running multimodal embedding requests and vector queries.
- **Agent Runtime**: `agent_runtime.py`. A FastAPI-based `BedrockAgentCoreApp`
  using `strands`. Supports WebSocket-based bidirectional voice (Nova Sonic) and
  RESTful agent invocation.
- **Agent Tools**: `agentcore_tools.py`. MCP-compatible tools for search,
  product info, and mock orders.

### 4. AgentCore & MCP Integration

- **Gateways**:
  - **Bedrock AgentCore Gateway**: For managing tool sets (e.g., search, shop).
  - **Stripe MCP Gateway**: External integration for payment link generation.
- **Runtime**: `agent-runtime` deployment for serverless agent execution.

## Technical Constraints & Standards

- **Tooling**: AWS CDK (TypeScript), Python 3.13 for Lambdas.
- **Dependencies**:
  - `cdk-s3-vectors` (for infrastructure).
  - `strands`, `bedrock-agentcore`, `httpx`, `mangum` (for Python environment).
- **Naming**: All resources must be prefixed with `Furniture-`.
- **Environment**: Ensure `TEXT_MODEL_ID` (Nova Lite) and `VOICE_MODEL_ID` (Nova
  Sonic) are correctly set.
- **URL Formatting**: Ensure the agent's system prompt strictly forbids adding
  spaces in URLs (especially after `test_` in Stripe links) to avoid hydration
  or AccessDenied errors.

## Step-by-Step Implementation Guide for Antigravity

1.  **Project Initialization**:
    - Initialize a new CDK project.
    - Install `cdk-s3-vectors` and `@aws-cdk/aws-lambda-python-alpha`.
    - Copy the `schema.graphql` to the `schema/` directory.

2.  **Infrastructure Provisioning**:
    - Build the `FurnitureAppStack` with S3 Buckets, DynamoDB, and the S3 Vector
      Index (Dimension: 3072).
    - Setup the AppSync API and EventBridge Bus.
    - Configure the SQS-based trigger for S3 catalog notifications.

3.  **Lambda & Logic Assets**:
    - Deploy `process_images.py` as a Python Lambda for ingestion.
    - Deploy `visual_search_workflow.py` with `durableConfig` enabled.
    - Deploy `agent_runtime.py` as the core agent handler.

4.  **AgentCore Setup**:
    - Use the `.bedrock_agentcore.yaml` configuration to define the agent.
    - Execute `agentcore gateway create-mcp-gateway` for tool integration.
    - Verify Stripe MCP connectivity.

5.  **Workflow Deployment**:
    - Deploy the Step Functions workflow using
      `furniture_app_workflow.asl.json`.
    - Ensure Substitutions for Lambda ARNs and Bucket names are correct.

6.  **Frontend Sync**:
    - Point the React/Flutter application to the new AppSync endpoint.
    - Update `amplify-config.ts` with relevant ARNs and URLs.

7.  **Verification**:
    - Run an ingestion test by uploading an image to the catalog bucket.
    - Verify vector indexing in S3 Vectors.
    - Test the Agent Voice Chat using the generated WebSocket URL.
