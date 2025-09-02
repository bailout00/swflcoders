import * as cdk from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53targets from 'aws-cdk-lib/aws-route53-targets'
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager'
import type { Construct } from 'constructs'
import { DYNAMODB_TABLES, type StageConfig } from '../config'

export interface SwflcodersStackProps extends cdk.StackProps {
    stageConfig: StageConfig
    hostedZone: route53.IHostedZone
}

export class ApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: SwflcodersStackProps) {
        super(scope, id, props)

        const { stageConfig, hostedZone } = props

        // Reference DynamoDB tables by name (they are created by DbStack)
        const chatRoomsTable = dynamodb.Table.fromTableName(
            this,
            'ChatRoomsTableRef',
            DYNAMODB_TABLES.CHAT_ROOMS
        )

        // Chat messages table with stream enabled (needed for DynamoDB stream trigger)
        // We need to construct the stream ARN since Table.fromTableName doesn't include stream info
        const chatMessagesTableName = DYNAMODB_TABLES.CHAT_MESSAGES
        const chatMessagesStreamArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${chatMessagesTableName}/stream/*`

        const chatMessagesTable = dynamodb.Table.fromTableAttributes(this, 'ChatMessagesTableRef', {
            tableName: chatMessagesTableName,
            tableStreamArn: chatMessagesStreamArn,
        })

        const chatConnectionsTable = dynamodb.Table.fromTableName(
            this,
            'ChatConnectionsTableRef',
            DYNAMODB_TABLES.CHAT_CONNECTIONS
        )

        // === DNS/Certificates for Custom Domains ===
        // Use the hosted zone provided by DNS stack

        // Desired custom domains
        const restCustomDomain = `api.${stageConfig.domain}`
        const wsCustomDomain = `ws.${stageConfig.domain}`

        // Single ACM certificate for both REST and WebSocket custom domains (SANs)
        const apiWsCertificate = new certificatemanager.Certificate(this, 'ApiWsCertificate', {
            domainName: restCustomDomain,
            subjectAlternativeNames: [wsCustomDomain],
            validation: certificatemanager.CertificateValidation.fromDns(hostedZone),
        })

        // === Lambda Functions ===

        // Rust Lambda for chat REST endpoints
        const rustChatFn = new lambda.Function(this, 'RustChatFunction', {
            functionName: `rust-chat-${stageConfig.name}`,
            runtime: lambda.Runtime.PROVIDED_AL2023,
            memorySize: 256,
            architecture: lambda.Architecture.ARM_64,
            code: lambda.Code.fromAsset('../backend/target/lambda/rest'),
            handler: 'bootstrap',
            environment: {
                CHAT_ROOMS_TABLE: chatRoomsTable.tableName,
                CHAT_MESSAGES_TABLE: chatMessagesTable.tableName,
                STAGE: stageConfig.name,
                DOMAIN: stageConfig.domain,
            },
            timeout: cdk.Duration.seconds(30),
        })

        // Grant DynamoDB permissions to Rust Lambda
        chatRoomsTable.grantReadWriteData(rustChatFn)
        chatMessagesTable.grantReadWriteData(rustChatFn)

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
        })

        // HTTP API (API Gateway v2) with custom domain
        const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
            apiName: `Swflcoders HTTP API - ${stageConfig.name}`,
            description: `HTTP API for Swflcoders ${stageConfig.name} environment`,
            createDefaultStage: false,
        })

        const httpStage = new apigatewayv2.HttpStage(this, 'HttpStage', {
            httpApi,
            stageName: stageConfig.apiGatewayStage,
            autoDeploy: true,
        })

        // Health check route
        const healthIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
            'HealthIntegration',
            healthCheckLambda
        )
        httpApi.addRoutes({
            path: '/health',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: healthIntegration,
        })

        // Chat routes (using Rust Lambda)
        const chatIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
            'ChatIntegration',
            rustChatFn
        )
        httpApi.addRoutes({
            path: '/chat/messages',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: chatIntegration,
        })
        httpApi.addRoutes({
            path: '/chat/messages/{room_id}',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: chatIntegration,
        })

        // Custom domain for HTTP API (API Gateway v2)
        const restDomainName = new apigatewayv2.DomainName(this, 'HttpCustomDomainName', {
            domainName: restCustomDomain,
            certificate: apiWsCertificate,
        })

        // Map the custom domain to the HTTP API stage
        new apigatewayv2.ApiMapping(this, 'HttpApiMapping', {
            api: httpApi,
            domainName: restDomainName,
            stage: httpStage,
        })

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
        })

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
        })

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
        })

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
        })

        // Grant DynamoDB permissions
        chatConnectionsTable.grantReadWriteData(onConnectFunction)
        chatConnectionsTable.grantReadWriteData(onDisconnectFunction)
        chatConnectionsTable.grantReadWriteData(broadcastFunction)

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
        })

        const wsStage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
            webSocketApi: wsApi,
            stageName: stageConfig.apiGatewayStage,
            autoDeploy: true,
        })

        // Custom domain for WebSocket API (API Gateway v2)
        const wsDomainName = new apigatewayv2.DomainName(this, 'WebSocketCustomDomainName', {
            domainName: wsCustomDomain,
            certificate: apiWsCertificate,
        })

        // Map the custom domain to the WebSocket API stage
        new apigatewayv2.ApiMapping(this, 'WebSocketApiMapping', {
            api: wsApi,
            domainName: wsDomainName,
            stage: wsStage,
        })

        // Update broadcast function with WebSocket API details
        broadcastFunction.addEnvironment('WS_API_ID', wsApi.apiId)
        broadcastFunction.addEnvironment('WS_STAGE', wsStage.stageName)

        // Note: Dev broadcaster uses per-connection push URLs; no global dev env var needed here

        // Grant WebSocket management permissions to broadcast function
        broadcastFunction.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['execute-api:ManageConnections'],
                resources: [
                    `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
                ],
            })
        )

        // Add DynamoDB Stream trigger to broadcast function
        broadcastFunction.addEventSource(
            new lambdaEventSources.DynamoEventSource(chatMessagesTable, {
                startingPosition: lambda.StartingPosition.LATEST,
                batchSize: 10,
                filters: [
                    lambda.FilterCriteria.filter({
                        eventName: lambda.FilterRule.isEqual('INSERT'),
                    }),
                ],
            })
        )

        // === DNS Records ===
        // REST A-record (api.<domain>) -> API Gateway v2 HTTP custom domain
        new route53.ARecord(this, 'RestApiAliasRecord', {
            zone: hostedZone,
            recordName: 'api',
            target: route53.RecordTarget.fromAlias(
                new route53targets.ApiGatewayv2DomainProperties(
                    restDomainName.regionalDomainName,
                    restDomainName.regionalHostedZoneId
                )
            ),
        })

        // WebSocket A-record (ws.<domain>) -> API Gateway v2 custom domain
        new route53.ARecord(this, 'WebSocketAliasRecord', {
            zone: hostedZone,
            recordName: 'ws',
            target: route53.RecordTarget.fromAlias(
                new route53targets.ApiGatewayv2DomainProperties(
                    wsDomainName.regionalDomainName,
                    wsDomainName.regionalHostedZoneId
                )
            ),
        })

        // Outputs
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: httpApi.apiEndpoint,
            description: 'HTTP API endpoint URL',
        })

        new cdk.CfnOutput(this, 'HealthCheckEndpoint', {
            value: `${httpApi.apiEndpoint}/health`,
            description: 'Health check endpoint',
        })

        new cdk.CfnOutput(this, 'Stage', {
            value: stageConfig.name,
            description: 'Deployment stage',
        })

        new cdk.CfnOutput(this, 'Domain', {
            value: stageConfig.domain,
            description: 'Configured domain',
        })

        // WebSocket API outputs
        new cdk.CfnOutput(this, 'WebSocketUrl', {
            value: `wss://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
            description: 'WebSocket API URL for real-time chat',
        })

        new cdk.CfnOutput(this, 'RestCustomDomain', {
            value: `https://${restCustomDomain}`,
            description: 'Custom domain for HTTP API',
        })

        new cdk.CfnOutput(this, 'WebSocketCustomDomainOutput', {
            value: `wss://${wsCustomDomain}/${wsStage.stageName}`,
            description: 'Custom domain for WebSocket API',
        })
    }
}
