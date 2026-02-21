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
const s3n = require("aws-cdk-lib/aws-s3-notifications");
const kms = require("aws-cdk-lib/aws-kms");
const iam = require("aws-cdk-lib/aws-iam");
const s3Vectors = require("cdk-s3-vectors");
const path = require("path");
const fs = require("fs");
class FurnitureAppStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // 1. Encryption and S3 Buckets
        const encryptionKey = new kms.Key(this, 'VectorBucketKey', {
            description: 'KMS key for S3 vector bucket encryption',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const catalogBucket = new s3.Bucket(this, 'FurnitureCatalogBucket', {
            bucketName: 'furniture-app-bucket',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
        });
        const vectorBucket = new s3Vectors.Bucket(this, 'FurnitureVectorBucket', {
            vectorBucketName: 'furniture-app-vector-bucket',
            encryptionConfiguration: {
                sseType: 'aws:kms',
                kmsKey: encryptionKey,
            },
        });
        const vectorIndex = new s3Vectors.Index(this, 'FurnitureVectorIndex', {
            vectorBucketName: vectorBucket.vectorBucketName,
            indexName: 'furniture-app-index',
            dataType: 'float32',
            dimension: 3072, // Using 3072 for Nova Multimodal Embeddings
            distanceMetric: 'cosine',
        });
        // 2. DynamoDB Table
        const productTable = new dynamodb.Table(this, 'FurnitureProductTable', {
            tableName: 'furniture-app-table',
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // 3. EventBridge Bus
        const eventBus = new events.EventBus(this, 'FurnitureAppEventBus', {
            eventBusName: 'FurnitureAppBus',
        });
        // 4. AppSync API
        const api = new appsync.GraphqlApi(this, 'FurnitureApi', {
            name: 'FurnitureApi',
            definition: appsync.Definition.fromFile(path.join(__dirname, '../schema/schema.graphql')),
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: appsync.AuthorizationType.API_KEY,
                },
            },
            logConfig: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
            },
        });
        // 5. Lambda Functions
        const pythonRuntime = lambda.Runtime.PYTHON_3_11;
        // a. Presigned URL Lambda
        const getUploadUrlLambda = new lambda.Function(this, 'GetUploadUrlLambda', {
            runtime: pythonRuntime,
            handler: 'get_upload_url_lambda.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
            environment: {
                BUCKET_NAME: catalogBucket.bucketName,
            },
        });
        catalogBucket.grantWrite(getUploadUrlLambda);
        // b. Catalog Trigger Lambda (Starts Step Functions)
        const catalogTriggerLambda = new lambda.Function(this, 'CatalogTriggerLambda', {
            runtime: pythonRuntime,
            handler: 'catalog_trigger_lambda.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
        });
        // c. Visual Search Trigger Lambda (Nova -> Vector -> EventBridge)
        const visualSearchTriggerLambda = new lambda.Function(this, 'VisualSearchTriggerLambda', {
            runtime: pythonRuntime,
            handler: 'visual_search_trigger_lambda.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
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
            actions: ['s3:GetObject', 's3:ListBucket', 's3vectors:GetVectors', 's3vectors:SearchVectors'],
            resources: ['*'],
        }));
        api.grantMutation(visualSearchTriggerLambda);
        eventBus.grantPutEventsTo(visualSearchTriggerLambda);
        visualSearchTriggerLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 's3vectors:QueryVectors'],
            resources: ['*'],
        }));
        // d. EventBridge to AppSync Bridge Lambda
        const appsyncBridgeLambda = new lambda.Function(this, 'AppSyncBridgeLambda', {
            runtime: pythonRuntime,
            handler: 'eventbridge_appsync_bridge.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
            environment: {
                GRAPHQL_API_URL: api.graphqlUrl,
            },
        });
        api.grantMutation(appsyncBridgeLambda);
        // f. Process Images Lambda (Called by Step Functions)
        const processImagesLambda = new lambda.Function(this, 'ProcessImagesLambda', {
            runtime: pythonRuntime,
            handler: 'process_images.lambda_handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
            environment: {
                SOURCE_BUCKET: catalogBucket.bucketName,
                VECTOR_BUCKET: vectorBucket.vectorBucketName,
                VECTOR_INDEX: vectorIndex.indexName,
                DYNAMODB_TABLE: productTable.tableName,
            },
        });
        catalogBucket.grantReadWrite(processImagesLambda);
        productTable.grantReadWriteData(processImagesLambda);
        processImagesLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3:GetObject', 's3:ListBucket', 's3vectors:PutVectors'],
            resources: ['*'],
        }));
        encryptionKey.grantEncryptDecrypt(processImagesLambda);
        processImagesLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['s3vectors:PutVectors'],
            resources: ['*'],
        }));
        // 6. Step Functions
        const aslPath = path.join(__dirname, '../workflow/furniture_app_workflow.asl.json');
        if (fs.existsSync(aslPath)) {
            let aslContent = fs.readFileSync(aslPath, 'utf8');
            // Inject dynamic Lambda ARN into ASL
            aslContent = aslContent.replace(/\"Resource\": \"arn:aws:lambda:us-east-1:132260253285:function:process-furniture-app-images\"/g, `"Resource": "arn:aws:states:::lambda:invoke"` // The resource type is already correct, but we need to pass FunctionName
            );
            // Actually, the ASL has "Resource": "arn:aws:states:::lambda:invoke" and "Arguments": { "FunctionName": "..." }
            aslContent = aslContent.replace(/\"FunctionName\": \"arn:aws:lambda:us-east-1:132260253285:function:process-furniture-app-images\"/g, `"FunctionName": "${processImagesLambda.functionArn}"`);
            const stateMachine = new sfn.StateMachine(this, 'FurnitureAppWorkflow', {
                definitionBody: sfn.DefinitionBody.fromString(aslContent),
            });
            catalogBucket.grantReadWrite(stateMachine);
            stateMachine.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
                actions: ['bedrock:InvokeModel', 'bedrock:StartAsyncInvoke', 'bedrock:GetAsyncInvoke'],
                resources: ['*'],
            }));
            catalogTriggerLambda.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
            stateMachine.grantStartExecution(catalogTriggerLambda);
            new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });
        }
        // 7. EventBridge Rule for results
        const resultRule = new events.Rule(this, 'VisualSearchResultRule', {
            eventBus: eventBus,
            eventPattern: {
                source: ['com.furniture.search'],
                detailType: ['VisualSearchResult'],
            },
        });
        resultRule.addTarget(new targets.LambdaFunction(appsyncBridgeLambda));
        // 8. S3 Triggers
        catalogBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(catalogTriggerLambda), { prefix: 'catalog/' });
        catalogBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(visualSearchTriggerLambda), { prefix: 'visuals/' });
        // 9. AppSync Resolvers
        const getUploadUrlDS = api.addLambdaDataSource('GetUploadUrlDS', getUploadUrlLambda);
        getUploadUrlDS.createResolver('GetUploadUrlResolver', {
            typeName: 'Mutation',
            fieldName: 'getUploadUrl',
        });
        // e. Agent Runtime Lambda (Strands + AgentCore)
        const agentRuntimeLambda = new lambda.Function(this, 'AgentRuntimeLambda', {
            runtime: pythonRuntime,
            handler: 'agent_runtime.agent_invocation',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
            environment: {
                DYNAMODB_TABLE: productTable.tableName,
            },
            timeout: cdk.Duration.minutes(5), // Agent might need more time for reasoning
        });
        productTable.grantReadWriteData(agentRuntimeLambda);
        agentRuntimeLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: ['*'],
        }));
        // Output values
        new cdk.CfnOutput(this, 'GraphQLAPIURL', { value: api.graphqlUrl });
        new cdk.CfnOutput(this, 'GraphQLAPIKey', { value: api.apiKey || '' });
        new cdk.CfnOutput(this, 'CatalogBucketName', { value: catalogBucket.bucketName });
        new cdk.CfnOutput(this, 'AgentRuntimeLambdaArn', { value: agentRuntimeLambda.functionArn });
    }
}
exports.FurnitureAppStack = FurnitureAppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnVybml0dXJlLWFwcC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImZ1cm5pdHVyZS1hcHAtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLHlDQUF5QztBQUN6QyxxREFBcUQ7QUFDckQsbURBQW1EO0FBQ25ELGlEQUFpRDtBQUNqRCxpREFBaUQ7QUFDakQscURBQXFEO0FBQ3JELDBEQUEwRDtBQUMxRCx3REFBd0Q7QUFDeEQsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw0Q0FBNEM7QUFFNUMsNkJBQTZCO0FBQzdCLHlCQUF5QjtBQUl6QixNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsK0JBQStCO1FBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekQsV0FBVyxFQUFFLHlDQUF5QztZQUN0RCxpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxhQUFhLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRTtZQUNsRSxVQUFVLEVBQUUsc0JBQXNCO1lBQ2xDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87WUFDeEMsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixVQUFVLEVBQUUsRUFBRSxDQUFDLGdCQUFnQixDQUFDLFVBQVU7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsTUFBTSxZQUFZLEdBQUcsSUFBSSxTQUFTLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN2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QUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxNQUFNLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUN0RSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFLEVBQUUsS0FBSyxFQUFFLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQ2xGLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUUsRUFBRSxLQUFLLEVBQUUsa0JBQWtCLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUU5RixDQUFDO0NBQ0Y7QUF4T0QsOENBd09DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgYXBwc3luYyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBwc3luYyc7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzZm4gZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0ICogYXMgczNuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1ub3RpZmljYXRpb25zJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzVmVjdG9ycyBmcm9tICdjZGstczMtdmVjdG9ycyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5cblxuXG5leHBvcnQgY2xhc3MgRnVybml0dXJlQXBwU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyAxLiBFbmNyeXB0aW9uIGFuZCBTMyBCdWNrZXRzXG4gICAgY29uc3QgZW5jcnlwdGlvbktleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdWZWN0b3JCdWNrZXRLZXknLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBrZXkgZm9yIFMzIHZlY3RvciBidWNrZXQgZW5jcnlwdGlvbicsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICBjb25zdCBjYXRhbG9nQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnRnVybml0dXJlQ2F0YWxvZ0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6ICdmdXJuaXR1cmUtYXBwLWJ1Y2tldCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgfSk7XG5cbiAgICBjb25zdCB2ZWN0b3JCdWNrZXQgPSBuZXcgczNWZWN0b3JzLkJ1Y2tldCh0aGlzLCAnRnVybml0dXJlVmVjdG9yQnVja2V0Jywge1xuICAgICAgdmVjdG9yQnVja2V0TmFtZTogJ2Z1cm5pdHVyZS1hcHAtdmVjdG9yLWJ1Y2tldCcsXG4gICAgICBlbmNyeXB0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBzc2VUeXBlOiAnYXdzOmttcycsXG4gICAgICAgIGttc0tleTogZW5jcnlwdGlvbktleSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCB2ZWN0b3JJbmRleCA9IG5ldyBzM1ZlY3RvcnMuSW5kZXgodGhpcywgJ0Z1cm5pdHVyZVZlY3RvckluZGV4Jywge1xuICAgICAgdmVjdG9yQnVja2V0TmFtZTogdmVjdG9yQnVja2V0LnZlY3RvckJ1Y2tldE5hbWUsXG4gICAgICBpbmRleE5hbWU6ICdmdXJuaXR1cmUtYXBwLWluZGV4JyxcbiAgICAgIGRhdGFUeXBlOiAnZmxvYXQzMicsXG4gICAgICBkaW1lbnNpb246IDMwNzIsIC8vIFVzaW5nIDMwNzIgZm9yIE5vdmEgTXVsdGltb2RhbCBFbWJlZGRpbmdzXG4gICAgICBkaXN0YW5jZU1ldHJpYzogJ2Nvc2luZScsXG4gICAgfSk7XG5cblxuXG4gICAgLy8gMi4gRHluYW1vREIgVGFibGVcbiAgICBjb25zdCBwcm9kdWN0VGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0Z1cm5pdHVyZVByb2R1Y3RUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ2Z1cm5pdHVyZS1hcHAtdGFibGUnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdQSycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdTSycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIDMuIEV2ZW50QnJpZGdlIEJ1c1xuICAgIGNvbnN0IGV2ZW50QnVzID0gbmV3IGV2ZW50cy5FdmVudEJ1cyh0aGlzLCAnRnVybml0dXJlQXBwRXZlbnRCdXMnLCB7XG4gICAgICBldmVudEJ1c05hbWU6ICdGdXJuaXR1cmVBcHBCdXMnLFxuICAgIH0pO1xuXG4gICAgLy8gNC4gQXBwU3luYyBBUElcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBwc3luYy5HcmFwaHFsQXBpKHRoaXMsICdGdXJuaXR1cmVBcGknLCB7XG4gICAgICBuYW1lOiAnRnVybml0dXJlQXBpJyxcbiAgICAgIGRlZmluaXRpb246IGFwcHN5bmMuRGVmaW5pdGlvbi5mcm9tRmlsZShwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc2NoZW1hL3NjaGVtYS5ncmFwaHFsJykpLFxuICAgICAgYXV0aG9yaXphdGlvbkNvbmZpZzoge1xuICAgICAgICBkZWZhdWx0QXV0aG9yaXphdGlvbjoge1xuICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcHBzeW5jLkF1dGhvcml6YXRpb25UeXBlLkFQSV9LRVksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgbG9nQ29uZmlnOiB7XG4gICAgICAgIGZpZWxkTG9nTGV2ZWw6IGFwcHN5bmMuRmllbGRMb2dMZXZlbC5BTEwsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gNS4gTGFtYmRhIEZ1bmN0aW9uc1xuICAgIGNvbnN0IHB5dGhvblJ1bnRpbWUgPSBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMTtcblxuICAgIC8vIGEuIFByZXNpZ25lZCBVUkwgTGFtYmRhXG4gICAgY29uc3QgZ2V0VXBsb2FkVXJsTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnR2V0VXBsb2FkVXJsTGFtYmRhJywge1xuICAgICAgcnVudGltZTogcHl0aG9uUnVudGltZSxcbiAgICAgIGhhbmRsZXI6ICdnZXRfdXBsb2FkX3VybF9sYW1iZGEubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEnKSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBCVUNLRVRfTkFNRTogY2F0YWxvZ0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBjYXRhbG9nQnVja2V0LmdyYW50V3JpdGUoZ2V0VXBsb2FkVXJsTGFtYmRhKTtcblxuICAgIC8vIGIuIENhdGFsb2cgVHJpZ2dlciBMYW1iZGEgKFN0YXJ0cyBTdGVwIEZ1bmN0aW9ucylcbiAgICBjb25zdCBjYXRhbG9nVHJpZ2dlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NhdGFsb2dUcmlnZ2VyTGFtYmRhJywge1xuICAgICAgcnVudGltZTogcHl0aG9uUnVudGltZSxcbiAgICAgIGhhbmRsZXI6ICdjYXRhbG9nX3RyaWdnZXJfbGFtYmRhLmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhJykpLFxuICAgIH0pO1xuXG4gICAgLy8gYy4gVmlzdWFsIFNlYXJjaCBUcmlnZ2VyIExhbWJkYSAoTm92YSAtPiBWZWN0b3IgLT4gRXZlbnRCcmlkZ2UpXG4gICAgY29uc3QgdmlzdWFsU2VhcmNoVHJpZ2dlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Zpc3VhbFNlYXJjaFRyaWdnZXJMYW1iZGEnLCB7XG4gICAgICBydW50aW1lOiBweXRob25SdW50aW1lLFxuICAgICAgaGFuZGxlcjogJ3Zpc3VhbF9zZWFyY2hfdHJpZ2dlcl9sYW1iZGEubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEnKSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBHUkFQSFFMX0FQSV9VUkw6IGFwaS5ncmFwaHFsVXJsLFxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgICBWRUNUT1JfQlVDS0VUOiB2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZSxcbiAgICAgICAgVkVDVE9SX0lOREVYOiB2ZWN0b3JJbmRleC5pbmRleE5hbWUsXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiBwcm9kdWN0VGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcblxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgIH0pO1xuICAgIHByb2R1Y3RUYWJsZS5ncmFudFJlYWREYXRhKHZpc3VhbFNlYXJjaFRyaWdnZXJMYW1iZGEpO1xuICAgIHZpc3VhbFNlYXJjaFRyaWdnZXJMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOkxpc3RCdWNrZXQnLCAnczN2ZWN0b3JzOkdldFZlY3RvcnMnLCAnczN2ZWN0b3JzOlNlYXJjaFZlY3RvcnMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgYXBpLmdyYW50TXV0YXRpb24odmlzdWFsU2VhcmNoVHJpZ2dlckxhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyh2aXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhKTtcbiAgICB2aXN1YWxTZWFyY2hUcmlnZ2VyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnYmVkcm9jazpJbnZva2VNb2RlbCcsICdzM3ZlY3RvcnM6UXVlcnlWZWN0b3JzJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIGQuIEV2ZW50QnJpZGdlIHRvIEFwcFN5bmMgQnJpZGdlIExhbWJkYVxuICAgIGNvbnN0IGFwcHN5bmNCcmlkZ2VMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcHBTeW5jQnJpZGdlTGFtYmRhJywge1xuICAgICAgcnVudGltZTogcHl0aG9uUnVudGltZSxcbiAgICAgIGhhbmRsZXI6ICdldmVudGJyaWRnZV9hcHBzeW5jX2JyaWRnZS5sYW1iZGFfaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYScpKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEdSQVBIUUxfQVBJX1VSTDogYXBpLmdyYXBocWxVcmwsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGFwaS5ncmFudE11dGF0aW9uKGFwcHN5bmNCcmlkZ2VMYW1iZGEpO1xuXG4gICAgLy8gZi4gUHJvY2VzcyBJbWFnZXMgTGFtYmRhIChDYWxsZWQgYnkgU3RlcCBGdW5jdGlvbnMpXG4gICAgY29uc3QgcHJvY2Vzc0ltYWdlc0xhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Byb2Nlc3NJbWFnZXNMYW1iZGEnLCB7XG4gICAgICBydW50aW1lOiBweXRob25SdW50aW1lLFxuICAgICAgaGFuZGxlcjogJ3Byb2Nlc3NfaW1hZ2VzLmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhJykpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgU09VUkNFX0JVQ0tFVDogY2F0YWxvZ0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBWRUNUT1JfQlVDS0VUOiB2ZWN0b3JCdWNrZXQudmVjdG9yQnVja2V0TmFtZSxcbiAgICAgICAgVkVDVE9SX0lOREVYOiB2ZWN0b3JJbmRleC5pbmRleE5hbWUsXG4gICAgICAgIERZTkFNT0RCX1RBQkxFOiBwcm9kdWN0VGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBjYXRhbG9nQnVja2V0LmdyYW50UmVhZFdyaXRlKHByb2Nlc3NJbWFnZXNMYW1iZGEpO1xuICAgIHByb2R1Y3RUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocHJvY2Vzc0ltYWdlc0xhbWJkYSk7XG4gICAgcHJvY2Vzc0ltYWdlc0xhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCcsICdzM3ZlY3RvcnM6UHV0VmVjdG9ycyddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG4gICAgZW5jcnlwdGlvbktleS5ncmFudEVuY3J5cHREZWNyeXB0KHByb2Nlc3NJbWFnZXNMYW1iZGEpO1xuXG4gICAgcHJvY2Vzc0ltYWdlc0xhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGNkay5hd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ3MzdmVjdG9yczpQdXRWZWN0b3JzJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIDYuIFN0ZXAgRnVuY3Rpb25zXG4gICAgY29uc3QgYXNsUGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi93b3JrZmxvdy9mdXJuaXR1cmVfYXBwX3dvcmtmbG93LmFzbC5qc29uJyk7XG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoYXNsUGF0aCkpIHtcbiAgICAgIGxldCBhc2xDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGFzbFBhdGgsICd1dGY4Jyk7XG4gICAgICBcbiAgICAgIC8vIEluamVjdCBkeW5hbWljIExhbWJkYSBBUk4gaW50byBBU0xcbiAgICAgIGFzbENvbnRlbnQgPSBhc2xDb250ZW50LnJlcGxhY2UoXG4gICAgICAgIC9cXFwiUmVzb3VyY2VcXFwiOiBcXFwiYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEzMjI2MDI1MzI4NTpmdW5jdGlvbjpwcm9jZXNzLWZ1cm5pdHVyZS1hcHAtaW1hZ2VzXFxcIi9nLFxuICAgICAgICBgXCJSZXNvdXJjZVwiOiBcImFybjphd3M6c3RhdGVzOjo6bGFtYmRhOmludm9rZVwiYCAvLyBUaGUgcmVzb3VyY2UgdHlwZSBpcyBhbHJlYWR5IGNvcnJlY3QsIGJ1dCB3ZSBuZWVkIHRvIHBhc3MgRnVuY3Rpb25OYW1lXG4gICAgICApO1xuICAgICAgLy8gQWN0dWFsbHksIHRoZSBBU0wgaGFzIFwiUmVzb3VyY2VcIjogXCJhcm46YXdzOnN0YXRlczo6OmxhbWJkYTppbnZva2VcIiBhbmQgXCJBcmd1bWVudHNcIjogeyBcIkZ1bmN0aW9uTmFtZVwiOiBcIi4uLlwiIH1cbiAgICAgIGFzbENvbnRlbnQgPSBhc2xDb250ZW50LnJlcGxhY2UoXG4gICAgICAgIC9cXFwiRnVuY3Rpb25OYW1lXFxcIjogXFxcImFybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMzIyNjAyNTMyODU6ZnVuY3Rpb246cHJvY2Vzcy1mdXJuaXR1cmUtYXBwLWltYWdlc1xcXCIvZyxcbiAgICAgICAgYFwiRnVuY3Rpb25OYW1lXCI6IFwiJHtwcm9jZXNzSW1hZ2VzTGFtYmRhLmZ1bmN0aW9uQXJufVwiYFxuICAgICAgKTtcblxuICAgICAgY29uc3Qgc3RhdGVNYWNoaW5lID0gbmV3IHNmbi5TdGF0ZU1hY2hpbmUodGhpcywgJ0Z1cm5pdHVyZUFwcFdvcmtmbG93Jywge1xuICAgICAgICBkZWZpbml0aW9uQm9keTogc2ZuLkRlZmluaXRpb25Cb2R5LmZyb21TdHJpbmcoYXNsQ29udGVudCksXG4gICAgICB9KTtcbiAgICAgIGNhdGFsb2dCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoc3RhdGVNYWNoaW5lKTtcbiAgICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGNkay5hd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnYmVkcm9jazpJbnZva2VNb2RlbCcsICdiZWRyb2NrOlN0YXJ0QXN5bmNJbnZva2UnLCAnYmVkcm9jazpHZXRBc3luY0ludm9rZSddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSkpO1xuICAgICAgY2F0YWxvZ1RyaWdnZXJMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1NUQVRFX01BQ0hJTkVfQVJOJywgc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybik7XG4gICAgICBzdGF0ZU1hY2hpbmUuZ3JhbnRTdGFydEV4ZWN1dGlvbihjYXRhbG9nVHJpZ2dlckxhbWJkYSk7XG4gICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RhdGVNYWNoaW5lQXJuJywgeyB2YWx1ZTogc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybiB9KTtcbiAgICB9XG5cblxuICAgIC8vIDcuIEV2ZW50QnJpZGdlIFJ1bGUgZm9yIHJlc3VsdHNcbiAgICBjb25zdCByZXN1bHRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdWaXN1YWxTZWFyY2hSZXN1bHRSdWxlJywge1xuICAgICAgZXZlbnRCdXM6IGV2ZW50QnVzLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogWydjb20uZnVybml0dXJlLnNlYXJjaCddLFxuICAgICAgICBkZXRhaWxUeXBlOiBbJ1Zpc3VhbFNlYXJjaFJlc3VsdCddLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICByZXN1bHRSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihhcHBzeW5jQnJpZGdlTGFtYmRhKSk7XG5cbiAgICAvLyA4LiBTMyBUcmlnZ2Vyc1xuICAgIGNhdGFsb2dCdWNrZXQuYWRkRXZlbnROb3RpZmljYXRpb24oXG4gICAgICBzMy5FdmVudFR5cGUuT0JKRUNUX0NSRUFURUQsXG4gICAgICBuZXcgczNuLkxhbWJkYURlc3RpbmF0aW9uKGNhdGFsb2dUcmlnZ2VyTGFtYmRhKSxcbiAgICAgIHsgcHJlZml4OiAnY2F0YWxvZy8nIH1cbiAgICApO1xuXG4gICAgY2F0YWxvZ0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRCxcbiAgICAgIG5ldyBzM24uTGFtYmRhRGVzdGluYXRpb24odmlzdWFsU2VhcmNoVHJpZ2dlckxhbWJkYSksXG4gICAgICB7IHByZWZpeDogJ3Zpc3VhbHMvJyB9XG4gICAgKTtcblxuICAgIC8vIDkuIEFwcFN5bmMgUmVzb2x2ZXJzXG4gICAgY29uc3QgZ2V0VXBsb2FkVXJsRFMgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnR2V0VXBsb2FkVXJsRFMnLCBnZXRVcGxvYWRVcmxMYW1iZGEpO1xuICAgIGdldFVwbG9hZFVybERTLmNyZWF0ZVJlc29sdmVyKCdHZXRVcGxvYWRVcmxSZXNvbHZlcicsIHtcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxuICAgICAgZmllbGROYW1lOiAnZ2V0VXBsb2FkVXJsJyxcbiAgICB9KTtcblxuICAgIC8vIGUuIEFnZW50IFJ1bnRpbWUgTGFtYmRhIChTdHJhbmRzICsgQWdlbnRDb3JlKVxuICAgIGNvbnN0IGFnZW50UnVudGltZUxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0FnZW50UnVudGltZUxhbWJkYScsIHtcbiAgICAgIHJ1bnRpbWU6IHB5dGhvblJ1bnRpbWUsXG4gICAgICBoYW5kbGVyOiAnYWdlbnRfcnVudGltZS5hZ2VudF9pbnZvY2F0aW9uJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhJykpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRFlOQU1PREJfVEFCTEU6IHByb2R1Y3RUYWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksIC8vIEFnZW50IG1pZ2h0IG5lZWQgbW9yZSB0aW1lIGZvciByZWFzb25pbmdcbiAgICB9KTtcbiAgICBwcm9kdWN0VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFnZW50UnVudGltZUxhbWJkYSk7XG4gICAgYWdlbnRSdW50aW1lTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnYmVkcm9jazpJbnZva2VNb2RlbCcsICdiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIE91dHB1dCB2YWx1ZXNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR3JhcGhRTEFQSVVSTCcsIHsgdmFsdWU6IGFwaS5ncmFwaHFsVXJsIH0pO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMQVBJS2V5JywgeyB2YWx1ZTogYXBpLmFwaUtleSB8fCAnJyB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2F0YWxvZ0J1Y2tldE5hbWUnLCB7IHZhbHVlOiBjYXRhbG9nQnVja2V0LmJ1Y2tldE5hbWUgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50UnVudGltZUxhbWJkYUFybicsIHsgdmFsdWU6IGFnZW50UnVudGltZUxhbWJkYS5mdW5jdGlvbkFybiB9KTtcblxuICB9XG59XG4iXX0=