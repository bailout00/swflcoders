import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { StageConfig } from '../config';
import { DbStack } from './db-stack';

export interface SwflcodersStackProps extends cdk.StackProps {
  stageConfig: StageConfig;
  dbStack: DbStack;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SwflcodersStackProps) {
    super(scope, id, props);

    const { stageConfig, dbStack } = props;

    // Get tables from DbStack
    const chatRoomsTable = dbStack.chatRoomsTable;
    const chatMessagesTable = dbStack.chatMessagesTable;
    const chatConnectionsTable = dbStack.chatConnectionsTable;

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



    // WebSocket API outputs
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: `wss://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
      description: 'WebSocket API URL for real-time chat',
    });
  }
}
