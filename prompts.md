# Rebuilding the Furniture AI Application: A Guide for Agents and Students

This document provides the architectural blueprint and sequential prompts required to recreate the **Furniture AI App**. This application features a React frontend, a CDK-based serverless backend, and advanced Bedrock integration including Durable Lambdas and Vector Search.

---

## 🏗️ Architecture Overview

-   **Frontend**: React + Vite + Tailwind CSS v4 + Framer Motion.
-   **Infrastructure**: AWS CDK (TypeScript).
-   **API**: AWS AppSync (GraphQL) with IAM, API Key, and Cognito auth.
-   **Search & AI**:
    *   **Bedrock Nova Embeddings**: Multi-modal (Image/Text) embeddings (3072 dimensions).
    *   **S3 Vectors**: Vector search indexed directly in S3.
    *   **Durable Lambdas**: Long-running Bedrock operations using the new Lambda Durable Execution feature.
-   **Storage**: S3 (Catalog & Vector buckets) and DynamoDB (Single Table Design).
-   **Orchestration**: AWS Step Functions for catalog ingestion and EventBridge for real-time result streaming.

---

## 📝 Sequential Rebuilding Prompts

### Phase 1: Storage & Identity Foundation
> "Initialize an AWS CDK stack in TypeScript. Create two S3 buckets: 'furniture-app-catalog-v2' (public access for images, CORS enabled) and 'furniture-app-vector-v2' (encrypted with a KMS key via `cdk-s3-vectors`). Define a DynamoDB table with partition key 'PK' and sort key 'SK' (Pay-per-request). Set up a Cognito User Pool with email sign-in and an Identity Pool that allows unauthenticated access for guest visual searches."

### Phase 2: AppSync API & Schema
> "Create an AppSync GraphQL API. Define a schema with types `Product`, `VisualSearchResult`, `UploadUrl`, and `AgentResponse`. Mutations should include `getUploadUrl`, `getPresignedUrl`, `invokeAgent`, `getAgentWebsocketConfig`, `pushSearchResult`, and `triggerCatalogProcessing`. Subscriptions: `onSearchResult` (linked to `pushSearchResult`). Configure multiple auth modes: API Key (default), IAM, and User Pool."

### Phase 3: Durable Vision Search Backend
> "Implement a Python Lambda function using the `Durable` configuration (executionTimeout of 365 days). This function should take an image from S3, invoke `amazon.nova-2-multimodal-embeddings-v1:0` with 3072 dimensions to get a vector, query the `S3Vectors` index, and fetch product details from DynamoDB. Use EventBridge to push results back to AppSync via a 'VisualSearchResult' detail-type in the 'com.furniture.search' source."

### Phase 4: Bedrock AgentCore & Gateway
> "Containerize a Python agent using `public.ecr.aws/docker/library/python:3.12-slim`. Configure it to connect to a Bedrock AgentCore Gateway (provide `GATEWAY_URL` and `GATEWAY_SCOPE`). Implement tools in the agent to query DynamoDB for furniture items and include a system prompt that provides mock Stripe checkout links (e.g., `https://buy.stripe.com/test_...`) as continuous strings."

### Phase 5: Premium Frontend Development
> "Build a React frontend using Vite and Tailwind v4. Use Framer Motion (version 12+) for glassmorphism effects and smooth transitions between Home, Camera (Visual Search), and Chat (AI Voice) pages. Connect to AppSync and S3 using `aws-amplify`. The Visual Search component should upload an image via presigned URL and subscribe to `onSearchResult` for real-time updates."

---

## ⚠️ Critical Gotchas & Troubleshooting

### 1. Tailwind CSS v4 Configuration
Tailwind v4 is CSS-first. Don't look for `tailwind.config.js`; instead, use `@theme` blocks in your `index.css`. Ensure the Vite plugin `@tailwindcss/vite` is installed and registered in `vite.config.ts`.

### 2. Nova Multi-modal Embeddings (3072 dims)
Standard Titan embeddings use 1536 dimensions. Nova requires **3072**. If your `s3vectors.Index` is configured with 1536, your search will return 400 errors.

### 3. Durable Lambda Permissions
Durable Lambdas need explicit permissions for `lambda:CheckpointDurableExecutions` and `lambda:GetDurableExecutionState`. Without these, the function will fail to maintain state during Bedrock's async invocation.

### 4. AgentCore Auth Scopes
When connecting the frontend or runtime to the AgentCore Gateway, ensure the `GATEWAY_SCOPE` (e.g., `FurnitureGateway/invoke`) exactly matches the scope defined in Cognito. An `invalid_scope` error is the most common reason for voice chat failures.

### 5. S3 Circular Dependencies
In CDK, adding S3 notifications to a Lambda that also needs write access to that same bucket often causes circular dependencies. Use `iam.PolicyStatement` with string ARNs instead of bucket objects to break the cycle.

### 6. Framer Motion & React 19
Ensure you are using the latest `motion` package (v12+) if targetting React 19 to avoid peer dependency conflicts during `npm install`.
