import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
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
      code: lambda.Code.fromAsset('../backend', {
        bundling: {
          image: cdk.DockerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:2023'),
          command: [
            'bash', '-lc',
            [
              'yum install -y gcc gcc-c++ openssl-devel pkgconfig zip',
              'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
              'source $HOME/.cargo/env',
              'rustup target add aarch64-unknown-linux-gnu',
              'cargo build --release --target aarch64-unknown-linux-gnu -p backend',
              'cp target/aarch64-unknown-linux-gnu/release/backend bootstrap',
              'zip -j /asset-output/function.zip bootstrap'
            ].join(' && ')
          ],
        },
      }),
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
    new cdk.CfnOutput(this, 'ChatRoomsTable', {
      value: chatRoomsTable.tableName,
      description: 'Chat rooms DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'ChatMessagesTable', {
      value: chatMessagesTable.tableName,
      description: 'Chat messages DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'ChatConnectionsTable', {
      value: chatConnectionsTable.tableName,
      description: 'Chat connections DynamoDB table name',
    });
  }
}
