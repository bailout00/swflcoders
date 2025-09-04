import * as cdk from 'aws-cdk-lib'
import {
    Effect,
    PolicyDocument,
    PolicyStatement,
    Role,
    AccountPrincipal,
} from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { PIPELINE_ACCOUNT, DYNAMODB_ARNS, DYNAMODB_TABLES, type StageConfig } from '../config'

export interface IntegSupportStackProps extends cdk.StackProps {
    stageConfig: StageConfig
}

export class IntegSupportStack extends cdk.Stack {
    public readonly integTestRoleArn: string

    constructor(scope: Construct, id: string, props: IntegSupportStackProps) {
        super(scope, id, props)

        const { stageConfig } = props

        // Role assumed by pipeline CodeBuild jobs to run integ tests against this account
        const role = new Role(this, 'IntegTestRole', {
            roleName: `IntegTestRole-${stageConfig.name}`,
            assumedBy: new AccountPrincipal(PIPELINE_ACCOUNT),
            inlinePolicies: {
                DynamoDbAccess: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                'dynamodb:GetItem',
                                'dynamodb:PutItem',
                                'dynamodb:UpdateItem',
                                'dynamodb:DeleteItem',
                                'dynamodb:Query',
                                'dynamodb:Scan',
                                'dynamodb:DescribeTable',
                            ],
                            resources: [
                                DYNAMODB_ARNS.CHAT_MESSAGES(
                                    stageConfig.region,
                                    stageConfig.account
                                ),
                                `${DYNAMODB_ARNS.CHAT_MESSAGES(stageConfig.region, stageConfig.account)}/index/*`,
                                DYNAMODB_ARNS.CHAT_ROOMS(stageConfig.region, stageConfig.account),
                                DYNAMODB_ARNS.CHAT_CONNECTIONS(
                                    stageConfig.region,
                                    stageConfig.account
                                ),
                                `${DYNAMODB_ARNS.CHAT_CONNECTIONS(stageConfig.region, stageConfig.account)}/index/*`,
                            ],
                        }),
                    ],
                }),
            },
        })

        this.integTestRoleArn = role.roleArn

        new cdk.CfnOutput(this, 'IntegTestRoleArn', {
            value: this.integTestRoleArn,
            description: 'Role ARN to assume for integ tests',
        })

        // Optional: table name outputs for debugging
        new cdk.CfnOutput(this, 'ChatMessagesTableName', { value: DYNAMODB_TABLES.CHAT_MESSAGES })
        new cdk.CfnOutput(this, 'ChatRoomsTableName', { value: DYNAMODB_TABLES.CHAT_ROOMS })
        new cdk.CfnOutput(this, 'ChatConnectionsTableName', {
            value: DYNAMODB_TABLES.CHAT_CONNECTIONS,
        })
    }
}
