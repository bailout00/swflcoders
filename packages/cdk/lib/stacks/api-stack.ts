import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { StageConfig } from '../config';

export interface SwflcodersStackProps extends cdk.StackProps {
  stageConfig: StageConfig;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SwflcodersStackProps) {
    super(scope, id, props);

    const { stageConfig } = props;
    const isProd = stageConfig.environment === 'prod';

    // === DynamoDB Tables ===
    
    // Chat Rooms Table
    const chatRoomsTable = new dynamodb.Table(this, 'ChatRoomsTable', {
      tableName: `chat-rooms-${stageConfig.name}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Chat Messages Table (with DynamoDB Streams for real-time broadcasting)
    const chatMessagesTable = new dynamodb.Table(this, 'ChatMessagesTable', {
      tableName: `chat-messages-${stageConfig.name}`,
      partitionKey: { name: 'room_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ts', type: dynamodb.AttributeType.NUMBER },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Chat Connections Table (for WebSocket client management)
    const chatConnectionsTable = new dynamodb.Table(this, 'ChatConnectionsTable', {
      tableName: `chat-connections-${stageConfig.name}`,
      partitionKey: { name: 'connection_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      // TTL for automatic cleanup of old connections
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for querying connections by room
    chatConnectionsTable.addGlobalSecondaryIndex({
      indexName: 'room-index',
      partitionKey: { name: 'room_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'connected_at', type: dynamodb.AttributeType.NUMBER },
    });

    // Seed default "general" room on deployment
    new cr.AwsCustomResource(this, 'SeedGeneralRoom', {
      onCreate: {
        service: 'DynamoDB',
        action: 'putItem',
        parameters: {
          TableName: chatRoomsTable.tableName,
          Item: {
            id: { S: 'general' },
            name: { S: 'General' },
            created_at_iso: { S: new Date().toISOString() },
            created_at_epoch: { N: `${Date.now()}` },
          },
          ConditionExpression: 'attribute_not_exists(id)',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`SeedGeneralRoom-${stageConfig.name}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [chatRoomsTable.tableArn] }),
    });

    // === Lambda Functions ===

    // Rust Lambda for chat REST endpoints
    const rustChatFn = new lambda.Function(this, 'RustChatFunction', {
      functionName: `rust-chat-${stageConfig.name}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      memorySize: 256,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset('../backend/target/lambda/backend'),
      handler: 'bootstrap',
      environment: {
        CHAT_ROOMS_TABLE: chatRoomsTable.tableName,
        CHAT_MESSAGES_TABLE: chatMessagesTable.tableName,
        STAGE: stageConfig.name,
        DOMAIN: stageConfig.domain,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Grant DynamoDB permissions to Rust Lambda
    chatRoomsTable.grantReadWriteData(rustChatFn);
    chatMessagesTable.grantReadWriteData(rustChatFn);

    // Basic Lambda for health check (keep existing for comparison)
    const healthCheckLambda = new lambda.Function(this, 'HealthCheckFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
              status: 'Healthy',
              version: '0.1.0',
              timestamp: new Date().toISOString(),
              stage: '${stageConfig.name}',
              domain: '${stageConfig.domain}'
            }),
          };
        };
      `),
      environment: {
        STAGE: stageConfig.name,
        DOMAIN: stageConfig.domain,
      },
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'SwflcodersApi', {
      restApiName: `Swflcoders API - ${stageConfig.name}`,
      description: `API for Swflcoders ${stageConfig.name} environment`,
      deployOptions: {
        stageName: stageConfig.apiGatewayStage,
      },
    });

    // Health check endpoint
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', new apigateway.LambdaIntegration(healthCheckLambda));

    // Chat endpoints (using Rust Lambda)
    const chatResource = api.root.addResource('chat');
    const messagesResource = chatResource.addResource('messages');
    
    // POST /chat/messages - Send a message
    messagesResource.addMethod('POST', new apigateway.LambdaIntegration(rustChatFn));
    
    // GET /chat/messages/{room_id} - Retrieve messages
    messagesResource.addResource('{room_id}').addMethod('GET', new apigateway.LambdaIntegration(rustChatFn));

    // === WebSocket API ===
    
    // WebSocket Lambda functions (Rust)
    const onConnectFunction = new lambda.Function(this, 'OnConnectFunction', {
      functionName: `ws-onconnect-${stageConfig.name}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../backend/target/lambda/ws-connect'),
      environment: {
        CONNECTIONS_TABLE: chatConnectionsTable.tableName,
        STAGE: stageConfig.name,
      },
      timeout: cdk.Duration.seconds(10),
    });

    const onDisconnectFunction = new lambda.Function(this, 'OnDisconnectFunction', {
      functionName: `ws-ondisconnect-${stageConfig.name}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../backend/target/lambda/ws-disconnect'),
      environment: {
        CONNECTIONS_TABLE: chatConnectionsTable.tableName,
        STAGE: stageConfig.name,
      },
      timeout: cdk.Duration.seconds(10),
    });

    const defaultFunction = new lambda.Function(this, 'DefaultFunction', {
      functionName: `ws-default-${stageConfig.name}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../backend/target/lambda/ws-default'),
      environment: {
        STAGE: stageConfig.name,
      },
      timeout: cdk.Duration.seconds(10),
    });

    const broadcastFunction = new lambda.Function(this, 'BroadcastFunction', {
      functionName: `ws-broadcast-${stageConfig.name}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../backend/target/lambda/ws-broadcast'),
      environment: {
        CONNECTIONS_TABLE: chatConnectionsTable.tableName,
        STAGE: stageConfig.name,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Grant DynamoDB permissions
    chatConnectionsTable.grantReadWriteData(onConnectFunction);
    chatConnectionsTable.grantReadWriteData(onDisconnectFunction);
    chatConnectionsTable.grantReadWriteData(broadcastFunction);

    // WebSocket API
    const wsApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `Chat WebSocket API - ${stageConfig.name}`,
      description: `WebSocket API for real-time chat - ${stageConfig.name}`,
      connectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          onConnectFunction
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          onDisconnectFunction
        ),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          defaultFunction
        ),
      },
    });

    const wsStage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: wsApi,
      stageName: stageConfig.apiGatewayStage,
      autoDeploy: true,
    });

    // Update broadcast function with WebSocket API details
    broadcastFunction.addEnvironment('WS_API_ID', wsApi.apiId);
    broadcastFunction.addEnvironment('WS_STAGE', wsStage.stageName);

    // Grant WebSocket management permissions to broadcast function
    broadcastFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`],
    }));

    // Add DynamoDB Stream trigger to broadcast function
    broadcastFunction.addEventSource(new lambdaEventSources.DynamoEventSource(chatMessagesTable, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      filters: [
        lambda.FilterCriteria.filter({
          eventName: lambda.FilterRule.isEqual('INSERT'),
        }),
      ],
    }));

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'HealthCheckEndpoint', {
      value: `${api.url}health`,
      description: 'Health check endpoint',
    });

    new cdk.CfnOutput(this, 'Stage', {
      value: stageConfig.name,
      description: 'Deployment stage',
    });

    new cdk.CfnOutput(this, 'Domain', {
      value: stageConfig.domain,
      description: 'Configured domain',
    });

    // DynamoDB table outputs
    new cdk.CfnOutput(this, 'ChatRoomsTableName', {
      value: chatRoomsTable.tableName,
      description: 'Chat rooms DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'ChatMessagesTableName', {
      value: chatMessagesTable.tableName,
      description: 'Chat messages DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'ChatConnectionsTableName', {
      value: chatConnectionsTable.tableName,
      description: 'Chat connections DynamoDB table name',
    });

    // WebSocket API outputs
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: `wss://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
      description: 'WebSocket API URL for real-time chat',
    });
  }
}
