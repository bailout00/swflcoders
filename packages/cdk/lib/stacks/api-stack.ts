import * as cdk from 'aws-cdk-lib'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53targets from 'aws-cdk-lib/aws-route53-targets'
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager'
import type { Construct } from 'constructs'
import { DYNAMODB_TABLES, DYNAMODB_ARNS, type StageConfig } from '../config'
import type { DbStack } from './db-stack'
import { CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2'

export interface SwflcodersStackProps extends cdk.StackProps {
    stageConfig: StageConfig
    hostedZone: route53.IHostedZone
    dbStack: DbStack
}

export class ApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: SwflcodersStackProps) {
        super(scope, id, props)

        const { stageConfig, hostedZone, dbStack } = props

        // Reference DynamoDB tables by ARN constants (they are created by DbStack)
        const chatRoomsTableArn = DYNAMODB_ARNS.CHAT_ROOMS(this.region, this.account)
        const chatMessagesTableArn = DYNAMODB_ARNS.CHAT_MESSAGES(this.region, this.account)
        const chatConnectionsTableArn = DYNAMODB_ARNS.CHAT_CONNECTIONS(this.region, this.account)

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
                CHAT_ROOMS_TABLE: DYNAMODB_TABLES.CHAT_ROOMS,
                CHAT_MESSAGES_TABLE: DYNAMODB_TABLES.CHAT_MESSAGES,
                STAGE: stageConfig.name,
                DOMAIN: stageConfig.domain,
            },
            timeout: cdk.Duration.seconds(30),
        })

        // Grant DynamoDB permissions to Rust Lambda using ARN constants
        rustChatFn.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'dynamodb:GetItem',
                    'dynamodb:PutItem',
                    'dynamodb:UpdateItem',
                    'dynamodb:DeleteItem',
                    'dynamodb:Query',
                    'dynamodb:Scan',
                ],
                resources: [chatRoomsTableArn, chatMessagesTableArn],
            })
        )

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
            corsPreflight: {
                allowOrigins: [
                    `https://${stageConfig.domain}`,
                    `https://www.${stageConfig.domain}`,
                    `https://${stageConfig.name}.${stageConfig.domain}`,
                    // Allow localhost for development
                    'http://localhost:3000',
                    'http://localhost:3001',
                    'http://127.0.0.1:3000',
                    'http://127.0.0.1:3001',
                ],
                allowMethods: [
                    apigatewayv2.CorsHttpMethod.GET,
                    apigatewayv2.CorsHttpMethod.POST,
                    apigatewayv2.CorsHttpMethod.OPTIONS,
                ],
                allowHeaders: [
                    'content-type',
                    'authorization',
                    'x-amz-date',
                    'x-amz-security-token',
                    'x-amz-user-agent',
                ],
                allowCredentials: false,
            },
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
                CONNECTIONS_TABLE: DYNAMODB_TABLES.CHAT_CONNECTIONS,
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
                CONNECTIONS_TABLE: DYNAMODB_TABLES.CHAT_CONNECTIONS,
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

        // Reference broadcast function from DbStack
        const broadcastFunction = dbStack.broadcastFunction

        // Grant DynamoDB permissions using ARN constants
        const wsFunctions = [onConnectFunction, onDisconnectFunction]
        wsFunctions.forEach((fn) => {
            fn.addToRolePolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'dynamodb:GetItem',
                        'dynamodb:PutItem',
                        'dynamodb:UpdateItem',
                        'dynamodb:DeleteItem',
                        'dynamodb:Query',
                        'dynamodb:Scan',
                    ],
                    resources: [chatConnectionsTableArn],
                })
            )
        })

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

        // Update WebSocket management permissions to broadcast function with specific API details
        broadcastFunction.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['execute-api:ManageConnections'],
                resources: [
                    `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
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
