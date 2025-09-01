import {Stack, StackProps, RemovalPolicy, Duration, Stage as CdkStage} from 'aws-cdk-lib';
import {Pipeline as CpPipeline, PipelineType} from 'aws-cdk-lib/aws-codepipeline';
import {BuildSpec, ComputeType, LinuxArmBuildImage} from 'aws-cdk-lib/aws-codebuild';
import {Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {Bucket} from 'aws-cdk-lib/aws-s3';
import {Construct} from 'constructs';
import {PipelineConfig, StageConfig} from '../config';
import {CustomImageStack} from './custom-image-stack';
import {CodePipeline, CodePipelineSource, CodeBuildStep, ManualApprovalStep} from 'aws-cdk-lib/pipelines';
import {registerAppStacks} from '../stacks';

export interface PipelineStackProps extends StackProps {
    pipelineConfig: PipelineConfig;
    stages: StageConfig[];
    customImageStack: CustomImageStack;
}

class ApplicationStage extends CdkStage {
    constructor(scope: Construct, id: string, stageConfig: StageConfig) {
        super(scope, id, {
            env: { account: stageConfig.account, region: stageConfig.region },
        });
        registerAppStacks(this, stageConfig);
    }
}

export class PipelineStack extends Stack {
    public readonly pipeline: CodePipeline;
    private readonly customImageStack: CustomImageStack;
    private readonly artifactsBucket: Bucket;

    constructor(scope: Construct, id: string, props: PipelineStackProps) {
        super(scope, id, props);

        const {pipelineConfig, stages, customImageStack} = props;
        this.customImageStack = customImageStack;

        // Create S3 bucket for pipeline artifacts
        this.artifactsBucket = new Bucket(this, 'PipelineArtifacts', {
            bucketName: `swflcoders-pipeline-artifacts-${pipelineConfig.account}`,
            removalPolicy: RemovalPolicy.DESTROY,
            lifecycleRules: [{
                id: 'delete-old-artifacts',
                expiration: Duration.days(30),
            }],
        });

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
                            ],
                            resources: ['*'],
                        }),
                    ],
                }),
            },
        });

        // Sort stages by deploy order
        const sortedStages = stages.sort((a, b) => a.deployOrder - b.deployOrder);

        // Synthesize once with our custom image via a CodeBuild step and reuse outputs
        const synthStep = new CodeBuildStep('Synth', {
            input: CodePipelineSource.connection(
                `${pipelineConfig.github.owner}/${pipelineConfig.github.repo}`,
                pipelineConfig.github.branch,
                { connectionArn: pipelineConfig.github.connectionArn },
            ),
            projectName: 'PipelineSynth',
            role: codeBuildRole, // Use the role with ECR permissions
            partialBuildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        'runtime-versions': { nodejs: pipelineConfig.buildSpec.nodeVersion },
                        commands: [
                            'echo "Using pre-configured Yarn from custom image"',
                        ],
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
                'cd app/frontend',
                'yarn install',
                'cd ../..',
                'yarn build',
            ],
            primaryOutputDirectory: 'packages/cdk/cdk.out',
        });

        const underlying = new CpPipeline(this, 'SwflcodersPipeline', {
            pipelineName: 'swflcoders-main-pipeline',
            crossAccountKeys: true,
            pipelineType: PipelineType.V2,
        });

        this.pipeline = new CodePipeline(this, 'SwflcodersCdkPipeline', {
            codePipeline: underlying,
            synth: synthStep,
            dockerEnabledForSynth: false,
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
        });

        // Add deployment and separate test stages
        for (const stageConfig of sortedStages) {
            // Deploy stage with manual approval for prod
            const appStage = new ApplicationStage(this, `${stageConfig.name}`, stageConfig);
            const preSteps = stageConfig.isProd ? [new ManualApprovalStep(`Approve-${stageConfig.name}`)] : [];
            const deployPipelineStage = this.pipeline.addStage(appStage, { pre: preSteps });

            // Add test actions as post-deployment steps (separate test phase within deploy stage)
            deployPipelineStage.addPost(
                new CodeBuildStep(`${stageConfig.name}-integ-tests`, {
                    role: codeBuildRole, // Use the role with ECR permissions
                    buildEnvironment: {
                        buildImage: LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri),
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
                        'yarn pipeline:test:integ',
                    ],
                })
            );

            deployPipelineStage.addPost(
                new CodeBuildStep(`${stageConfig.name}-e2e-tests`, {
                    role: codeBuildRole, // Use the role with ECR permissions
                    buildEnvironment: {
                        buildImage: LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri),
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
                        'cd packages/e2e',
                        'npx playwright install',
                        'npx playwright install-deps || true',
                        'yarn test',
                    ],
                })
            );
        }
    }

    // Removed all unused helper methods for manual CodeBuild projects and buildspecs
    // CDK Pipelines handles this automatically with CodeBuildStep
}
