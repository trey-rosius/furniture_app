import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as targets from 'aws-cdk-lib/aws-events-targets';

// No aliased target needed if we use targets.AppSync directly
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import * as s3Vectors from 'cdk-s3-vectors';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';



export class FurnitureAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Encryption and S3 Buckets
    const encryptionKey = new kms.Key(this, 'VectorBucketKey', {
      description: 'KMS key for S3 vector bucket encryption',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const catalogBucket = new s3.Bucket(this, 'FurnitureCatalogBucket', {
      bucketName: 'furniture-app-catalog-v2',
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
          allowedOrigins: ['*'], // In production, restrict to your domain
          allowedHeaders: ['*'],
          exposedHeaders: [],
        },
      ],
    });

    const vectorBucket = new s3Vectors.Bucket(this, 'FurnitureVectorBucket', {
      vectorBucketName: 'furniture-app-vector-v2',
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
      tableName: 'furniture-app-table-v2',
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
    const api = new appsync.GraphqlApi(this, 'FurnitureGraphqlApi', {
      name: 'FurnitureApi',
      definition: appsync.Definition.fromFile(path.join(__dirname, '../schema/schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
        },
        additionalAuthorizationModes: [
          {
            authorizationType: appsync.AuthorizationType.IAM,
          },
        ],
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
      },
    });

    // 5. Lambda Functions
    const pythonRuntime = (lambda.Runtime as any).PYTHON_3_13;

    // a. Presigned URL Lambda
    const getUploadUrlLambda = new PythonFunction(this, 'GetUploadUrlLambda', {
      entry: path.join(__dirname, '../lambda'),
      index: 'get_upload_url_lambda.py',
      handler: 'lambda_handler',
      runtime: pythonRuntime,
      environment: {
        BUCKET_NAME: catalogBucket.bucketName,
      },
    });
    catalogBucket.grantWrite(getUploadUrlLambda);

    // b. Catalog Trigger Lambda (Starts Step Functions)
    const catalogTriggerLambda = new PythonFunction(this, 'CatalogTriggerLambda', {
      entry: path.join(__dirname, '../lambda'),
      index: 'catalog_trigger_lambda.py',
      handler: 'lambda_handler',
      runtime: pythonRuntime,
    });

    // c. Visual Search Trigger Lambda (Nova -> Vector -> EventBridge)
    const visualSearchTriggerLambda = new PythonFunction(this, 'VisualSearchTriggerLambda', {
      entry: path.join(__dirname, '../lambda'),
      index: 'visual_search_trigger_lambda.py',
      handler: 'lambda_handler',
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
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [
        `arn:aws:s3:::${catalogBucket.bucketName}`,
        `arn:aws:s3:::${catalogBucket.bucketName}/*`,
        `arn:aws:s3:::${vectorBucket.vectorBucketName}`,
        `arn:aws:s3:::${vectorBucket.vectorBucketName}/*`
      ],
    }));
   

    api.grantMutation(visualSearchTriggerLambda);
    eventBus.grantPutEventsTo(visualSearchTriggerLambda);
    visualSearchTriggerLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-2-multimodal-embeddings-v1:0`],
    }));
    

    // d. Batch Get Item Lambda (Used by Search Workflow)
    const batchGetItemLambda = new PythonFunction(this, 'BatchGetItemLambda', {
      entry: path.join(__dirname, '../lambda'),
      index: 'batch_get_item_lambda.py',
      handler: 'lambda_handler',
      runtime: pythonRuntime,
      environment: {
        DYNAMODB_TABLE: productTable.tableName,
      },
    });
    productTable.grantReadData(batchGetItemLambda);

    // e. Durable Visual Search Workflow Lambda
    const visualSearchWorkflow = new PythonFunction(this, 'VisualSearchWorkflow', {
      functionName: 'furniture-visual-search-workflow',
      entry: path.join(__dirname, '../lambda'),
      index: 'visual_search_workflow.py',
      handler: 'lambda_handler',
       runtime: pythonRuntime,
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
        'lambda:CheckpointDurableExecutions',
        'lambda:GetDurableExecutionState',
        'lambda:SendDurableExecutionCallbackSuccess',
        'lambda:SendDurableExecutionCallbackFailure',
      ],
      resources: ["*"],
    }));
    const version = visualSearchWorkflow.currentVersion;
       const alias = new lambda.Alias(this, 'ProdAlias', {
         aliasName: 'dev',
         version: version,
       });
   

    batchGetItemLambda.grantInvoke(visualSearchWorkflow);
    visualSearchWorkflow.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-2-multimodal-embeddings-v1:0`],
    }));
    visualSearchWorkflow.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3vectors:QueryVectors','s3vectors:GetVectors'],
      resources: [
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucket.vectorBucketName}/index/${vectorIndex.indexName}`
      ],
    }));
    visualSearchWorkflow.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [
        `arn:aws:s3:::${catalogBucket.bucketName}/*`,
        `arn:aws:s3:::${vectorBucket.vectorBucketName}/*`
      ],
    }));
    encryptionKey.grantDecrypt(visualSearchWorkflow);
    productTable.grantReadData(visualSearchWorkflow)
    eventBus.grantPutEventsTo(visualSearchWorkflow);

    // Update Visual Search Trigger to use the Durable Workflow
    visualSearchTriggerLambda.addEnvironment('DURABLE_FUNCTION_ARN', `${visualSearchWorkflow.functionArn}:${alias.aliasName}`);
    visualSearchTriggerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`${visualSearchWorkflow.functionArn}:${alias.aliasName}`],
    }));

    // f. Process Images Lambda (Called by Step Functions)
    const processImagesLambda = new PythonFunction(this, 'ProcessImagesLambda', {
      functionName: 'furniture-process-images',
      entry: path.join(__dirname, '../lambda'),
      index: 'process_images.py',
      handler: 'lambda_handler',
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
      actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 'kms:GenerateDataKey', 'kms:Decrypt'],
      resources: [
        'arn:aws:s3:::furniture-app-catalog-v2',
        'arn:aws:s3:::furniture-app-catalog-v2/*',
        `arn:aws:s3:::${vectorBucket.vectorBucketName}`,
        `arn:aws:s3:::${vectorBucket.vectorBucketName}/*`
      ],
    }));
    productTable.grantReadWriteData(processImagesLambda);
    processImagesLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3vectors:PutVectors'],
      resources: [
        `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${vectorBucket.vectorBucketName}/index/${vectorIndex.indexName}`
      ],
    }));
    encryptionKey.grantEncryptDecrypt(processImagesLambda);



    const stateMachine = new sfn.StateMachine(this, 'FurnitureAppWorkflow', {
      stateMachineName: 'furniture-app-workflow-v2',
      definitionBody: sfn.DefinitionBody.fromFile(path.join(__dirname, '../workflow/furniture_app_workflow.asl.json')),
      definitionSubstitutions: {
        BUCKET_NAME: catalogBucket.bucketName,
        FUNCTION_ARN: `arn:aws:lambda:${this.region}:${this.account}:function:furniture-process-images`,
      },
    });

    processImagesLambda.grantInvoke(stateMachine);
    
    // Break circular dependency by using string ARNs
    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
      resources: [
        `arn:aws:s3:::${catalogBucket.bucketName}`,
        `arn:aws:s3:::${catalogBucket.bucketName}/*`
      ],
    }));
      stateMachine.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:StartAsyncInvoke', 'bedrock:GetAsyncInvoke'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-2-multimodal-embeddings-v1:0`,
          `arn:aws:bedrock:${this.region}:${this.account}:async-invoke/*`
        ],
      }));
      stateMachine.addToRolePolicy(new iam.PolicyStatement({
        actions: ['states:StartExecution', 'states:DescribeExecution', 'states:StopExecution'],
        resources: [
          `arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2`,
          `arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2:*`
        ],
      }));
      stateMachine.addToRolePolicy(new iam.PolicyStatement({
        actions: ['states:DescribeMapRun', 'states:ListMapRuns', 'states:UpdateMapRun'],
        resources: [`arn:aws:states:${this.region}:${this.account}:mapRun:furniture-app-workflow-v2/*`],
      }));
    catalogTriggerLambda.addEnvironment('STATE_MACHINE_ARN', `arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2`);
    catalogTriggerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:furniture-app-workflow-v2`],
    }));
    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });


    // 7. Direct EventBridge to AppSync Bridge
    const appSyncEventBridgeRole = new iam.Role(this, "AppSyncEventBridgeRole", {
      assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
      description: "Role for EventBridge to invoke AppSync mutations",
    });

    appSyncEventBridgeRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["appsync:GraphQL"],
        resources: [`${api.arn}/types/Mutation/*`],
      })
    );

    const resultRule = new events.Rule(this, 'VisualSearchResultRule', {
      eventBus: eventBus,
      eventPattern: {
        source: ['com.furniture.search'],
        detailType: ['VisualSearchResult'],
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

    new cdk.aws_logs.LogGroup(this, 'FurnitureAppBusLogs', {
      logGroupName: `/aws/events/${eventBus.eventBusName}/logs`,
      retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    
    catalogBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(visualSearchTriggerLambda),
      { prefix: 'visuals/' }
    );

    // 9. AppSync Resolvers
    const getUploadUrlDS = api.addLambdaDataSource('GetUploadUrlDS', getUploadUrlLambda);
    getUploadUrlDS.createResolver('GetUploadUrlResolver', {
      typeName: 'Mutation',
      fieldName: 'getUploadUrl',
    });

    const triggerCatalogDS = api.addLambdaDataSource('TriggerCatalogDS', catalogTriggerLambda);
    triggerCatalogDS.createResolver('TriggerCatalogResolver', {
      typeName: 'Mutation',
      fieldName: 'triggerCatalogProcessing',
    });

    const noneDS = api.addNoneDataSource('NoneDS');
    api.createResolver('PushSearchResultResolver', {
      typeName: 'Mutation',
      fieldName: 'pushSearchResult',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      dataSource: noneDS,
      code: appsync.Code.fromAsset(path.join(__dirname, '../resolvers/pushSearchResult.js')),
    });

    // e. Agent Runtime Lambda (Strands + AgentCore)
    const agentRuntimeLambda = new PythonFunction(this, 'AgentRuntimeLambda', {
      entry: path.join(__dirname, '../lambda'),
      index: 'agent_runtime.py',
      handler: 'agent_invocation',
      runtime: pythonRuntime,
      environment: {
        DYNAMODB_TABLE: productTable.tableName,
      },
      timeout: cdk.Duration.minutes(5),
    });
    productTable.grantReadWriteData(agentRuntimeLambda);
    agentRuntimeLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`], 
    }));

    // f. AgentCore Tools Lambda
    const agentCoreToolsLambda = new PythonFunction(this, 'AgentCoreToolsLambda', {
      entry: path.join(__dirname, '../lambda'),
      index: 'agentcore_tools.py',
      handler: 'lambda_handler',
      runtime: pythonRuntime,
      environment: {
        DYNAMODB_TABLE: productTable.tableName,
      },
      timeout: cdk.Duration.minutes(1),
    });
    productTable.grantReadData(agentCoreToolsLambda);
    // Note: create_order is mocked, but we might eventually need write access
    productTable.grantReadWriteData(agentCoreToolsLambda);

    // g. AppSync Agent Resolver Lambda
    const appsyncAgentResolverLambda = new PythonFunction(this, 'AppsyncAgentResolverLambda', {
      entry: path.join(__dirname, '../lambda'),
      index: 'appsync_agent_resolver.py',
      handler: 'handler',
      runtime: pythonRuntime,
      environment: {
        AGENT_ARN: 'arn:aws:bedrock-agentcore:us-east-1:132260253285:runtime/furnitureagent-6hUMr6H0ic',
      },
      timeout: cdk.Duration.minutes(1),
    });

    appsyncAgentResolverLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: ['*'],
    }));

    const agentDS = api.addLambdaDataSource('agentDS', appsyncAgentResolverLambda);
    api.createResolver('invokeAgentResolver', {
      typeName: 'Mutation',
      fieldName: 'invokeAgent',
      dataSource: agentDS,
    });

    // Output values
    new cdk.CfnOutput(this, 'GraphQLAPIURL', { value: api.graphqlUrl });
    new cdk.CfnOutput(this, 'GraphQLAPIKey', { value: api.apiKey || '' });
    new cdk.CfnOutput(this, 'CatalogBucketName', { value: catalogBucket.bucketName });
    new cdk.CfnOutput(this, 'AgentRuntimeLambdaArn', { value: agentRuntimeLambda.functionArn });
    new cdk.CfnOutput(this, 'AgentCoreToolsLambdaArn', { value: agentCoreToolsLambda.functionArn });

  }
}
