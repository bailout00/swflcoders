import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as cr from 'aws-cdk-lib/custom-resources'
import type { Construct } from 'constructs'
import { DYNAMODB_TABLES, type StageConfig } from '../config'

export interface DbStackProps extends cdk.StackProps {
    stageConfig: StageConfig
}

export class DbStack extends cdk.Stack {
    public readonly chatRoomsTable: dynamodb.Table
    public readonly chatMessagesTable: dynamodb.Table
    public readonly chatConnectionsTable: dynamodb.Table
    public readonly broadcastFunction: lambda.Function

    constructor(scope: Construct, id: string, props: DbStackProps) {
        super(scope, id, props)

        const { stageConfig } = props
        const isProd = stageConfig.environment === 'prod'

        // === DynamoDB Tables ===

        // Chat Rooms Table
        this.chatRoomsTable = new dynamodb.Table(this, 'ChatRoomsTable', {
            tableName: DYNAMODB_TABLES.CHAT_ROOMS,
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        })

        // Chat Messages Table (with DynamoDB Streams for real-time broadcasting)
        this.chatMessagesTable = new dynamodb.Table(this, 'ChatMessagesTable', {
            tableName: DYNAMODB_TABLES.CHAT_MESSAGES,
            partitionKey: { name: 'room_id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'ts', type: dynamodb.AttributeType.NUMBER },
            stream: dynamodb.StreamViewType.NEW_IMAGE,
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        })

        // Chat Connections Table (for WebSocket client management)
        this.chatConnectionsTable = new dynamodb.Table(this, 'ChatConnectionsTable', {
            tableName: DYNAMODB_TABLES.CHAT_CONNECTIONS,
            partitionKey: { name: 'connection_id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            // TTL for automatic cleanup of old connections
            timeToLiveAttribute: 'ttl',
        })

        // Add GSI for querying connections by room
        this.chatConnectionsTable.addGlobalSecondaryIndex({
            indexName: 'room-index',
            partitionKey: { name: 'room_id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'connected_at', type: dynamodb.AttributeType.NUMBER },
        })

        // Seed default "general" room on deployment
        new cr.AwsCustomResource(this, 'SeedGeneralRoom', {
            onCreate: {
                service: 'DynamoDB',
                action: 'putItem',
                parameters: {
                    TableName: this.chatRoomsTable.tableName,
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
            policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
                resources: [this.chatRoomsTable.tableArn],
            }),
        })

        // === Broadcast Lambda Function ===
        // This lambda handles broadcasting new messages via WebSocket
        this.broadcastFunction = new lambda.Function(this, 'BroadcastFunction', {
            functionName: `ws-broadcast-${stageConfig.name}`,
            runtime: lambda.Runtime.PROVIDED_AL2023,
            architecture: lambda.Architecture.ARM_64,
            handler: 'bootstrap',
            code: lambda.Code.fromAsset('../backend/target/lambda/ws-broadcast'),
            environment: {
                CONNECTIONS_TABLE: DYNAMODB_TABLES.CHAT_CONNECTIONS,
                STAGE: stageConfig.name,
            },
            timeout: cdk.Duration.seconds(30),
        })

        // Grant DynamoDB permissions to broadcast function
        this.chatConnectionsTable.grantReadWriteData(this.broadcastFunction)

        // Grant WebSocket management permissions to broadcast function
        // Note: The WebSocket API ID and stage will be added when this function is used in ApiStack
        this.broadcastFunction.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['execute-api:ManageConnections'],
                resources: [
                    `arn:aws:execute-api:${stageConfig.region}:${stageConfig.account}:*/*/@connections/*`,
                ],
            })
        )

        // Add DynamoDB Stream trigger to broadcast function
        this.broadcastFunction.addEventSource(
            new lambdaEventSources.DynamoEventSource(this.chatMessagesTable, {
                startingPosition: lambda.StartingPosition.LATEST,
                batchSize: 10,
                filters: [
                    lambda.FilterCriteria.filter({
                        eventName: lambda.FilterRule.isEqual('INSERT'),
                    }),
                ],
            })
        )

        // === Outputs ===
        new cdk.CfnOutput(this, 'ChatRoomsTableName', {
            value: this.chatRoomsTable.tableName,
            description: 'Chat rooms DynamoDB table name',
        })

        new cdk.CfnOutput(this, 'ChatMessagesTableName', {
            value: this.chatMessagesTable.tableName,
            description: 'Chat messages DynamoDB table name',
        })

        new cdk.CfnOutput(this, 'ChatConnectionsTableName', {
            value: this.chatConnectionsTable.tableName,
            description: 'Chat connections DynamoDB table name',
        })
    }
}
