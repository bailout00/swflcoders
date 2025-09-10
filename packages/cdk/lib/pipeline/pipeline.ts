import { Stack, type StackProps, Stage as CdkStage } from 'aws-cdk-lib'
import { Pipeline as CpPipeline, PipelineType } from 'aws-cdk-lib/aws-codepipeline'
import { BuildSpec, ComputeType, LinuxArmBuildImage } from 'aws-cdk-lib/aws-codebuild'
import {
    Effect,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { type PipelineConfig, type StageConfig, PROD_ACCOUNT, DYNAMODB_TABLES } from '../config'
import { SlackChannelConfiguration } from 'aws-cdk-lib/aws-chatbot'
import { NotificationRule, DetailType } from 'aws-cdk-lib/aws-codestarnotifications'
import type { CustomImageStack } from './custom-image-stack'
import {
    CodePipeline,
    CodePipelineSource,
    CodeBuildStep,
    ManualApprovalStep,
} from 'aws-cdk-lib/pipelines'
import { registerAppStacks } from '../stacks'
import { IntegSupportStack } from '../stacks/integ-support-stack'
import { ZoneStack } from '../stacks/zone-stack'

export interface PipelineStackProps extends StackProps {
    pipelineConfig: PipelineConfig
    stages: StageConfig[]
    customImageStack: CustomImageStack
}

class ZoneStage extends CdkStage {
    constructor(scope: Construct, id: string) {
        super(scope, id, {
            env: { account: PROD_ACCOUNT, region: 'us-east-1' },
        })

        // Deploy ZoneStack to production account
        new ZoneStack(this, 'ZoneStack')
    }
}

class ApplicationStage extends CdkStage {
    constructor(scope: Construct, id: string, stageConfig: StageConfig) {
        super(scope, id, {
            env: { account: stageConfig.account, region: stageConfig.region },
        })
        registerAppStacks(this, stageConfig)
    }
}

export class PipelineStack extends Stack {
    public readonly pipeline: CodePipeline
    private readonly customImageStack: CustomImageStack

    constructor(scope: Construct, id: string, props: PipelineStackProps) {
        super(scope, id, props)

        const { pipelineConfig, stages, customImageStack } = props
        this.customImageStack = customImageStack

        // Create CodeBuild service role
        const codeBuildRole = new Role(this, 'CodeBuildRole', {
            assumedBy: new ServicePrincipal('codebuild.amazonaws.com'),
            inlinePolicies: {
                PipelinePolicy: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                'logs:CreateLogGroup',
                                'logs:CreateLogStream',
                                'logs:PutLogEvents',
                                's3:GetObject',
                                's3:GetObjectVersion',
                                's3:PutObject',
                                'ssm:GetParameters',
                                'ssm:GetParameter',
                                'ecr:GetAuthorizationToken',
                                'ecr:BatchCheckLayerAvailability',
                                'ecr:GetDownloadUrlForLayer',
                                'ecr:BatchGetImage',
                                'sts:AssumeRole',
                                'cloudformation:*',
                                'iam:*',
                                'ec2:*',
                                'ecs:*',
                                'elasticloadbalancing:*',
                                'cognito-idp:*',
                                'route53:*',
                                'acm:*',
                                's3:*',
                                'cloudfront:*',
                                'secretsmanager:*',
                                'efs:*',
                                'dynamodb:GetItem',
                                'dynamodb:PutItem',
                                'dynamodb:Query',
                                'dynamodb:Scan',
                                'dynamodb:UpdateItem',
                                'dynamodb:DeleteItem',
                                'execute-api:Invoke',
                                'execute-api:ManageConnections',
                            ],
                            resources: ['*'],
                        }),
                        // Add permission to assume DNS management roles in production
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['sts:AssumeRole'],
                            resources: [
                                `arn:aws:iam::${stages.find((s) => s.isProd)?.account}:role/DnsManagementRole-*`,
                            ],
                        }),
                    ],
                }),
            },
        })

        // Sort stages by deploy order
        const sortedStages = stages.sort((a, b) => a.deployOrder - b.deployOrder)

        // Synthesize once with our custom image via a CodeBuild step and reuse outputs
        const synthStep = new CodeBuildStep('Synth', {
            input: CodePipelineSource.connection(
                `${pipelineConfig.github.owner}/${pipelineConfig.github.repo}`,
                pipelineConfig.github.branch,
                { connectionArn: pipelineConfig.github.connectionArn }
            ),
            projectName: 'PipelineSynth',
            role: codeBuildRole, // Use the role with ECR permissions
            partialBuildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        'runtime-versions': { nodejs: pipelineConfig.buildSpec.nodeVersion },
                        commands: ['echo "Using pre-configured Yarn from custom image"'],
                    },
                },
            }),
            buildEnvironment: {
                buildImage: LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri),
                computeType: ComputeType.LARGE,
            },
            env: {
                AWS_DEFAULT_REGION: pipelineConfig.region,
                YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
            },
            commands: [
                'yarn install',
                'cd apps/frontend',
                'yarn install',
                'cd ../..',
                'yarn build',
            ],
            primaryOutputDirectory: 'packages/cdk/cdk.out',
        })

        const underlying = new CpPipeline(this, 'SwflcodersPipeline', {
            pipelineName: 'swflcoders-main-pipeline',
            crossAccountKeys: true,
            pipelineType: PipelineType.V2,
        })

        this.pipeline = new CodePipeline(this, 'SwflcodersCdkPipeline', {
            codePipeline: underlying,
            synth: synthStep,
            dockerEnabledForSynth: false,
            selfMutation: true,
            codeBuildDefaults: {
                rolePolicy: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: ['sts:AssumeRole'],
                        resources: ['*'],
                    }),
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: [
                            'ecr:GetAuthorizationToken',
                            'ecr:BatchCheckLayerAvailability',
                            'ecr:GetDownloadUrlForLayer',
                            'ecr:BatchGetImage',
                        ],
                        resources: ['*'],
                    }),
                ],
            },
        })

        // Notifications: create a CodeStar Notifications rule and (optionally) target a Chatbot Slack channel
        const notificationRule = new NotificationRule(this, 'PipelineNotificationsRule', {
            source: underlying,
            events: [
                // Pipeline-level events
                'codepipeline-pipeline-pipeline-execution-started',
                'codepipeline-pipeline-pipeline-execution-succeeded',
                'codepipeline-pipeline-pipeline-execution-failed',
                'codepipeline-pipeline-pipeline-execution-canceled',
                'codepipeline-pipeline-pipeline-execution-resumed',
                'codepipeline-pipeline-pipeline-execution-superseded',
                // Manual approval events
                'codepipeline-pipeline-manual-approval-needed',
                'codepipeline-pipeline-manual-approval-succeeded',
                'codepipeline-pipeline-manual-approval-failed',
                // Stage-level events
                'codepipeline-pipeline-stage-execution-started',
                'codepipeline-pipeline-stage-execution-succeeded',
                'codepipeline-pipeline-stage-execution-failed',
                'codepipeline-pipeline-stage-execution-canceled',
                // Action-level events
                'codepipeline-pipeline-action-execution-started',
                'codepipeline-pipeline-action-execution-succeeded',
                'codepipeline-pipeline-action-execution-failed',
                'codepipeline-pipeline-action-execution-canceled',
            ],
            detailType: DetailType.FULL,
        })

        if (props.pipelineConfig.notifications?.slackChannelConfigurationArn) {
            const slackChannel = SlackChannelConfiguration.fromSlackChannelConfigurationArn(
                this,
                'PipelineSlackChannel',
                props.pipelineConfig.notifications.slackChannelConfigurationArn
            )
            notificationRule.addTarget(slackChannel)
        }

        // First, deploy the ZoneStack to production (creates root hosted zone and cross-account roles)
        const zoneStage = new ZoneStage(this, 'zone')
        this.pipeline.addStage(zoneStage, {
            pre: [
                new ManualApprovalStep('Approve-Zone-Deployment', {
                    comment: 'Deploy root hosted zone and DNS cross-account roles to production',
                }),
            ],
        })

        // Add deployment, test, and approval stages in sequence
        for (const stageConfig of sortedStages) {
            // Deploy stage
            const appStage = new ApplicationStage(this, `${stageConfig.name}`, stageConfig)
            this.pipeline.addStage(appStage)

            // Integration tests as a separate pipeline stage
            const integTestStage = new CdkStage(this, `${stageConfig.name}-integ-tests-stage`, {
                env: { account: stageConfig.account, region: stageConfig.region },
            })
            // Real stack to host integ test support resources (assumable role)
            new IntegSupportStack(integTestStage, 'IntegSupport', { stageConfig })
            this.pipeline.addStage(integTestStage, {
                post: [
                    new CodeBuildStep(`${stageConfig.name}-integ-tests`, {
                        role: codeBuildRole, // Use the role with ECR permissions
                        buildEnvironment: {
                            buildImage: LinuxArmBuildImage.fromDockerRegistry(
                                this.customImageStack.imageUri
                            ),
                            computeType: ComputeType.MEDIUM,
                        },
                        env: {
                            TEST_TARGET_STAGE: stageConfig.name,
                            TEST_BASE_URL: `https://api.${stageConfig.domain}`,
                            AWS_DEFAULT_REGION: pipelineConfig.region,
                            YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
                            CHAT_MESSAGES_TABLE: DYNAMODB_TABLES.CHAT_MESSAGES,
                            CHAT_ROOMS_TABLE: DYNAMODB_TABLES.CHAT_ROOMS,
                            CHAT_CONNECTIONS_TABLE: DYNAMODB_TABLES.CHAT_CONNECTIONS,
                            TEST_ASSUME_ROLE_ARN: `arn:aws:iam::${stageConfig.account}:role/IntegTestRole-${stageConfig.name}`,
                        },
                        commands: [
                            'yarn install',
                            'yarn workspaces focus @swflcoders/integ --all',
                            'yarn pipeline:test:integ',
                        ],
                    }),
                ],
            })

            // E2E tests as a separate pipeline stage
            const e2eTestStage = new CdkStage(this, `${stageConfig.name}-e2e-tests-stage`)
            // Add a dummy stack to satisfy CDK Stage requirements
            new Stack(e2eTestStage, 'DummyStack', {
                env: { account: stageConfig.account, region: stageConfig.region },
            })
            this.pipeline.addStage(e2eTestStage, {
                pre: [
                    new CodeBuildStep(`${stageConfig.name}-e2e-tests`, {
                        role: codeBuildRole, // Use the role with ECR permissions
                        buildEnvironment: {
                            buildImage: LinuxArmBuildImage.fromDockerRegistry(
                                this.customImageStack.imageUri
                            ),
                            computeType: ComputeType.LARGE,
                        },
                        env: {
                            TEST_TARGET_STAGE: stageConfig.name,
                            TEST_BASE_URL: `https://${stageConfig.domain}`,
                            AWS_DEFAULT_REGION: pipelineConfig.region,
                            YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
                        },
                        commands: [
                            'yarn install',
                            'yarn workspaces focus @swflcoders/e2e --all',
                            'cd packages/e2e',
                            // 'npx playwright install',
                            // 'npx playwright install-deps || true',
                            'yarn test',
                        ],
                    }),
                ],
            })

            // Manual approval stage (except after the last stage)
            if (stageConfig.name !== 'prod') {
                const approvalStage = new CdkStage(this, `${stageConfig.name}-approval-stage`)
                // Add a dummy stack to satisfy CDK Stage requirements
                new Stack(approvalStage, 'DummyStack', {
                    env: { account: stageConfig.account, region: stageConfig.region },
                })
                this.pipeline.addStage(approvalStage, {
                    pre: [
                        new ManualApprovalStep(
                            `Approve-${stageConfig.name}-to-${sortedStages[sortedStages.indexOf(stageConfig) + 1]?.name || 'next'}`
                        ),
                    ],
                })
            }
        }
    }

    // Removed all unused helper methods for manual CodeBuild projects and buildspecs
    // CDK Pipelines handles this automatically with CodeBuildStep
}
