"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FurnitureAppStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const appsync = require("aws-cdk-lib/aws-appsync");
const events = require("aws-cdk-lib/aws-events");
const lambda = require("aws-cdk-lib/aws-lambda");
const sfn = require("aws-cdk-lib/aws-stepfunctions");
const targets = require("aws-cdk-lib/aws-events-targets");
// No aliased target needed if we use targets.AppSync directly
const s3n = require("aws-cdk-lib/aws-s3-notifications");
const kms = require("aws-cdk-lib/aws-kms");
const iam = require("aws-cdk-lib/aws-iam");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const aws_lambda_python_alpha_1 = require("@aws-cdk/aws-lambda-python-alpha");
const s3Vectors = require("cdk-s3-vectors");
const sqs = require("aws-cdk-lib/aws-sqs");
const lambdaEventSources = require("aws-cdk-lib/aws-lambda-event-sources");
const cognito = require("aws-cdk-lib/aws-cognito");
const path = require("path");
const fs = require("fs");
const agentcore = require("@aws-cdk/aws-bedrock-agentcore-alpha");
class FurnitureAppStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // 1. Encryption and S3 Buckets
        const encryptionKey = new kms.Key(this, "VectorBucketKey", {
            description: "KMS key for S3 vector bucket encryption",
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const catalogBucket = new s3.Bucket(this, "FurnitureCatalogBucket", {
            bucketName: "furniture-app-catalog-v2",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.POST,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.HEAD,
                        s3.HttpMethods.DELETE,
                    ],
                    allowedOrigins: ["*"], // In production, restrict to your domain
                    allowedHeaders: ["*"],
                    exposedHeaders: [
                        "ETag",
                        "x-amz-server-side-encryption",
                        "x-amz-request-id",
                        "x-amz-id-2",
                    ],
                },
            ],
        });
        const vectorBucket = new s3Vectors.Bucket(this, "FurnitureVectorBucket", {
            vectorBucketName: "furniture-app-vector-v2",
            encryptionConfiguration: {
                sseType: "aws:kms",
                kmsKey: encryptionKey,
            },
        });
        const vectorIndex = new s3Vectors.Index(this, "FurnitureVectorIndex", {
            vectorBucketName: vectorBucket.vectorBucketName,
            indexName: "furniture-app-index",
            dataType: "float32",
            dimension: 3072, // Using 3072 for Nova Multimodal Embeddings
            distanceMetric: "cosine",
        });
        // 2. DynamoDB Table
        const productTable = new dynamodb.Table(this, "FurnitureProductTable", {
            tableName: "furniture-app-table-v2",
            partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // 3. EventBridge Bus
        const eventBus = new events.EventBus(this, "FurnitureAppEventBus", {
            eventBusName: "FurnitureAppBus",
        });
        // 4.5. Auth - Cognito for Amplify
        const userPool = new cognito.UserPool(this, "FurnitureUserPool", {
            userPoolName: "furniture-app-user-pool",
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const userPoolClient = new cognito.UserPoolClient(this, "FurnitureUserPoolClient", {
            userPool: userPool,
            generateSecret: false,
        });
        // 3.5. Secrets Manager for Stripe
        const stripeApiKey = secretsmanager.Secret.fromSecretNameV2(this, "StripeApiKey", "bedrock-agentcore-identity!default/apikey/StripeDirectKey");
        // 4. AppSync API
        const api = new appsync.GraphqlApi(this, "FurnitureGraphqlApi", {
            name: "FurnitureApi",
            definition: appsync.Definition.fromFile(path.join(__dirname, "../schema/schema.graphql")),
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: appsync.AuthorizationType.API_KEY,
                },
                additionalAuthorizationModes: [
                    {
                        authorizationType: appsync.AuthorizationType.IAM,
                    },
                    {
                        authorizationType: appsync.AuthorizationType.USER_POOL,
                        userPoolConfig: {
                            userPool: userPool,
                        },
                    },
                ],
            },
            logConfig: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
            },
        });
        const identityPool = new cognito.CfnIdentityPool(this, "FurnitureIdentityPool", {
            identityPoolName: "furniture-app-identity-pool",
            allowUnauthenticatedIdentities: true, // Allow guest visual searches
            cognitoIdentityProviders: [
                {
                    clientId: userPoolClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                },
            ],
        });
        // IAM Roles for Identity Pool
        const unauthRole = new iam.Role(this, "CognitoUnauthRole", {
            assumedBy: new iam.FederatedPrincipal("cognito-identity.amazonaws.com", {
                StringEquals: {
                    "cognito-identity.amazonaws.com:aud": identityPool.ref,
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "unauthenticated",
                },
            }, "sts:AssumeRoleWithWebIdentity"),
        });
        const authRole = new iam.Role(this, "CognitoAuthRole", {
            assumedBy: new iam.FederatedPrincipal("cognito-identity.amazonaws.com", {
                StringEquals: {
                    "cognito-identity.amazonaws.com:aud": identityPool.ref,
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "authenticated",
                },
            }, "sts:AssumeRoleWithWebIdentity"),
        });
        new cognito.CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoleAttachment", {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: authRole.roleArn,
                unauthenticated: unauthRole.roleArn,
            },
        });
        // Grant S3 access to Cognito Roles for "visuals" folder
        const s3Policy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
            resources: [
                catalogBucket.bucketArn,
                `${catalogBucket.bucketArn}/visuals/*`,
                `${catalogBucket.bucketArn}/public/visuals/*`, // Amplify default prefix
            ],
        });
        authRole.addToPolicy(s3Policy);
        unauthRole.addToPolicy(s3Policy);
        // Also grant IAM access to AppSync for these roles
        api.grantQuery(authRole);
        api.grantMutation(authRole);
        api.grantQuery(unauthRole);
        api.grantMutation(unauthRole);
        // 5. Lambda Functions
        const pythonRuntime = lambda.Runtime.PYTHON_3_13;
        // a. Presigned URL Lambda
        const getUploadUrlLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "GetUploadUrlLambda", {
            entry: path.join(__dirname, "../lambda"),
            index: "get_upload_url_lambda.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
            environment: {
                BUCKET_NAME: catalogBucket.bucketName,
            },
        });
        catalogBucket.grantWrite(getUploadUrlLambda);
        const getPresignedUrlLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "GetPresignedUrlLambda", {
            entry: path.join(__dirname, "../lambda"),
            index: "get_presigned_url_lambda.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
            environment: {
                BUCKET_NAME: catalogBucket.bucketName,
            },
        });
        catalogBucket.grantRead(getPresignedUrlLambda);
        // Grant read access to the vector bucket if needed (though results usually come from catalog)
        getPresignedUrlLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3:GetObject"],
            resources: [`arn:aws:s3:::${vectorBucket.vectorBucketName}/*`],
        }));
        // b. Catalog Trigger Lambda (Starts Step Functions)
        const catalogTriggerLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "CatalogTriggerLambda", {
            entry: path.join(__dirname, "../lambda"),
            index: "catalog_trigger_lambda.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
        });
        // c. Visual Search Trigger Lambda (Nova -> Vector -> EventBridge)
        const visualSearchTriggerLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "VisualSearchTriggerLambda", {
            entry: path.join(__dirname, "../lambda"),
            index: "visual_search_trigger_lambda.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
            environment: {
                GRAPHQL_API_URL: api.graphqlUrl,
                EVENT_BUS_NAME: eventBus.eventBusName,
                VECTOR_BUCKET: vectorBucket.vectorBucketName,
                VECTOR_INDEX: vectorIndex.indexName,
                DYNAMODB_TABLE: productTable.tableName,
            },
            timeout: cdk.Duration.seconds(30),
        });
        productTable.grantReadData(visualSearchTriggerLambda);
        visualSearchTriggerLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:ListBucket"],
            resources: [
                `arn:aws:s3:::${catalogBucket.bucketName}`,
                `arn:aws:s3:::${catalogBucket.bucketName}/*`,
                `arn:aws:s3:::${vectorBucket.vectorBucketName}`,
                `arn:aws:s3:::${vectorBucket.vectorBucketName}/*`,
            ],
        }));
        api.grantMutation(visualSearchTriggerLambda);
        eventBus.grantPutEventsTo(visualSearchTriggerLambda);
        visualSearchTriggerLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["bedrock:InvokeModel"],
            resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-2-multimodal-embeddings-v1:0`,
            ],
        }));
        // d. Batch Get Item Lambda (Used by Search Workflow)
        const batchGetItemLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "BatchGetItemLambda", {
            entry: path.join(__dirname, "../lambda"),
            index: "batch_get_item_lambda.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
            environment: {
                DYNAMODB_TABLE: productTable.tableName,
            },
        });
        productTable.grantReadData(batchGetItemLambda);
        // e. Durable Visual Search Workflow Lambda
        const visualSearchWorkflow = new aws_lambda_python_alpha_1.PythonFunction(this, "VisualSearchWorkflow", {
            functionName: "furniture-visual-search-workflow",
            entry: path.join(__dirname, "../lambda"),
            index: "visual_search_workflow.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
            reservedConcurrentExecutions: 50,
            environment: {
                EVENT_BUS_NAME: eventBus.eventBusName,
                VECTOR_BUCKET: vectorBucket.vectorBucketName,
                VECTOR_INDEX: vectorIndex.indexName,
                BATCH_GET_ITEM_LAMBDA: batchGetItemLambda.functionName,
            },
            timeout: cdk.Duration.minutes(5),
            // @ts-ignore - durableConfig is a newer feature/alpha
            durableConfig: {
                executionTimeout: cdk.Duration.days(365),
                retentionPeriod: cdk.Duration.days(7),
            },
        });
        visualSearchWorkflow.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "lambda:CheckpointDurableExecutions",
                "lambda:GetDurableExecutionState",
                "lambda:SendDurableExecutionCallbackSuccess",
                "lambda:SendDurableExecutionCallbackFailure",
            ],
            resources: ["*"],
        }));
        const version = visualSearchWorkflow.currentVersion;
        const alias = new lambda.Alias(this, "ProdAlias", {
            aliasName: "dev",
            version: version,
        });
        batchGetItemLambda.grantInvoke(visualSearchWorkflow);
        visualSearchWorkflow.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "bedrock:InvokeModel",
                "bedrock:StartAsyncInvoke",
                "bedrock:GetAsyncInvoke",
            ],
            resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-2-multimodal-embeddings-v1:0`,
                `arn:aws:bedrock:${this.region}:${this.account}:async-invoke/*`,
            ],
        }));
        visualSearchWorkflow.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3vectors:QueryVectors", "s3vectors:GetVectors"],
            resources: [
                `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucket.vectorBucketName}/index/${vectorIndex.indexName}`,
            ],
        }));
        visualSearchWorkflow.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
            resources: [
                `arn:aws:s3:::${catalogBucket.bucketName}`,
                `arn:aws:s3:::${catalogBucket.bucketName}/*`,
                `arn:aws:s3:::${vectorBucket.vectorBucketName}`,
                `arn:aws:s3:::${vectorBucket.vectorBucketName}/*`,
            ],
        }));
        encryptionKey.grantDecrypt(visualSearchWorkflow);
        productTable.grantReadData(visualSearchWorkflow);
        eventBus.grantPutEventsTo(visualSearchWorkflow);
        // Update Visual Search Trigger to use the Durable Workflow
        visualSearchTriggerLambda.addEnvironment("DURABLE_FUNCTION_ARN", `${visualSearchWorkflow.functionArn}:${alias.aliasName}`);
        visualSearchTriggerLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [`${visualSearchWorkflow.functionArn}:${alias.aliasName}`],
        }));
        // f. Process Images Lambda (Called by Step Functions)
        const processImagesLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "ProcessImagesLambda", {
            functionName: "furniture-process-images",
            entry: path.join(__dirname, "../lambda"),
            index: "process_images.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
            environment: {
                SOURCE_BUCKET: catalogBucket.bucketName,
                VECTOR_BUCKET: vectorBucket.vectorBucketName,
                VECTOR_INDEX: vectorIndex.indexName,
                DYNAMODB_TABLE: productTable.tableName,
            },
        });
        // Break circular dependency
        processImagesLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "s3:GetObject",
                "s3:PutObject",
                "s3:ListBucket",
                "kms:GenerateDataKey",
                "kms:Decrypt",
            ],
            resources: [
                "arn:aws:s3:::furniture-app-catalog-v2",
                "arn:aws:s3:::furniture-app-catalog-v2/*",
                `arn:aws:s3:::${vectorBucket.vectorBucketName}`,
                `arn:aws:s3:::${vectorBucket.vectorBucketName}/*`,
            ],
        }));
        productTable.grantReadWriteData(processImagesLambda);
        processImagesLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3vectors:PutVectors"],
            resources: [
                `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucket.vectorBucketName}/index/${vectorIndex.indexName}`,
            ],
        }));
        encryptionKey.grantEncryptDecrypt(processImagesLambda);
        const stateMachine = new sfn.StateMachine(this, "FurnitureAppWorkflow", {
            stateMachineName: "furniture-app-workflow-v2",
            definitionBody: sfn.DefinitionBody.fromFile(path.join(__dirname, "../workflow/furniture_app_workflow.asl.json")),
            definitionSubstitutions: {
                BUCKET_NAME: catalogBucket.bucketName,
                FUNCTION_ARN: `arn:aws:lambda:${this.region}:${this.account}:function:furniture-process-images`,
            },
        });
        processImagesLambda.grantInvoke(stateMachine);
        // Break circular dependency by using string ARNs
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
            resources: [
                `arn:aws:s3:::${catalogBucket.bucketName}`,
                `arn:aws:s3:::${catalogBucket.bucketName}/*`,
            ],
        }));
        stateMachine.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "bedrock:InvokeModel",
                "bedrock:StartAsyncInvoke",
                "bedrock:GetAsyncInvoke",
            ],
            resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-2-multimodal-embeddings-v1:0`,
                `arn:aws:bedrock:${this.region}:${this.account}:async-invoke/*`,
            ],
        }));
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "states:StartExecution",
                "states:DescribeExecution",
                "states:StopExecution",
            ],
            resources: [
                `arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2`,
                `arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2:*`,
            ],
        }));
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "states:DescribeMapRun",
                "states:ListMapRuns",
                "states:UpdateMapRun",
            ],
            resources: [
                `arn:aws:states:${this.region}:${this.account}:mapRun:furniture-app-workflow-v2/*`,
            ],
        }));
        catalogTriggerLambda.addEnvironment("STATE_MACHINE_ARN", `arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2`);
        catalogTriggerLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["states:StartExecution"],
            resources: [
                `arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2`,
            ],
        }));
        new cdk.CfnOutput(this, "StateMachineArn", {
            value: stateMachine.stateMachineArn,
        });
        // 7. Direct EventBridge to AppSync Bridge
        const appSyncEventBridgeRole = new iam.Role(this, "AppSyncEventBridgeRole", {
            assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
            description: "Role for EventBridge to invoke AppSync mutations",
        });
        appSyncEventBridgeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["appsync:GraphQL"],
            resources: [`${api.arn}/types/Mutation/*`],
        }));
        const resultRule = new events.Rule(this, "VisualSearchResultRule", {
            eventBus: eventBus,
            eventPattern: {
                source: ["com.furniture.search"],
                detailType: ["VisualSearchResult"],
            },
        });
        resultRule.addTarget(new targets.AppSync(api, {
            graphQLOperation: `
        mutation PushSearchResult($status: String!, $message: String, $results: [ProductInput!]) {
          pushSearchResult(status: $status, message: $message, results: $results) {
            status
            message
            results {
              PK
              SK
              productName
              imageFile
              price
              category
              subCategory
              level
              image_uri
            }
          }
        }
      `,
            variables: events.RuleTargetInput.fromObject({
                status: events.EventField.fromPath("$.detail.status"),
                message: events.EventField.fromPath("$.detail.message"),
                results: events.EventField.fromPath("$.detail.results"),
            }),
            eventRole: appSyncEventBridgeRole,
        }));
        new cdk.aws_logs.LogGroup(this, "FurnitureAppBusLogs", {
            logGroupName: `/aws/events/${eventBus.eventBusName}/logs`,
            retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Visual Search SQS Queue & DLQ
        const visualSearchDlq = new sqs.Queue(this, "VisualSearchDLQ", {
            retentionPeriod: cdk.Duration.days(14),
        });
        const visualSearchQueue = new sqs.Queue(this, "VisualSearchQueue", {
            visibilityTimeout: cdk.Duration.seconds(300), // higher than lambda timeout of 30s
            deadLetterQueue: {
                queue: visualSearchDlq,
                maxReceiveCount: 3, // 3 retries before DLQ
            },
        });
        catalogBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(visualSearchQueue), { prefix: "visuals/" });
        // Support Amplify's default 'public/' prefix
        catalogBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(visualSearchQueue), { prefix: "public/visuals/" });
        visualSearchTriggerLambda.addEventSource(new lambdaEventSources.SqsEventSource(visualSearchQueue, {
            batchSize: 10,
            maxConcurrency: 5,
        }));
        // e. Agent Runtime Lambda (Strands + AgentCore)
        const agentRuntimeLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "AgentRuntimeLambda", {
            entry: path.join(__dirname, "../agent"),
            index: "agent_runtime.py",
            handler: "app",
            runtime: pythonRuntime,
            environment: {
                DYNAMODB_TABLE: productTable.tableName,
            },
            timeout: cdk.Duration.minutes(5),
            memorySize: 1024,
        });
        productTable.grantReadWriteData(agentRuntimeLambda);
        agentRuntimeLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
            ],
            resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
        }));
        // f. AgentCore Tools Lambda
        const agentCoreToolsLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "AgentCoreToolsLambda", {
            entry: path.join(__dirname, "../agent"),
            index: "agentcore_tools.py",
            handler: "lambda_handler",
            runtime: pythonRuntime,
            environment: {
                DYNAMODB_TABLE: productTable.tableName,
                STRIPE_SECRET_NAME: stripeApiKey.secretName,
            },
            timeout: cdk.Duration.minutes(1),
        });
        stripeApiKey.grantRead(agentCoreToolsLambda);
        productTable.grantReadData(agentCoreToolsLambda);
        // Note: create_order is mocked, but we might eventually need write access
        productTable.grantReadWriteData(agentCoreToolsLambda);
        // g. AppSync Agent Resolver Lambda
        const appsyncAgentResolverLambda = new aws_lambda_python_alpha_1.PythonFunction(this, "AppsyncAgentResolverLambda", {
            entry: path.join(__dirname, "../agent"),
            index: "appsync_agent_resolver.py",
            handler: "handler",
            runtime: pythonRuntime,
            environment: {
                AGENT_RUNTIME_ID: "placeholder", // Will be replaced by agentRuntime.runtimeId
            },
            timeout: cdk.Duration.minutes(1),
        });
        // 9. Bedrock AgentCore Constructs
        // a. Memory
        const memory = new agentcore.Memory(this, "FurnitureMemory", {
            memoryName: "furniture_memory",
            description: "Memory for furniture assistant",
            expirationDuration: cdk.Duration.days(90),
            memoryStrategies: [
                agentcore.MemoryStrategy.usingBuiltInSummarization(),
                agentcore.MemoryStrategy.usingBuiltInSemantic(),
                agentcore.MemoryStrategy.usingBuiltInUserPreference(),
            ],
        });
        // b. Gateway
        const gateway = new agentcore.Gateway(this, "FurnitureGateway", {
            gatewayName: "furniture-gateway",
            description: "Gateway for furniture assistant tools",
        });
        // c. Gateway Target (Lambda for tools)
        const toolSchemaPath = path.join(__dirname, "../agent/tools_schema.json");
        let toolSchemaJson = {};
        if (fs.existsSync(toolSchemaPath)) {
            toolSchemaJson = JSON.parse(fs.readFileSync(toolSchemaPath, "utf8"));
        }
        gateway.addLambdaTarget("FurnitureToolsTargetV2", {
            gatewayTargetName: "furniture-tools",
            description: "Target for furniture catalog and ordering tools",
            lambdaFunction: agentCoreToolsLambda,
            toolSchema: agentcore.ToolSchema.fromInline(toolSchemaJson),
        });
        const stripeAuthDiscoveryUrl = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SvpNsXJod/.well-known/openid-configuration";
        const stripeAuthClientId = "4og267ochobnl2gshd3pgqgkn8";
        // e. Stripe Runtime
        const stripeRuntime = new agentcore.Runtime(this, "StripeRuntimeV11", {
            runtimeName: "furniture_stripe_proxy_v11",
            agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(path.join(__dirname, "../agent_stripe")),
            description: "Stripe Proxy Runtime based on FastMCP",
            environmentVariables: {
                STRIPE_SECRET_NAME: stripeApiKey.secretName,
                REGION: this.region,
            },
            protocolConfiguration: agentcore.ProtocolType.MCP,
            authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingOAuth(stripeAuthDiscoveryUrl, stripeAuthClientId, undefined, // No specific audience override
            ["mcp-runtime-server/invoke"]),
        });
        stripeApiKey.grantRead(stripeRuntime.role);
        // OAuth2 authentication ARNs discovered from environment
        const oauthProviderArn = "arn:aws:bedrock-agentcore:us-east-1:132260253285:token-vault/default/oauth2credentialprovider/StripeRuntimeAuth";
        const oauthSecretArn = "arn:aws:secretsmanager:us-east-1:132260253285:secret:bedrock-agentcore-identity!default/oauth2/StripeRuntimeAuth-dKJCCA";
        // Add an MCP server target directly to the gateway pointing to the Runtime
        const stripeMcpTarget = gateway.addMcpServerTarget("StripeMcpTargetV20", {
            gatewayTargetName: "stripe-proxy-v20",
            description: "Runtime-based Stripe tool integration",
            endpoint: `https://${stripeRuntime.agentRuntimeId}.runtime.bedrock-agentcore.${this.region}.amazonaws.com/mcp`,
            credentialProviderConfigurations: [
                agentcore.GatewayCredentialProvider.fromOauthIdentityArn({
                    providerArn: oauthProviderArn,
                    secretArn: oauthSecretArn,
                    scopes: ["mcp-runtime-server/invoke"],
                }),
            ],
        });
        // CRITICAL: Grant Gateway permission to invoke the Runtime
        stripeRuntime.grantInvoke(gateway.role);
        // --- ADDED: Sync Function ---
        const syncFunction = new lambda.Function(this, "SyncFunction", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "index.handler",
            code: lambda.Code.fromInline(`
import boto3
import json

def handler(event, context):
    client = boto3.client('bedrock-agentcore-control')
    response = client.synchronize_gateway_targets(
        gatewayIdentifier=event['gatewayId'],
        targetIds=event['targetIds']
    )
    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Sync initiated', 'response': str(response)})
    }
      `),
        });
        stripeMcpTarget.grantSync(syncFunction);
        // d. Runtime
        const agentRuntime = new agentcore.Runtime(this, "FurnitureRuntime", {
            runtimeName: "furniture_runtime",
            agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(path.join(__dirname, "../agent")),
            description: "Runtime for furniture assistant agent",
            environmentVariables: {
                DYNAMODB_TABLE: productTable.tableName,
                GATEWAY_ID: gateway.gatewayId,
                GATEWAY_URL: `https://${gateway.gatewayId}.gateway.bedrock-agentcore.${this.region}.amazonaws.com/mcp`,
                GATEWAY_CLIENT_ID: gateway.userPoolClient.userPoolClientId,
                GATEWAY_CLIENT_SECRET: gateway.userPoolClient.userPoolClientSecret.unsafeUnwrap(),
                GATEWAY_TOKEN_ENDPOINT: gateway.tokenEndpointUrl,
                GATEWAY_SCOPE: `${gateway.node.id}/invoke`,
                REGION: this.region,
                STRIPE_SECRET_NAME: stripeApiKey.secretName,
                MEMORY_ID: memory.memoryId,
            },
        });
        // Update the placeholder for AGENT_RUNTIME_ARN in resolver
        appsyncAgentResolverLambda.addEnvironment("AGENT_RUNTIME_ARN", agentRuntime.agentRuntimeArn);
        // Grant permissions to the runtime role
        const runtimeRole = agentRuntime.role;
        productTable.grantReadWriteData(runtimeRole);
        stripeApiKey.grantRead(runtimeRole);
        // Bedrock access for the runtime role
        runtimeRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
            ],
            resources: ["*"],
        }));
        // Permission for Runtime to use Gateway
        gateway.grantInvoke(runtimeRole);
        // Grant AppSync resolver permission to invoke the specific runtime
        agentRuntime.grantInvoke(appsyncAgentResolverLambda);
        // Permissions for the AppSync resolver to interact with AgentCore runtime
        appsyncAgentResolverLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                "bedrock-agentcore:InvokeAgentRuntime",
                "bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream",
                "bedrock-agentcore:GetAgentRuntime",
                "bedrock-agentcore:ListAgentRuntimes",
                "bedrock-agentcore:GetAgentRuntimeEndpoint",
                "bedrock-agentcore:GetAgentRuntimeVersion",
            ],
            resources: ["*"],
        }));
        // 10. AppSync Resolvers
        const getUploadUrlDS = api.addLambdaDataSource("GetUploadUrlDS", getUploadUrlLambda);
        getUploadUrlDS.createResolver("GetUploadUrlResolver", {
            typeName: "Mutation",
            fieldName: "getUploadUrl",
        });
        const getPresignedUrlDS = api.addLambdaDataSource("GetPresignedUrlDS", getPresignedUrlLambda);
        getPresignedUrlDS.createResolver("GetPresignedUrlResolver", {
            typeName: "Mutation",
            fieldName: "getPresignedUrl",
        });
        const triggerCatalogDS = api.addLambdaDataSource("TriggerCatalogDS", catalogTriggerLambda);
        triggerCatalogDS.createResolver("TriggerCatalogResolver", {
            typeName: "Mutation",
            fieldName: "triggerCatalogProcessing",
        });
        const noneDS = api.addNoneDataSource("NoneDS");
        api.createResolver("PushSearchResultResolver", {
            typeName: "Mutation",
            fieldName: "pushSearchResult",
            runtime: appsync.FunctionRuntime.JS_1_0_0,
            dataSource: noneDS,
            code: appsync.Code.fromAsset(path.join(__dirname, "../resolvers/pushSearchResult.js")),
        });
        const agentDS = api.addLambdaDataSource("agentDS", appsyncAgentResolverLambda);
        api.createResolver("invokeAgentResolver", {
            typeName: "Mutation",
            fieldName: "invokeAgent",
            dataSource: agentDS,
        });
        api.createResolver("getAgentWebsocketConfigResolver", {
            typeName: "Mutation",
            fieldName: "getAgentWebsocketConfig",
            dataSource: agentDS,
        });
        // Output values
        new cdk.CfnOutput(this, "GraphQLAPIURL", { value: api.graphqlUrl });
        new cdk.CfnOutput(this, "GraphQLAPIKey", { value: api.apiKey || "" });
        new cdk.CfnOutput(this, "CatalogBucketName", {
            value: catalogBucket.bucketName,
        });
        new cdk.CfnOutput(this, "AgentRuntimeLambdaArn", {
            value: agentRuntimeLambda.functionArn,
        });
        new cdk.CfnOutput(this, "AgentCoreToolsLambdaArn", {
            value: agentCoreToolsLambda.functionArn,
        });
        new cdk.CfnOutput(this, "AgentRuntimeId", {
            value: agentRuntime.agentRuntimeId,
        });
        new cdk.CfnOutput(this, "AgentRuntimeArn", {
            value: agentRuntime.agentRuntimeArn,
        });
        new cdk.CfnOutput(this, "GatewayId", {
            value: gateway.gatewayId,
        });
        new cdk.CfnOutput(this, "MemoryId", {
            value: memory.memoryId,
        });
        new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
        new cdk.CfnOutput(this, "UserPoolClientId", {
            value: userPoolClient.userPoolClientId,
        });
        new cdk.CfnOutput(this, "IdentityPoolId", { value: identityPool.ref });
        new cdk.CfnOutput(this, "Region", { value: this.region });
    }
}
exports.FurnitureAppStack = FurnitureAppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnVybml0dXJlLWFwcC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImZ1cm5pdHVyZS1hcHAtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLHlDQUF5QztBQUN6QyxxREFBcUQ7QUFDckQsbURBQW1EO0FBQ25ELGlEQUFpRDtBQUNqRCxpREFBaUQ7QUFDakQscURBQXFEO0FBQ3JELDBEQUEwRDtBQUUxRCw4REFBOEQ7QUFDOUQsd0RBQXdEO0FBQ3hELDJDQUEyQztBQUMzQywyQ0FBMkM7QUFDM0MsaUVBQWlFO0FBRWpFLDhFQUFrRTtBQUNsRSw0Q0FBNEM7QUFDNUMsMkNBQTJDO0FBQzNDLDJFQUEyRTtBQUMzRSxtREFBbUQ7QUFFbkQsNkJBQTZCO0FBQzdCLHlCQUF5QjtBQUN6QixrRUFBa0U7QUFFbEUsTUFBYSxpQkFBa0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUM5QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLCtCQUErQjtRQUMvQixNQUFNLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3pELFdBQVcsRUFBRSx5Q0FBeUM7WUFDdEQsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILE1BQU0sYUFBYSxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDbEUsVUFBVSxFQUFFLDBCQUEwQjtZQUN0QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxV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bGliXCI7XG5pbXBvcnQgKiBhcyBzMyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgKiBhcyBhcHBzeW5jIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBwc3luY1wiO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCAqIGFzIHNmbiBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnNcIjtcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0c1wiO1xuXG4vLyBObyBhbGlhc2VkIHRhcmdldCBuZWVkZWQgaWYgd2UgdXNlIHRhcmdldHMuQXBwU3luYyBkaXJlY3RseVxuaW1wb3J0ICogYXMgczNuIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczMtbm90aWZpY2F0aW9uc1wiO1xuaW1wb3J0ICogYXMga21zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mta21zXCI7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXJcIjtcbmltcG9ydCAqIGFzIGxhbWJkYV9weXRob24gZnJvbSBcIkBhd3MtY2RrL2F3cy1sYW1iZGEtcHl0aG9uLWFscGhhXCI7XG5pbXBvcnQgeyBQeXRob25GdW5jdGlvbiB9IGZyb20gXCJAYXdzLWNkay9hd3MtbGFtYmRhLXB5dGhvbi1hbHBoYVwiO1xuaW1wb3J0ICogYXMgczNWZWN0b3JzIGZyb20gXCJjZGstczMtdmVjdG9yc1wiO1xuaW1wb3J0ICogYXMgc3FzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGFFdmVudFNvdXJjZXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNvZ25pdG9cIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgKiBhcyBmcyBmcm9tIFwiZnNcIjtcbmltcG9ydCAqIGFzIGFnZW50Y29yZSBmcm9tIFwiQGF3cy1jZGsvYXdzLWJlZHJvY2stYWdlbnRjb3JlLWFscGhhXCI7XG5cbmV4cG9ydCBjbGFzcyBGdXJuaXR1cmVBcHBTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIDEuIEVuY3J5cHRpb24gYW5kIFMzIEJ1Y2tldHNcbiAgICBjb25zdCBlbmNyeXB0aW9uS2V5ID0gbmV3IGttcy5LZXkodGhpcywgXCJWZWN0b3JCdWNrZXRLZXlcIiwge1xuICAgICAgZGVzY3JpcHRpb246IFwiS01TIGtleSBmb3IgUzMgdmVjdG9yIGJ1Y2tldCBlbmNyeXB0aW9uXCIsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICBjb25zdCBjYXRhbG9nQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCBcIkZ1cm5pdHVyZUNhdGFsb2dCdWNrZXRcIiwge1xuICAgICAgYnVja2V0TmFtZTogXCJmdXJuaXR1cmUtYXBwLWNhdGFsb2ctdjJcIixcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGNvcnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBbXG4gICAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5HRVQsXG4gICAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5QT1NULFxuICAgICAgICAgICAgczMuSHR0cE1ldGhvZHMuUFVULFxuICAgICAgICAgICAgczMuSHR0cE1ldGhvZHMuSEVBRCxcbiAgICAgICAgICAgIHMzLkh0dHBNZXRob2RzLkRFTEVURSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbXCIqXCJdLCAvLyBJbiBwcm9kdWN0aW9uLCByZXN0cmljdCB0byB5b3VyIGRvbWFpblxuICAgICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbXCIqXCJdLFxuICAgICAgICAgIGV4cG9zZWRIZWFkZXJzOiBbXG4gICAgICAgICAgICBcIkVUYWdcIixcbiAgICAgICAgICAgIFwieC1hbXotc2VydmVyLXNpZGUtZW5jcnlwdGlvblwiLFxuICAgICAgICAgICAgXCJ4LWFtei1yZXF1ZXN0LWlkXCIsXG4gICAgICAgICAgICBcIngtYW16LWlkLTJcIixcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHZlY3RvckJ1Y2tldCA9IG5ldyBzM1ZlY3RvcnMuQnVja2V0KHRoaXMsIFwiRnVybml0dXJlVmVjdG9yQnVja2V0XCIsIHtcbiAgICAgIHZlY3RvckJ1Y2tldE5hbWU6IFwiZnVybml0dXJlLWFwcC12ZWN0b3ItdjJcIixcbiAgICAgIGVuY3J5cHRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgIHNzZVR5cGU6IFwiYXdzOmttc1wiLFxuICAgICAgICBrbXNLZXk6IGVuY3J5cHRpb25LZXksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgdmVjdG9ySW5kZXggPSBuZXcgczNWZWN0b3JzLkluZGV4KHRoaXMsIFwiRnVybml0dXJlVmVjdG9ySW5kZXhcIiwge1xuICAgICAgdmVjdG9yQnVja2V0TmFtZTogdmVjdG9yQnVja2V0LnZlY3RvckJ1Y2tldE5hbWUsXG4gICAgICBpbmRleE5hbWU6IFwiZnVybml0dXJlLWFwcC1pbmRleFwiLFxuICAgICAgZGF0YVR5cGU6IFwiZmxvYXQzMlwiLFxuICAgICAgZGltZW5zaW9uOiAzMDcyLCAvLyBVc2luZyAzMDcyIGZvciBOb3ZhIE11bHRpbW9kYWwgRW1iZWRkaW5nc1xuICAgICAgZGlzdGFuY2VNZXRyaWM6IFwiY29zaW5lXCIsXG4gICAgfSk7XG5cbiAgICAvLyAyLiBEeW5hbW9EQiBUYWJsZVxuICAgIGNvbnN0IHByb2R1Y3RUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIkZ1cm5pdHVyZVByb2R1Y3RUYWJsZVwiLCB7XG4gICAgICB0YWJsZU5hbWU6IFwiZnVybml0dXJlLWFwcC10YWJsZS12MlwiLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiUEtcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJTS1wiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyAzLiBFdmVudEJyaWRnZSBCdXNcbiAgICBjb25zdCBldmVudEJ1cyA9IG5ldyBldmVudHMuRXZlbnRCdXModGhpcywgXCJGdXJuaXR1cmVBcHBFdmVudEJ1c1wiLCB7XG4gICAgICBldmVudEJ1c05hbWU6IFwiRnVybml0dXJlQXBwQnVzXCIsXG4gICAgfSk7XG5cbiAgICAvLyA0LjUuIEF1dGggLSBDb2duaXRvIGZvciBBbXBsaWZ5XG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCBcIkZ1cm5pdHVyZVVzZXJQb29sXCIsIHtcbiAgICAgIHVzZXJQb29sTmFtZTogXCJmdXJuaXR1cmUtYXBwLXVzZXItcG9vbFwiLFxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudChcbiAgICAgIHRoaXMsXG4gICAgICBcIkZ1cm5pdHVyZVVzZXJQb29sQ2xpZW50XCIsXG4gICAgICB7XG4gICAgICAgIHVzZXJQb29sOiB1c2VyUG9vbCxcbiAgICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gMy41LiBTZWNyZXRzIE1hbmFnZXIgZm9yIFN0cmlwZVxuICAgIGNvbnN0IHN0cmlwZUFwaUtleSA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKFxuICAgICAgdGhpcyxcbiAgICAgIFwiU3RyaXBlQXBpS2V5XCIsXG4gICAgICBcImJlZHJvY2stYWdlbnRjb3JlLWlkZW50aXR5IWRlZmF1bHQvYXBpa2V5L1N0cmlwZURpcmVjdEtleVwiLFxuICAgICk7XG5cbiAgICAvLyA0LiBBcHBTeW5jIEFQSVxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcHBzeW5jLkdyYXBocWxBcGkodGhpcywgXCJGdXJuaXR1cmVHcmFwaHFsQXBpXCIsIHtcbiAgICAgIG5hbWU6IFwiRnVybml0dXJlQXBpXCIsXG4gICAgICBkZWZpbml0aW9uOiBhcHBzeW5jLkRlZmluaXRpb24uZnJvbUZpbGUoXG4gICAgICAgIHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi4vc2NoZW1hL3NjaGVtYS5ncmFwaHFsXCIpLFxuICAgICAgKSxcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHtcbiAgICAgICAgZGVmYXVsdEF1dGhvcml6YXRpb246IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5BUElfS0VZLFxuICAgICAgICB9LFxuICAgICAgICBhZGRpdGlvbmFsQXV0aG9yaXphdGlvbk1vZGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwcHN5bmMuQXV0aG9yaXphdGlvblR5cGUuSUFNLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwcHN5bmMuQXV0aG9yaXphdGlvblR5cGUuVVNFUl9QT09MLFxuICAgICAgICAgICAgdXNlclBvb2xDb25maWc6IHtcbiAgICAgICAgICAgICAgdXNlclBvb2w6IHVzZXJQb29sLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIGxvZ0NvbmZpZzoge1xuICAgICAgICBmaWVsZExvZ0xldmVsOiBhcHBzeW5jLkZpZWxkTG9nTGV2ZWwuQUxMLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGlkZW50aXR5UG9vbCA9IG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbChcbiAgICAgIHRoaXMsXG4gICAgICBcIkZ1cm5pdHVyZUlkZW50aXR5UG9vbFwiLFxuICAgICAge1xuICAgICAgICBpZGVudGl0eVBvb2xOYW1lOiBcImZ1cm5pdHVyZS1hcHAtaWRlbnRpdHktcG9vbFwiLFxuICAgICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IHRydWUsIC8vIEFsbG93IGd1ZXN0IHZpc3VhbCBzZWFyY2hlc1xuICAgICAgICBjb2duaXRvSWRlbnRpdHlQcm92aWRlcnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBjbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIElBTSBSb2xlcyBmb3IgSWRlbnRpdHkgUG9vbFxuICAgIGNvbnN0IHVuYXV0aFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgXCJDb2duaXRvVW5hdXRoUm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uRmVkZXJhdGVkUHJpbmNpcGFsKFxuICAgICAgICBcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbVwiLFxuICAgICAgICB7XG4gICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICBcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphdWRcIjogaWRlbnRpdHlQb29sLnJlZixcbiAgICAgICAgICB9LFxuICAgICAgICAgIFwiRm9yQW55VmFsdWU6U3RyaW5nTGlrZVwiOiB7XG4gICAgICAgICAgICBcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXJcIjogXCJ1bmF1dGhlbnRpY2F0ZWRcIixcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBcInN0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5XCIsXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYXV0aFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgXCJDb2duaXRvQXV0aFJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgXCJjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb21cIixcbiAgICAgICAge1xuICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgXCJjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkXCI6IGlkZW50aXR5UG9vbC5yZWYsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBcIkZvckFueVZhbHVlOlN0cmluZ0xpa2VcIjoge1xuICAgICAgICAgICAgXCJjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YW1yXCI6IFwiYXV0aGVudGljYXRlZFwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIFwic3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHlcIixcbiAgICAgICksXG4gICAgfSk7XG5cbiAgICBuZXcgY29nbml0by5DZm5JZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudChcbiAgICAgIHRoaXMsXG4gICAgICBcIklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50XCIsXG4gICAgICB7XG4gICAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgICByb2xlczoge1xuICAgICAgICAgIGF1dGhlbnRpY2F0ZWQ6IGF1dGhSb2xlLnJvbGVBcm4sXG4gICAgICAgICAgdW5hdXRoZW50aWNhdGVkOiB1bmF1dGhSb2xlLnJvbGVBcm4sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICk7XG5cbiAgICAvLyBHcmFudCBTMyBhY2Nlc3MgdG8gQ29nbml0byBSb2xlcyBmb3IgXCJ2aXN1YWxzXCIgZm9sZGVyXG4gICAgY29uc3QgczNQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXCJzMzpQdXRPYmplY3RcIiwgXCJzMzpHZXRPYmplY3RcIiwgXCJzMzpMaXN0QnVja2V0XCJdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGNhdGFsb2dCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICBgJHtjYXRhbG9nQnVja2V0LmJ1Y2tldEFybn0vdmlzdWFscy8qYCxcbiAgICAgICAgYCR7Y2F0YWxvZ0J1Y2tldC5idWNrZXRBcm59L3B1YmxpYy92aXN1YWxzLypgLCAvLyBBbXBsaWZ5IGRlZmF1bHQgcHJlZml4XG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgYXV0aFJvbGUuYWRkVG9Qb2xpY3koczNQb2xpY3kpO1xuICAgIHVuYXV0aFJvbGUuYWRkVG9Qb2xpY3koczNQb2xpY3kpO1xuXG4gICAgLy8gQWxzbyBncmFudCBJQU0gYWNjZXNzIHRvIEFwcFN5bmMgZm9yIHRoZXNlIHJvbGVzXG4gICAgYXBpLmdyYW50UXVlcnkoYXV0aFJvbGUpO1xuICAgIGFwaS5ncmFudE11dGF0aW9uKGF1dGhSb2xlKTtcbiAgICBhcGkuZ3JhbnRRdWVyeSh1bmF1dGhSb2xlKTtcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbih1bmF1dGhSb2xlKTtcblxuICAgIC8vIDUuIExhbWJkYSBGdW5jdGlvbnNcbiAgICBjb25zdCBweXRob25SdW50aW1lID0gKGxhbWJkYS5SdW50aW1lIGFzIGFueSkuUFlUSE9OXzNfMTM7XG5cbiAgICAvLyBhLiBQcmVzaWduZWQgVVJMIExhbWJkYVxuICAgIGNvbnN0IGdldFVwbG9hZFVybExhbWJkYSA9IG5ldyBQeXRob25GdW5jdGlvbih0aGlzLCBcIkdldFVwbG9hZFVybExhbWJkYVwiLCB7XG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi9sYW1iZGFcIiksXG4gICAgICBpbmRleDogXCJnZXRfdXBsb2FkX3VybF9sYW1iZGEucHlcIixcbiAgICAgIGhhbmRsZXI6IFwibGFtYmRhX2hhbmRsZXJcIixcbiAgICAgIHJ1bnRpbWU6IHB5dGhvblJ1bnRpbWUsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBCVUNLRVRfTkFNRTogY2F0YWxvZ0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBjYXRhbG9nQnVja2V0LmdyYW50V3JpdGUoZ2V0VXBsb2FkVXJsTGFtYmRhKTtcblxuICAgIGNvbnN0IGdldFByZXNpZ25lZFVybExhbWJkYSA9IG5ldyBQeXRob25GdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICBcIkdldFByZXNpZ25lZFVybExhbWJkYVwiLFxuICAgICAge1xuICAgICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi9sYW1iZGFcIiksXG4gICAgICAgIGluZGV4OiBcImdldF9wcmVzaWduZWRfdXJsX2xhbWJkYS5weVwiLFxuICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9oYW5kbGVyXCIsXG4gICAgICAgIHJ1bnRpbWU6IHB5dGhvblJ1bnRpbWUsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgQlVDS0VUX05BTUU6IGNhdGFsb2dCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICBjYXRhbG9nQnVja2V0LmdyYW50UmVhZChnZXRQcmVzaWduZWRVcmxMYW1iZGEpO1xuXG4gICAgLy8gR3JhbnQgcmVhZCBhY2Nlc3MgdG8gdGhlIHZlY3RvciBidWNrZXQgaWYgbmVlZGVkICh0aG91Z2ggcmVzdWx0cyB1c3VhbGx5IGNvbWUgZnJvbSBjYXRhbG9nKVxuICAgIGdldFByZXNpZ25lZFVybExhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcInMzOkdldE9iamVjdFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6czM6Ojoke3ZlY3RvckJ1Y2tldC52ZWN0b3JCdWNrZXROYW1lfS8qYF0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gYi4gQ2F0YWxvZyBUcmlnZ2VyIExhbWJkYSAoU3RhcnRzIFN0ZXAgRnVuY3Rpb25zKVxuICAgIGNvbnN0IGNhdGFsb2dUcmlnZ2VyTGFtYmRhID0gbmV3IFB5dGhvbkZ1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgIFwiQ2F0YWxvZ1RyaWdnZXJMYW1iZGFcIixcbiAgICAgIHtcbiAgICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi4vbGFtYmRhXCIpLFxuICAgICAgICBpbmRleDogXCJjYXRhbG9nX3RyaWdnZXJfbGFtYmRhLnB5XCIsXG4gICAgICAgIGhhbmRsZXI6IFwibGFtYmRhX2hhbmRsZXJcIixcbiAgICAgICAgcnVudGltZTogcHl0aG9uUnVudGltZSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIGMuIFZpc3VhbCBTZWFyY2ggVHJpZ2dlciBMYW1iZGEgKE5vdmEgLT4gVmVjdG9yIC0+IEV2ZW50QnJpZGdlKVxuICAgIGNvbnN0IHZpc3VhbFNlYXJjaFRyaWdnZXJMYW1iZGEgPSBuZXcgUHl0aG9uRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgXCJWaXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhXCIsXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2xhbWJkYVwiKSxcbiAgICAgICAgaW5kZXg6IFwidmlzdWFsX3NlYXJjaF90cmlnZ2VyX2xhbWJkYS5weVwiLFxuICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9oYW5kbGVyXCIsXG4gICAgICAgIHJ1bnRpbWU6IHB5dGhvblJ1bnRpbWUsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgR1JBUEhRTF9BUElfVVJMOiBhcGkuZ3JhcGhxbFVybCxcbiAgICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgICAgIFZFQ1RPUl9CVUNLRVQ6IHZlY3RvckJ1Y2tldC52ZWN0b3JCdWNrZXROYW1lLFxuICAgICAgICAgIFZFQ1RPUl9JTkRFWDogdmVjdG9ySW5kZXguaW5kZXhOYW1lLFxuICAgICAgICAgIERZTkFNT0RCX1RBQkxFOiBwcm9kdWN0VGFibGUudGFibGVOYW1lLFxuICAgICAgICB9LFxuXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICBwcm9kdWN0VGFibGUuZ3JhbnRSZWFkRGF0YSh2aXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhKTtcbiAgICB2aXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1wiczM6R2V0T2JqZWN0XCIsIFwiczM6TGlzdEJ1Y2tldFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6czM6Ojoke2NhdGFsb2dCdWNrZXQuYnVja2V0TmFtZX1gLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHtjYXRhbG9nQnVja2V0LmJ1Y2tldE5hbWV9LypgLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHt2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZX1gLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHt2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZX0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgYXBpLmdyYW50TXV0YXRpb24odmlzdWFsU2VhcmNoVHJpZ2dlckxhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyh2aXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhKTtcbiAgICB2aXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJiZWRyb2NrOkludm9rZU1vZGVsXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259Ojpmb3VuZGF0aW9uLW1vZGVsL2FtYXpvbi5ub3ZhLTItbXVsdGltb2RhbC1lbWJlZGRpbmdzLXYxOjBgLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIGQuIEJhdGNoIEdldCBJdGVtIExhbWJkYSAoVXNlZCBieSBTZWFyY2ggV29ya2Zsb3cpXG4gICAgY29uc3QgYmF0Y2hHZXRJdGVtTGFtYmRhID0gbmV3IFB5dGhvbkZ1bmN0aW9uKHRoaXMsIFwiQmF0Y2hHZXRJdGVtTGFtYmRhXCIsIHtcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2xhbWJkYVwiKSxcbiAgICAgIGluZGV4OiBcImJhdGNoX2dldF9pdGVtX2xhbWJkYS5weVwiLFxuICAgICAgaGFuZGxlcjogXCJsYW1iZGFfaGFuZGxlclwiLFxuICAgICAgcnVudGltZTogcHl0aG9uUnVudGltZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiBwcm9kdWN0VGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBwcm9kdWN0VGFibGUuZ3JhbnRSZWFkRGF0YShiYXRjaEdldEl0ZW1MYW1iZGEpO1xuXG4gICAgLy8gZS4gRHVyYWJsZSBWaXN1YWwgU2VhcmNoIFdvcmtmbG93IExhbWJkYVxuICAgIGNvbnN0IHZpc3VhbFNlYXJjaFdvcmtmbG93ID0gbmV3IFB5dGhvbkZ1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgIFwiVmlzdWFsU2VhcmNoV29ya2Zsb3dcIixcbiAgICAgIHtcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBcImZ1cm5pdHVyZS12aXN1YWwtc2VhcmNoLXdvcmtmbG93XCIsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2xhbWJkYVwiKSxcbiAgICAgICAgaW5kZXg6IFwidmlzdWFsX3NlYXJjaF93b3JrZmxvdy5weVwiLFxuICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9oYW5kbGVyXCIsXG4gICAgICAgIHJ1bnRpbWU6IHB5dGhvblJ1bnRpbWUsXG4gICAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDUwLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXG4gICAgICAgICAgVkVDVE9SX0JVQ0tFVDogdmVjdG9yQnVja2V0LnZlY3RvckJ1Y2tldE5hbWUsXG4gICAgICAgICAgVkVDVE9SX0lOREVYOiB2ZWN0b3JJbmRleC5pbmRleE5hbWUsXG4gICAgICAgICAgQkFUQ0hfR0VUX0lURU1fTEFNQkRBOiBiYXRjaEdldEl0ZW1MYW1iZGEuZnVuY3Rpb25OYW1lLFxuICAgICAgICB9LFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgLy8gQHRzLWlnbm9yZSAtIGR1cmFibGVDb25maWcgaXMgYSBuZXdlciBmZWF0dXJlL2FscGhhXG4gICAgICAgIGR1cmFibGVDb25maWc6IHtcbiAgICAgICAgICBleGVjdXRpb25UaW1lb3V0OiBjZGsuRHVyYXRpb24uZGF5cygzNjUpLFxuICAgICAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMoNyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICk7XG5cbiAgICB2aXN1YWxTZWFyY2hXb3JrZmxvdy5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcImxhbWJkYTpDaGVja3BvaW50RHVyYWJsZUV4ZWN1dGlvbnNcIixcbiAgICAgICAgICBcImxhbWJkYTpHZXREdXJhYmxlRXhlY3V0aW9uU3RhdGVcIixcbiAgICAgICAgICBcImxhbWJkYTpTZW5kRHVyYWJsZUV4ZWN1dGlvbkNhbGxiYWNrU3VjY2Vzc1wiLFxuICAgICAgICAgIFwibGFtYmRhOlNlbmREdXJhYmxlRXhlY3V0aW9uQ2FsbGJhY2tGYWlsdXJlXCIsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1wiKlwiXSxcbiAgICAgIH0pLFxuICAgICk7XG4gICAgY29uc3QgdmVyc2lvbiA9IHZpc3VhbFNlYXJjaFdvcmtmbG93LmN1cnJlbnRWZXJzaW9uO1xuICAgIGNvbnN0IGFsaWFzID0gbmV3IGxhbWJkYS5BbGlhcyh0aGlzLCBcIlByb2RBbGlhc1wiLCB7XG4gICAgICBhbGlhc05hbWU6IFwiZGV2XCIsXG4gICAgICB2ZXJzaW9uOiB2ZXJzaW9uLFxuICAgIH0pO1xuXG4gICAgYmF0Y2hHZXRJdGVtTGFtYmRhLmdyYW50SW52b2tlKHZpc3VhbFNlYXJjaFdvcmtmbG93KTtcbiAgICB2aXN1YWxTZWFyY2hXb3JrZmxvdy5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcImJlZHJvY2s6SW52b2tlTW9kZWxcIixcbiAgICAgICAgICBcImJlZHJvY2s6U3RhcnRBc3luY0ludm9rZVwiLFxuICAgICAgICAgIFwiYmVkcm9jazpHZXRBc3luY0ludm9rZVwiLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259Ojpmb3VuZGF0aW9uLW1vZGVsL2FtYXpvbi5ub3ZhLTItbXVsdGltb2RhbC1lbWJlZGRpbmdzLXYxOjBgLFxuICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmFzeW5jLWludm9rZS8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgICk7XG4gICAgdmlzdWFsU2VhcmNoV29ya2Zsb3cuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJzM3ZlY3RvcnM6UXVlcnlWZWN0b3JzXCIsIFwiczN2ZWN0b3JzOkdldFZlY3RvcnNcIl0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOnMzdmVjdG9yczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06YnVja2V0LyR7dmVjdG9yQnVja2V0LnZlY3RvckJ1Y2tldE5hbWV9L2luZGV4LyR7dmVjdG9ySW5kZXguaW5kZXhOYW1lfWAsXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICApO1xuICAgIHZpc3VhbFNlYXJjaFdvcmtmbG93LmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1wiczM6R2V0T2JqZWN0XCIsIFwiczM6UHV0T2JqZWN0XCIsIFwiczM6TGlzdEJ1Y2tldFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6czM6Ojoke2NhdGFsb2dCdWNrZXQuYnVja2V0TmFtZX1gLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHtjYXRhbG9nQnVja2V0LmJ1Y2tldE5hbWV9LypgLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHt2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZX1gLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHt2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZX0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGVuY3J5cHRpb25LZXkuZ3JhbnREZWNyeXB0KHZpc3VhbFNlYXJjaFdvcmtmbG93KTtcbiAgICBwcm9kdWN0VGFibGUuZ3JhbnRSZWFkRGF0YSh2aXN1YWxTZWFyY2hXb3JrZmxvdyk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyh2aXN1YWxTZWFyY2hXb3JrZmxvdyk7XG5cbiAgICAvLyBVcGRhdGUgVmlzdWFsIFNlYXJjaCBUcmlnZ2VyIHRvIHVzZSB0aGUgRHVyYWJsZSBXb3JrZmxvd1xuICAgIHZpc3VhbFNlYXJjaFRyaWdnZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoXG4gICAgICBcIkRVUkFCTEVfRlVOQ1RJT05fQVJOXCIsXG4gICAgICBgJHt2aXN1YWxTZWFyY2hXb3JrZmxvdy5mdW5jdGlvbkFybn06JHthbGlhcy5hbGlhc05hbWV9YCxcbiAgICApO1xuICAgIHZpc3VhbFNlYXJjaFRyaWdnZXJMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJsYW1iZGE6SW52b2tlRnVuY3Rpb25cIl0sXG4gICAgICAgIHJlc291cmNlczogW2Ake3Zpc3VhbFNlYXJjaFdvcmtmbG93LmZ1bmN0aW9uQXJufToke2FsaWFzLmFsaWFzTmFtZX1gXSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBmLiBQcm9jZXNzIEltYWdlcyBMYW1iZGEgKENhbGxlZCBieSBTdGVwIEZ1bmN0aW9ucylcbiAgICBjb25zdCBwcm9jZXNzSW1hZ2VzTGFtYmRhID0gbmV3IFB5dGhvbkZ1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgIFwiUHJvY2Vzc0ltYWdlc0xhbWJkYVwiLFxuICAgICAge1xuICAgICAgICBmdW5jdGlvbk5hbWU6IFwiZnVybml0dXJlLXByb2Nlc3MtaW1hZ2VzXCIsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2xhbWJkYVwiKSxcbiAgICAgICAgaW5kZXg6IFwicHJvY2Vzc19pbWFnZXMucHlcIixcbiAgICAgICAgaGFuZGxlcjogXCJsYW1iZGFfaGFuZGxlclwiLFxuICAgICAgICBydW50aW1lOiBweXRob25SdW50aW1lLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFNPVVJDRV9CVUNLRVQ6IGNhdGFsb2dCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBWRUNUT1JfQlVDS0VUOiB2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZSxcbiAgICAgICAgICBWRUNUT1JfSU5ERVg6IHZlY3RvckluZGV4LmluZGV4TmFtZSxcbiAgICAgICAgICBEWU5BTU9EQl9UQUJMRTogcHJvZHVjdFRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICAvLyBCcmVhayBjaXJjdWxhciBkZXBlbmRlbmN5XG4gICAgcHJvY2Vzc0ltYWdlc0xhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcInMzOkdldE9iamVjdFwiLFxuICAgICAgICAgIFwiczM6UHV0T2JqZWN0XCIsXG4gICAgICAgICAgXCJzMzpMaXN0QnVja2V0XCIsXG4gICAgICAgICAgXCJrbXM6R2VuZXJhdGVEYXRhS2V5XCIsXG4gICAgICAgICAgXCJrbXM6RGVjcnlwdFwiLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBcImFybjphd3M6czM6OjpmdXJuaXR1cmUtYXBwLWNhdGFsb2ctdjJcIixcbiAgICAgICAgICBcImFybjphd3M6czM6OjpmdXJuaXR1cmUtYXBwLWNhdGFsb2ctdjIvKlwiLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHt2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZX1gLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHt2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZX0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICApO1xuICAgIHByb2R1Y3RUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocHJvY2Vzc0ltYWdlc0xhbWJkYSk7XG4gICAgcHJvY2Vzc0ltYWdlc0xhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcInMzdmVjdG9yczpQdXRWZWN0b3JzXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzM3ZlY3RvcnM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmJ1Y2tldC8ke3ZlY3RvckJ1Y2tldC52ZWN0b3JCdWNrZXROYW1lfS9pbmRleC8ke3ZlY3RvckluZGV4LmluZGV4TmFtZX1gLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcbiAgICBlbmNyeXB0aW9uS2V5LmdyYW50RW5jcnlwdERlY3J5cHQocHJvY2Vzc0ltYWdlc0xhbWJkYSk7XG5cbiAgICBjb25zdCBzdGF0ZU1hY2hpbmUgPSBuZXcgc2ZuLlN0YXRlTWFjaGluZSh0aGlzLCBcIkZ1cm5pdHVyZUFwcFdvcmtmbG93XCIsIHtcbiAgICAgIHN0YXRlTWFjaGluZU5hbWU6IFwiZnVybml0dXJlLWFwcC13b3JrZmxvdy12MlwiLFxuICAgICAgZGVmaW5pdGlvbkJvZHk6IHNmbi5EZWZpbml0aW9uQm9keS5mcm9tRmlsZShcbiAgICAgICAgcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi93b3JrZmxvdy9mdXJuaXR1cmVfYXBwX3dvcmtmbG93LmFzbC5qc29uXCIpLFxuICAgICAgKSxcbiAgICAgIGRlZmluaXRpb25TdWJzdGl0dXRpb25zOiB7XG4gICAgICAgIEJVQ0tFVF9OQU1FOiBjYXRhbG9nQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIEZVTkNUSU9OX0FSTjogYGFybjphd3M6bGFtYmRhOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpmdW5jdGlvbjpmdXJuaXR1cmUtcHJvY2Vzcy1pbWFnZXNgLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHByb2Nlc3NJbWFnZXNMYW1iZGEuZ3JhbnRJbnZva2Uoc3RhdGVNYWNoaW5lKTtcblxuICAgIC8vIEJyZWFrIGNpcmN1bGFyIGRlcGVuZGVuY3kgYnkgdXNpbmcgc3RyaW5nIEFSTnNcbiAgICBzdGF0ZU1hY2hpbmUuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJzMzpHZXRPYmplY3RcIiwgXCJzMzpQdXRPYmplY3RcIiwgXCJzMzpMaXN0QnVja2V0XCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OiR7Y2F0YWxvZ0J1Y2tldC5idWNrZXROYW1lfWAsXG4gICAgICAgICAgYGFybjphd3M6czM6Ojoke2NhdGFsb2dCdWNrZXQuYnVja2V0TmFtZX0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICApO1xuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwiYmVkcm9jazpJbnZva2VNb2RlbFwiLFxuICAgICAgICAgIFwiYmVkcm9jazpTdGFydEFzeW5jSW52b2tlXCIsXG4gICAgICAgICAgXCJiZWRyb2NrOkdldEFzeW5jSW52b2tlXCIsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvYW1hem9uLm5vdmEtMi1tdWx0aW1vZGFsLWVtYmVkZGluZ3MtdjE6MGAsXG4gICAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06YXN5bmMtaW52b2tlLypgLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcbiAgICBzdGF0ZU1hY2hpbmUuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgXCJzdGF0ZXM6U3RhcnRFeGVjdXRpb25cIixcbiAgICAgICAgICBcInN0YXRlczpEZXNjcmliZUV4ZWN1dGlvblwiLFxuICAgICAgICAgIFwic3RhdGVzOlN0b3BFeGVjdXRpb25cIixcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c3RhdGVzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpzdGF0ZU1hY2hpbmU6ZnVybml0dXJlLWFwcC13b3JrZmxvdy12MmAsXG4gICAgICAgICAgYGFybjphd3M6c3RhdGVzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpzdGF0ZU1hY2hpbmU6ZnVybml0dXJlLWFwcC13b3JrZmxvdy12MjoqYCxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgICk7XG4gICAgc3RhdGVNYWNoaW5lLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwic3RhdGVzOkRlc2NyaWJlTWFwUnVuXCIsXG4gICAgICAgICAgXCJzdGF0ZXM6TGlzdE1hcFJ1bnNcIixcbiAgICAgICAgICBcInN0YXRlczpVcGRhdGVNYXBSdW5cIixcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c3RhdGVzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTptYXBSdW46ZnVybml0dXJlLWFwcC13b3JrZmxvdy12Mi8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgICk7XG4gICAgY2F0YWxvZ1RyaWdnZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoXG4gICAgICBcIlNUQVRFX01BQ0hJTkVfQVJOXCIsXG4gICAgICBgYXJuOmF3czpzdGF0ZXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnN0YXRlTWFjaGluZTpmdXJuaXR1cmUtYXBwLXdvcmtmbG93LXYyYCxcbiAgICApO1xuICAgIGNhdGFsb2dUcmlnZ2VyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1wic3RhdGVzOlN0YXJ0RXhlY3V0aW9uXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzdGF0ZXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnN0YXRlTWFjaGluZTpmdXJuaXR1cmUtYXBwLXdvcmtmbG93LXYyYCxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgICk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTdGF0ZU1hY2hpbmVBcm5cIiwge1xuICAgICAgdmFsdWU6IHN0YXRlTWFjaGluZS5zdGF0ZU1hY2hpbmVBcm4sXG4gICAgfSk7XG5cbiAgICAvLyA3LiBEaXJlY3QgRXZlbnRCcmlkZ2UgdG8gQXBwU3luYyBCcmlkZ2VcbiAgICBjb25zdCBhcHBTeW5jRXZlbnRCcmlkZ2VSb2xlID0gbmV3IGlhbS5Sb2xlKFxuICAgICAgdGhpcyxcbiAgICAgIFwiQXBwU3luY0V2ZW50QnJpZGdlUm9sZVwiLFxuICAgICAge1xuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImV2ZW50cy5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJSb2xlIGZvciBFdmVudEJyaWRnZSB0byBpbnZva2UgQXBwU3luYyBtdXRhdGlvbnNcIixcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGFwcFN5bmNFdmVudEJyaWRnZVJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1wiYXBwc3luYzpHcmFwaFFMXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtgJHthcGkuYXJufS90eXBlcy9NdXRhdGlvbi8qYF0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgY29uc3QgcmVzdWx0UnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCBcIlZpc3VhbFNlYXJjaFJlc3VsdFJ1bGVcIiwge1xuICAgICAgZXZlbnRCdXM6IGV2ZW50QnVzLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogW1wiY29tLmZ1cm5pdHVyZS5zZWFyY2hcIl0sXG4gICAgICAgIGRldGFpbFR5cGU6IFtcIlZpc3VhbFNlYXJjaFJlc3VsdFwiXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICByZXN1bHRSdWxlLmFkZFRhcmdldChcbiAgICAgIG5ldyB0YXJnZXRzLkFwcFN5bmMoYXBpLCB7XG4gICAgICAgIGdyYXBoUUxPcGVyYXRpb246IGBcbiAgICAgICAgbXV0YXRpb24gUHVzaFNlYXJjaFJlc3VsdCgkc3RhdHVzOiBTdHJpbmchLCAkbWVzc2FnZTogU3RyaW5nLCAkcmVzdWx0czogW1Byb2R1Y3RJbnB1dCFdKSB7XG4gICAgICAgICAgcHVzaFNlYXJjaFJlc3VsdChzdGF0dXM6ICRzdGF0dXMsIG1lc3NhZ2U6ICRtZXNzYWdlLCByZXN1bHRzOiAkcmVzdWx0cykge1xuICAgICAgICAgICAgc3RhdHVzXG4gICAgICAgICAgICBtZXNzYWdlXG4gICAgICAgICAgICByZXN1bHRzIHtcbiAgICAgICAgICAgICAgUEtcbiAgICAgICAgICAgICAgU0tcbiAgICAgICAgICAgICAgcHJvZHVjdE5hbWVcbiAgICAgICAgICAgICAgaW1hZ2VGaWxlXG4gICAgICAgICAgICAgIHByaWNlXG4gICAgICAgICAgICAgIGNhdGVnb3J5XG4gICAgICAgICAgICAgIHN1YkNhdGVnb3J5XG4gICAgICAgICAgICAgIGxldmVsXG4gICAgICAgICAgICAgIGltYWdlX3VyaVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgYCxcbiAgICAgICAgdmFyaWFibGVzOiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICAgIHN0YXR1czogZXZlbnRzLkV2ZW50RmllbGQuZnJvbVBhdGgoXCIkLmRldGFpbC5zdGF0dXNcIiksXG4gICAgICAgICAgbWVzc2FnZTogZXZlbnRzLkV2ZW50RmllbGQuZnJvbVBhdGgoXCIkLmRldGFpbC5tZXNzYWdlXCIpLFxuICAgICAgICAgIHJlc3VsdHM6IGV2ZW50cy5FdmVudEZpZWxkLmZyb21QYXRoKFwiJC5kZXRhaWwucmVzdWx0c1wiKSxcbiAgICAgICAgfSksXG4gICAgICAgIGV2ZW50Um9sZTogYXBwU3luY0V2ZW50QnJpZGdlUm9sZSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBuZXcgY2RrLmF3c19sb2dzLkxvZ0dyb3VwKHRoaXMsIFwiRnVybml0dXJlQXBwQnVzTG9nc1wiLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2V2ZW50cy8ke2V2ZW50QnVzLmV2ZW50QnVzTmFtZX0vbG9nc2AsXG4gICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIFZpc3VhbCBTZWFyY2ggU1FTIFF1ZXVlICYgRExRXG4gICAgY29uc3QgdmlzdWFsU2VhcmNoRGxxID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCBcIlZpc3VhbFNlYXJjaERMUVwiLCB7XG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKDE0KSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHZpc3VhbFNlYXJjaFF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCBcIlZpc3VhbFNlYXJjaFF1ZXVlXCIsIHtcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMDApLCAvLyBoaWdoZXIgdGhhbiBsYW1iZGEgdGltZW91dCBvZiAzMHNcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xuICAgICAgICBxdWV1ZTogdmlzdWFsU2VhcmNoRGxxLFxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsIC8vIDMgcmV0cmllcyBiZWZvcmUgRExRXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY2F0YWxvZ0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcbiAgICAgIG5ldyBzM24uU3FzRGVzdGluYXRpb24odmlzdWFsU2VhcmNoUXVldWUpLFxuICAgICAgeyBwcmVmaXg6IFwidmlzdWFscy9cIiB9LFxuICAgICk7XG5cbiAgICAvLyBTdXBwb3J0IEFtcGxpZnkncyBkZWZhdWx0ICdwdWJsaWMvJyBwcmVmaXhcbiAgICBjYXRhbG9nQnVja2V0LmFkZEV2ZW50Tm90aWZpY2F0aW9uKFxuICAgICAgczMuRXZlbnRUeXBlLk9CSkVDVF9DUkVBVEVELFxuICAgICAgbmV3IHMzbi5TcXNEZXN0aW5hdGlvbih2aXN1YWxTZWFyY2hRdWV1ZSksXG4gICAgICB7IHByZWZpeDogXCJwdWJsaWMvdmlzdWFscy9cIiB9LFxuICAgICk7XG5cbiAgICB2aXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhLmFkZEV2ZW50U291cmNlKFxuICAgICAgbmV3IGxhbWJkYUV2ZW50U291cmNlcy5TcXNFdmVudFNvdXJjZSh2aXN1YWxTZWFyY2hRdWV1ZSwge1xuICAgICAgICBiYXRjaFNpemU6IDEwLFxuICAgICAgICBtYXhDb25jdXJyZW5jeTogNSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBlLiBBZ2VudCBSdW50aW1lIExhbWJkYSAoU3RyYW5kcyArIEFnZW50Q29yZSlcbiAgICBjb25zdCBhZ2VudFJ1bnRpbWVMYW1iZGEgPSBuZXcgUHl0aG9uRnVuY3Rpb24odGhpcywgXCJBZ2VudFJ1bnRpbWVMYW1iZGFcIiwge1xuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi4vYWdlbnRcIiksXG4gICAgICBpbmRleDogXCJhZ2VudF9ydW50aW1lLnB5XCIsXG4gICAgICBoYW5kbGVyOiBcImFwcFwiLFxuICAgICAgcnVudGltZTogcHl0aG9uUnVudGltZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiBwcm9kdWN0VGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICB9KTtcbiAgICBwcm9kdWN0VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFnZW50UnVudGltZUxhbWJkYSk7XG4gICAgYWdlbnRSdW50aW1lTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgXCJiZWRyb2NrOkludm9rZU1vZGVsXCIsXG4gICAgICAgICAgXCJiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtXCIsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvKmBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIGYuIEFnZW50Q29yZSBUb29scyBMYW1iZGFcbiAgICBjb25zdCBhZ2VudENvcmVUb29sc0xhbWJkYSA9IG5ldyBQeXRob25GdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICBcIkFnZW50Q29yZVRvb2xzTGFtYmRhXCIsXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2FnZW50XCIpLFxuICAgICAgICBpbmRleDogXCJhZ2VudGNvcmVfdG9vbHMucHlcIixcbiAgICAgICAgaGFuZGxlcjogXCJsYW1iZGFfaGFuZGxlclwiLFxuICAgICAgICBydW50aW1lOiBweXRob25SdW50aW1lLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIERZTkFNT0RCX1RBQkxFOiBwcm9kdWN0VGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIFNUUklQRV9TRUNSRVRfTkFNRTogc3RyaXBlQXBpS2V5LnNlY3JldE5hbWUsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgfSxcbiAgICApO1xuICAgIHN0cmlwZUFwaUtleS5ncmFudFJlYWQoYWdlbnRDb3JlVG9vbHNMYW1iZGEpO1xuICAgIHByb2R1Y3RUYWJsZS5ncmFudFJlYWREYXRhKGFnZW50Q29yZVRvb2xzTGFtYmRhKTtcbiAgICAvLyBOb3RlOiBjcmVhdGVfb3JkZXIgaXMgbW9ja2VkLCBidXQgd2UgbWlnaHQgZXZlbnR1YWxseSBuZWVkIHdyaXRlIGFjY2Vzc1xuICAgIHByb2R1Y3RUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYWdlbnRDb3JlVG9vbHNMYW1iZGEpO1xuXG4gICAgLy8gZy4gQXBwU3luYyBBZ2VudCBSZXNvbHZlciBMYW1iZGFcbiAgICBjb25zdCBhcHBzeW5jQWdlbnRSZXNvbHZlckxhbWJkYSA9IG5ldyBQeXRob25GdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICBcIkFwcHN5bmNBZ2VudFJlc29sdmVyTGFtYmRhXCIsXG4gICAgICB7XG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2FnZW50XCIpLFxuICAgICAgICBpbmRleDogXCJhcHBzeW5jX2FnZW50X3Jlc29sdmVyLnB5XCIsXG4gICAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgICBydW50aW1lOiBweXRob25SdW50aW1lLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIEFHRU5UX1JVTlRJTUVfSUQ6IFwicGxhY2Vob2xkZXJcIiwgLy8gV2lsbCBiZSByZXBsYWNlZCBieSBhZ2VudFJ1bnRpbWUucnVudGltZUlkXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gOS4gQmVkcm9jayBBZ2VudENvcmUgQ29uc3RydWN0c1xuICAgIC8vIGEuIE1lbW9yeVxuICAgIGNvbnN0IG1lbW9yeSA9IG5ldyBhZ2VudGNvcmUuTWVtb3J5KHRoaXMsIFwiRnVybml0dXJlTWVtb3J5XCIsIHtcbiAgICAgIG1lbW9yeU5hbWU6IFwiZnVybml0dXJlX21lbW9yeVwiLFxuICAgICAgZGVzY3JpcHRpb246IFwiTWVtb3J5IGZvciBmdXJuaXR1cmUgYXNzaXN0YW50XCIsXG4gICAgICBleHBpcmF0aW9uRHVyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgIG1lbW9yeVN0cmF0ZWdpZXM6IFtcbiAgICAgICAgYWdlbnRjb3JlLk1lbW9yeVN0cmF0ZWd5LnVzaW5nQnVpbHRJblN1bW1hcml6YXRpb24oKSxcbiAgICAgICAgYWdlbnRjb3JlLk1lbW9yeVN0cmF0ZWd5LnVzaW5nQnVpbHRJblNlbWFudGljKCksXG4gICAgICAgIGFnZW50Y29yZS5NZW1vcnlTdHJhdGVneS51c2luZ0J1aWx0SW5Vc2VyUHJlZmVyZW5jZSgpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIGIuIEdhdGV3YXlcbiAgICBjb25zdCBnYXRld2F5ID0gbmV3IGFnZW50Y29yZS5HYXRld2F5KHRoaXMsIFwiRnVybml0dXJlR2F0ZXdheVwiLCB7XG4gICAgICBnYXRld2F5TmFtZTogXCJmdXJuaXR1cmUtZ2F0ZXdheVwiLFxuICAgICAgZGVzY3JpcHRpb246IFwiR2F0ZXdheSBmb3IgZnVybml0dXJlIGFzc2lzdGFudCB0b29sc1wiLFxuICAgIH0pO1xuXG4gICAgLy8gYy4gR2F0ZXdheSBUYXJnZXQgKExhbWJkYSBmb3IgdG9vbHMpXG4gICAgY29uc3QgdG9vbFNjaGVtYVBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2FnZW50L3Rvb2xzX3NjaGVtYS5qc29uXCIpO1xuICAgIGxldCB0b29sU2NoZW1hSnNvbiA9IHt9O1xuICAgIGlmIChmcy5leGlzdHNTeW5jKHRvb2xTY2hlbWFQYXRoKSkge1xuICAgICAgdG9vbFNjaGVtYUpzb24gPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyh0b29sU2NoZW1hUGF0aCwgXCJ1dGY4XCIpKTtcbiAgICB9XG5cbiAgICBnYXRld2F5LmFkZExhbWJkYVRhcmdldChcIkZ1cm5pdHVyZVRvb2xzVGFyZ2V0VjJcIiwge1xuICAgICAgZ2F0ZXdheVRhcmdldE5hbWU6IFwiZnVybml0dXJlLXRvb2xzXCIsXG4gICAgICBkZXNjcmlwdGlvbjogXCJUYXJnZXQgZm9yIGZ1cm5pdHVyZSBjYXRhbG9nIGFuZCBvcmRlcmluZyB0b29sc1wiLFxuICAgICAgbGFtYmRhRnVuY3Rpb246IGFnZW50Q29yZVRvb2xzTGFtYmRhLFxuICAgICAgdG9vbFNjaGVtYTogYWdlbnRjb3JlLlRvb2xTY2hlbWEuZnJvbUlubGluZShcbiAgICAgICAgdG9vbFNjaGVtYUpzb24gYXMgYWdlbnRjb3JlLlRvb2xEZWZpbml0aW9uW10sXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc3RyaXBlQXV0aERpc2NvdmVyeVVybCA9XG4gICAgICBcImh0dHBzOi8vY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vdXMtZWFzdC0xX1N2cE5zWEpvZC8ud2VsbC1rbm93bi9vcGVuaWQtY29uZmlndXJhdGlvblwiO1xuICAgIGNvbnN0IHN0cmlwZUF1dGhDbGllbnRJZCA9IFwiNG9nMjY3b2Nob2JubDJnc2hkM3BncWdrbjhcIjtcblxuICAgIC8vIGUuIFN0cmlwZSBSdW50aW1lXG4gICAgY29uc3Qgc3RyaXBlUnVudGltZSA9IG5ldyBhZ2VudGNvcmUuUnVudGltZSh0aGlzLCBcIlN0cmlwZVJ1bnRpbWVWMTFcIiwge1xuICAgICAgcnVudGltZU5hbWU6IFwiZnVybml0dXJlX3N0cmlwZV9wcm94eV92MTFcIixcbiAgICAgIGFnZW50UnVudGltZUFydGlmYWN0OiBhZ2VudGNvcmUuQWdlbnRSdW50aW1lQXJ0aWZhY3QuZnJvbUFzc2V0KFxuICAgICAgICBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uL2FnZW50X3N0cmlwZVwiKSxcbiAgICAgICksXG4gICAgICBkZXNjcmlwdGlvbjogXCJTdHJpcGUgUHJveHkgUnVudGltZSBiYXNlZCBvbiBGYXN0TUNQXCIsXG4gICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICBTVFJJUEVfU0VDUkVUX05BTUU6IHN0cmlwZUFwaUtleS5zZWNyZXROYW1lLFxuICAgICAgICBSRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgfSxcbiAgICAgIHByb3RvY29sQ29uZmlndXJhdGlvbjogYWdlbnRjb3JlLlByb3RvY29sVHlwZS5NQ1AsXG4gICAgICBhdXRob3JpemVyQ29uZmlndXJhdGlvbjpcbiAgICAgICAgYWdlbnRjb3JlLlJ1bnRpbWVBdXRob3JpemVyQ29uZmlndXJhdGlvbi51c2luZ09BdXRoKFxuICAgICAgICAgIHN0cmlwZUF1dGhEaXNjb3ZlcnlVcmwsXG4gICAgICAgICAgc3RyaXBlQXV0aENsaWVudElkLFxuICAgICAgICAgIHVuZGVmaW5lZCwgLy8gTm8gc3BlY2lmaWMgYXVkaWVuY2Ugb3ZlcnJpZGVcbiAgICAgICAgICBbXCJtY3AtcnVudGltZS1zZXJ2ZXIvaW52b2tlXCJdLCAvLyBTY29wZXMgbWF0Y2hpbmcgdGhlIEdhdGV3YXkgcHJvdmlkZXJcbiAgICAgICAgKSxcbiAgICB9KTtcbiAgICBzdHJpcGVBcGlLZXkuZ3JhbnRSZWFkKHN0cmlwZVJ1bnRpbWUucm9sZSEpO1xuXG4gICAgLy8gT0F1dGgyIGF1dGhlbnRpY2F0aW9uIEFSTnMgZGlzY292ZXJlZCBmcm9tIGVudmlyb25tZW50XG4gICAgY29uc3Qgb2F1dGhQcm92aWRlckFybiA9XG4gICAgICBcImFybjphd3M6YmVkcm9jay1hZ2VudGNvcmU6dXMtZWFzdC0xOjEzMjI2MDI1MzI4NTp0b2tlbi12YXVsdC9kZWZhdWx0L29hdXRoMmNyZWRlbnRpYWxwcm92aWRlci9TdHJpcGVSdW50aW1lQXV0aFwiO1xuICAgIGNvbnN0IG9hdXRoU2VjcmV0QXJuID1cbiAgICAgIFwiYXJuOmF3czpzZWNyZXRzbWFuYWdlcjp1cy1lYXN0LTE6MTMyMjYwMjUzMjg1OnNlY3JldDpiZWRyb2NrLWFnZW50Y29yZS1pZGVudGl0eSFkZWZhdWx0L29hdXRoMi9TdHJpcGVSdW50aW1lQXV0aC1kS0pDQ0FcIjtcblxuICAgIC8vIEFkZCBhbiBNQ1Agc2VydmVyIHRhcmdldCBkaXJlY3RseSB0byB0aGUgZ2F0ZXdheSBwb2ludGluZyB0byB0aGUgUnVudGltZVxuICAgIGNvbnN0IHN0cmlwZU1jcFRhcmdldCA9IGdhdGV3YXkuYWRkTWNwU2VydmVyVGFyZ2V0KFwiU3RyaXBlTWNwVGFyZ2V0VjIwXCIsIHtcbiAgICAgIGdhdGV3YXlUYXJnZXROYW1lOiBcInN0cmlwZS1wcm94eS12MjBcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlJ1bnRpbWUtYmFzZWQgU3RyaXBlIHRvb2wgaW50ZWdyYXRpb25cIixcbiAgICAgIGVuZHBvaW50OiBgaHR0cHM6Ly8ke3N0cmlwZVJ1bnRpbWUuYWdlbnRSdW50aW1lSWR9LnJ1bnRpbWUuYmVkcm9jay1hZ2VudGNvcmUuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS9tY3BgLFxuICAgICAgY3JlZGVudGlhbFByb3ZpZGVyQ29uZmlndXJhdGlvbnM6IFtcbiAgICAgICAgYWdlbnRjb3JlLkdhdGV3YXlDcmVkZW50aWFsUHJvdmlkZXIuZnJvbU9hdXRoSWRlbnRpdHlBcm4oe1xuICAgICAgICAgIHByb3ZpZGVyQXJuOiBvYXV0aFByb3ZpZGVyQXJuLFxuICAgICAgICAgIHNlY3JldEFybjogb2F1dGhTZWNyZXRBcm4sXG4gICAgICAgICAgc2NvcGVzOiBbXCJtY3AtcnVudGltZS1zZXJ2ZXIvaW52b2tlXCJdLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBDUklUSUNBTDogR3JhbnQgR2F0ZXdheSBwZXJtaXNzaW9uIHRvIGludm9rZSB0aGUgUnVudGltZVxuICAgIHN0cmlwZVJ1bnRpbWUuZ3JhbnRJbnZva2UoZ2F0ZXdheS5yb2xlKTtcblxuICAgIC8vIC0tLSBBRERFRDogU3luYyBGdW5jdGlvbiAtLS1cbiAgICBjb25zdCBzeW5jRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIFwiU3luY0Z1bmN0aW9uXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEyLFxuICAgICAgaGFuZGxlcjogXCJpbmRleC5oYW5kbGVyXCIsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcbmltcG9ydCBib3RvM1xuaW1wb3J0IGpzb25cblxuZGVmIGhhbmRsZXIoZXZlbnQsIGNvbnRleHQpOlxuICAgIGNsaWVudCA9IGJvdG8zLmNsaWVudCgnYmVkcm9jay1hZ2VudGNvcmUtY29udHJvbCcpXG4gICAgcmVzcG9uc2UgPSBjbGllbnQuc3luY2hyb25pemVfZ2F0ZXdheV90YXJnZXRzKFxuICAgICAgICBnYXRld2F5SWRlbnRpZmllcj1ldmVudFsnZ2F0ZXdheUlkJ10sXG4gICAgICAgIHRhcmdldElkcz1ldmVudFsndGFyZ2V0SWRzJ11cbiAgICApXG4gICAgcmV0dXJuIHtcbiAgICAgICAgJ3N0YXR1c0NvZGUnOiAyMDAsXG4gICAgICAgICdib2R5JzoganNvbi5kdW1wcyh7J21lc3NhZ2UnOiAnU3luYyBpbml0aWF0ZWQnLCAncmVzcG9uc2UnOiBzdHIocmVzcG9uc2UpfSlcbiAgICB9XG4gICAgICBgKSxcbiAgICB9KTtcblxuICAgIHN0cmlwZU1jcFRhcmdldC5ncmFudFN5bmMoc3luY0Z1bmN0aW9uKTtcblxuICAgIC8vIGQuIFJ1bnRpbWVcbiAgICBjb25zdCBhZ2VudFJ1bnRpbWUgPSBuZXcgYWdlbnRjb3JlLlJ1bnRpbWUodGhpcywgXCJGdXJuaXR1cmVSdW50aW1lXCIsIHtcbiAgICAgIHJ1bnRpbWVOYW1lOiBcImZ1cm5pdHVyZV9ydW50aW1lXCIsXG4gICAgICBhZ2VudFJ1bnRpbWVBcnRpZmFjdDogYWdlbnRjb3JlLkFnZW50UnVudGltZUFydGlmYWN0LmZyb21Bc3NldChcbiAgICAgICAgcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi9hZ2VudFwiKSxcbiAgICAgICksXG4gICAgICBkZXNjcmlwdGlvbjogXCJSdW50aW1lIGZvciBmdXJuaXR1cmUgYXNzaXN0YW50IGFnZW50XCIsXG4gICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICBEWU5BTU9EQl9UQUJMRTogcHJvZHVjdFRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgR0FURVdBWV9JRDogZ2F0ZXdheS5nYXRld2F5SWQsXG4gICAgICAgIEdBVEVXQVlfVVJMOiBgaHR0cHM6Ly8ke2dhdGV3YXkuZ2F0ZXdheUlkfS5nYXRld2F5LmJlZHJvY2stYWdlbnRjb3JlLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vbWNwYCxcbiAgICAgICAgR0FURVdBWV9DTElFTlRfSUQ6IGdhdGV3YXkudXNlclBvb2xDbGllbnQhLnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIEdBVEVXQVlfQ0xJRU5UX1NFQ1JFVDogKFxuICAgICAgICAgIGdhdGV3YXkudXNlclBvb2xDbGllbnQgYXMgYW55XG4gICAgICAgICkudXNlclBvb2xDbGllbnRTZWNyZXQudW5zYWZlVW53cmFwKCksXG4gICAgICAgIEdBVEVXQVlfVE9LRU5fRU5EUE9JTlQ6IGdhdGV3YXkudG9rZW5FbmRwb2ludFVybCEsXG4gICAgICAgIEdBVEVXQVlfU0NPUEU6IGAke2dhdGV3YXkubm9kZS5pZH0vaW52b2tlYCxcbiAgICAgICAgUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgU1RSSVBFX1NFQ1JFVF9OQU1FOiBzdHJpcGVBcGlLZXkuc2VjcmV0TmFtZSxcbiAgICAgICAgTUVNT1JZX0lEOiBtZW1vcnkubWVtb3J5SWQsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gVXBkYXRlIHRoZSBwbGFjZWhvbGRlciBmb3IgQUdFTlRfUlVOVElNRV9BUk4gaW4gcmVzb2x2ZXJcbiAgICBhcHBzeW5jQWdlbnRSZXNvbHZlckxhbWJkYS5hZGRFbnZpcm9ubWVudChcbiAgICAgIFwiQUdFTlRfUlVOVElNRV9BUk5cIixcbiAgICAgIGFnZW50UnVudGltZS5hZ2VudFJ1bnRpbWVBcm4sXG4gICAgKTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHRoZSBydW50aW1lIHJvbGVcbiAgICBjb25zdCBydW50aW1lUm9sZSA9IGFnZW50UnVudGltZS5yb2xlO1xuICAgIHByb2R1Y3RUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocnVudGltZVJvbGUpO1xuICAgIHN0cmlwZUFwaUtleS5ncmFudFJlYWQocnVudGltZVJvbGUpO1xuXG4gICAgLy8gQmVkcm9jayBhY2Nlc3MgZm9yIHRoZSBydW50aW1lIHJvbGVcbiAgICBydW50aW1lUm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwiYmVkcm9jazpJbnZva2VNb2RlbFwiLFxuICAgICAgICAgIFwiYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbVwiLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gUGVybWlzc2lvbiBmb3IgUnVudGltZSB0byB1c2UgR2F0ZXdheVxuICAgIGdhdGV3YXkuZ3JhbnRJbnZva2UocnVudGltZVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgQXBwU3luYyByZXNvbHZlciBwZXJtaXNzaW9uIHRvIGludm9rZSB0aGUgc3BlY2lmaWMgcnVudGltZVxuICAgIGFnZW50UnVudGltZS5ncmFudEludm9rZShhcHBzeW5jQWdlbnRSZXNvbHZlckxhbWJkYSk7XG5cbiAgICAvLyBQZXJtaXNzaW9ucyBmb3IgdGhlIEFwcFN5bmMgcmVzb2x2ZXIgdG8gaW50ZXJhY3Qgd2l0aCBBZ2VudENvcmUgcnVudGltZVxuICAgIGFwcHN5bmNBZ2VudFJlc29sdmVyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwiYmVkcm9jay1hZ2VudGNvcmU6SW52b2tlQWdlbnRSdW50aW1lXCIsXG4gICAgICAgICAgXCJiZWRyb2NrLWFnZW50Y29yZTpJbnZva2VBZ2VudFJ1bnRpbWVXaXRoV2ViU29ja2V0U3RyZWFtXCIsXG4gICAgICAgICAgXCJiZWRyb2NrLWFnZW50Y29yZTpHZXRBZ2VudFJ1bnRpbWVcIixcbiAgICAgICAgICBcImJlZHJvY2stYWdlbnRjb3JlOkxpc3RBZ2VudFJ1bnRpbWVzXCIsXG4gICAgICAgICAgXCJiZWRyb2NrLWFnZW50Y29yZTpHZXRBZ2VudFJ1bnRpbWVFbmRwb2ludFwiLFxuICAgICAgICAgIFwiYmVkcm9jay1hZ2VudGNvcmU6R2V0QWdlbnRSdW50aW1lVmVyc2lvblwiLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gMTAuIEFwcFN5bmMgUmVzb2x2ZXJzXG4gICAgY29uc3QgZ2V0VXBsb2FkVXJsRFMgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZShcbiAgICAgIFwiR2V0VXBsb2FkVXJsRFNcIixcbiAgICAgIGdldFVwbG9hZFVybExhbWJkYSxcbiAgICApO1xuICAgIGdldFVwbG9hZFVybERTLmNyZWF0ZVJlc29sdmVyKFwiR2V0VXBsb2FkVXJsUmVzb2x2ZXJcIiwge1xuICAgICAgdHlwZU5hbWU6IFwiTXV0YXRpb25cIixcbiAgICAgIGZpZWxkTmFtZTogXCJnZXRVcGxvYWRVcmxcIixcbiAgICB9KTtcblxuICAgIGNvbnN0IGdldFByZXNpZ25lZFVybERTID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoXG4gICAgICBcIkdldFByZXNpZ25lZFVybERTXCIsXG4gICAgICBnZXRQcmVzaWduZWRVcmxMYW1iZGEsXG4gICAgKTtcbiAgICBnZXRQcmVzaWduZWRVcmxEUy5jcmVhdGVSZXNvbHZlcihcIkdldFByZXNpZ25lZFVybFJlc29sdmVyXCIsIHtcbiAgICAgIHR5cGVOYW1lOiBcIk11dGF0aW9uXCIsXG4gICAgICBmaWVsZE5hbWU6IFwiZ2V0UHJlc2lnbmVkVXJsXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCB0cmlnZ2VyQ2F0YWxvZ0RTID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoXG4gICAgICBcIlRyaWdnZXJDYXRhbG9nRFNcIixcbiAgICAgIGNhdGFsb2dUcmlnZ2VyTGFtYmRhLFxuICAgICk7XG4gICAgdHJpZ2dlckNhdGFsb2dEUy5jcmVhdGVSZXNvbHZlcihcIlRyaWdnZXJDYXRhbG9nUmVzb2x2ZXJcIiwge1xuICAgICAgdHlwZU5hbWU6IFwiTXV0YXRpb25cIixcbiAgICAgIGZpZWxkTmFtZTogXCJ0cmlnZ2VyQ2F0YWxvZ1Byb2Nlc3NpbmdcIixcbiAgICB9KTtcblxuICAgIGNvbnN0IG5vbmVEUyA9IGFwaS5hZGROb25lRGF0YVNvdXJjZShcIk5vbmVEU1wiKTtcbiAgICBhcGkuY3JlYXRlUmVzb2x2ZXIoXCJQdXNoU2VhcmNoUmVzdWx0UmVzb2x2ZXJcIiwge1xuICAgICAgdHlwZU5hbWU6IFwiTXV0YXRpb25cIixcbiAgICAgIGZpZWxkTmFtZTogXCJwdXNoU2VhcmNoUmVzdWx0XCIsXG4gICAgICBydW50aW1lOiBhcHBzeW5jLkZ1bmN0aW9uUnVudGltZS5KU18xXzBfMCxcbiAgICAgIGRhdGFTb3VyY2U6IG5vbmVEUyxcbiAgICAgIGNvZGU6IGFwcHN5bmMuQ29kZS5mcm9tQXNzZXQoXG4gICAgICAgIHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi4vcmVzb2x2ZXJzL3B1c2hTZWFyY2hSZXN1bHQuanNcIiksXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYWdlbnREUyA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKFxuICAgICAgXCJhZ2VudERTXCIsXG4gICAgICBhcHBzeW5jQWdlbnRSZXNvbHZlckxhbWJkYSxcbiAgICApO1xuICAgIGFwaS5jcmVhdGVSZXNvbHZlcihcImludm9rZUFnZW50UmVzb2x2ZXJcIiwge1xuICAgICAgdHlwZU5hbWU6IFwiTXV0YXRpb25cIixcbiAgICAgIGZpZWxkTmFtZTogXCJpbnZva2VBZ2VudFwiLFxuICAgICAgZGF0YVNvdXJjZTogYWdlbnREUyxcbiAgICB9KTtcblxuICAgIGFwaS5jcmVhdGVSZXNvbHZlcihcImdldEFnZW50V2Vic29ja2V0Q29uZmlnUmVzb2x2ZXJcIiwge1xuICAgICAgdHlwZU5hbWU6IFwiTXV0YXRpb25cIixcbiAgICAgIGZpZWxkTmFtZTogXCJnZXRBZ2VudFdlYnNvY2tldENvbmZpZ1wiLFxuICAgICAgZGF0YVNvdXJjZTogYWdlbnREUyxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCB2YWx1ZXNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkdyYXBoUUxBUElVUkxcIiwgeyB2YWx1ZTogYXBpLmdyYXBocWxVcmwgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJHcmFwaFFMQVBJS2V5XCIsIHsgdmFsdWU6IGFwaS5hcGlLZXkgfHwgXCJcIiB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkNhdGFsb2dCdWNrZXROYW1lXCIsIHtcbiAgICAgIHZhbHVlOiBjYXRhbG9nQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBZ2VudFJ1bnRpbWVMYW1iZGFBcm5cIiwge1xuICAgICAgdmFsdWU6IGFnZW50UnVudGltZUxhbWJkYS5mdW5jdGlvbkFybixcbiAgICB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFnZW50Q29yZVRvb2xzTGFtYmRhQXJuXCIsIHtcbiAgICAgIHZhbHVlOiBhZ2VudENvcmVUb29sc0xhbWJkYS5mdW5jdGlvbkFybixcbiAgICB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFnZW50UnVudGltZUlkXCIsIHtcbiAgICAgIHZhbHVlOiBhZ2VudFJ1bnRpbWUuYWdlbnRSdW50aW1lSWQsXG4gICAgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBZ2VudFJ1bnRpbWVBcm5cIiwge1xuICAgICAgdmFsdWU6IGFnZW50UnVudGltZS5hZ2VudFJ1bnRpbWVBcm4sXG4gICAgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJHYXRld2F5SWRcIiwge1xuICAgICAgdmFsdWU6IGdhdGV3YXkuZ2F0ZXdheUlkLFxuICAgIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTWVtb3J5SWRcIiwge1xuICAgICAgdmFsdWU6IG1lbW9yeS5tZW1vcnlJZCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xJZFwiLCB7IHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xDbGllbnRJZFwiLCB7XG4gICAgICB2YWx1ZTogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIklkZW50aXR5UG9vbElkXCIsIHsgdmFsdWU6IGlkZW50aXR5UG9vbC5yZWYgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJSZWdpb25cIiwgeyB2YWx1ZTogdGhpcy5yZWdpb24gfSk7XG4gIH1cbn1cbiJdfQ==