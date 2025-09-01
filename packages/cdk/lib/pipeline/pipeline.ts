import {Stack, StackProps, RemovalPolicy, Duration, Stage as CdkStage} from 'aws-cdk-lib';
import {Pipeline as CpPipeline, PipelineType} from 'aws-cdk-lib/aws-codepipeline';
import {BuildSpec, Cache, ComputeType, LinuxArmBuildImage, Project} from 'aws-cdk-lib/aws-codebuild';
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
                'yarn pipeline:build:types',
                'yarn pipeline:build:backend',
                'yarn pipeline:cdk:build',
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
                ],
            },
        });

        // Add application stages and post-deploy tests
        for (const stageConfig of sortedStages) {
            const appStage = new ApplicationStage(this, `${stageConfig.name}`, stageConfig);
            const preSteps = stageConfig.isProd ? [new ManualApprovalStep(`Approve-${stageConfig.name}`)] : [];
            const stageDeployment = this.pipeline.addStage(appStage, { pre: preSteps });

            // After deployment, run tests
            stageDeployment.addPost(new CodeBuildStep(`${stageConfig.name}-integ-tests`, {
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
            }));
            stageDeployment.addPost(new CodeBuildStep(`${stageConfig.name}-e2e-tests`, {
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
                    'npx playwright install',
                    'npx playwright install-deps || true',
                    'yarn pipeline:test:e2e',
                ],
            }));
        }
    }

    private createBuildProject(
        id: string,
        config: PipelineConfig,
        role: Role,
        buildType: 'build' | 'test',
        stageConfigForTests?: StageConfig,
    ): Project {
        const buildSpec = buildType === 'build'
            ? this.createBuildSpec(config)
            : this.createTestBuildSpec(config, buildType as 'integ' | 'e2e', stageConfigForTests!);

        return new Project(this, id, {
            role,
            environment: {
                buildImage: LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri),
                computeType: ComputeType.LARGE,
            },
            environmentVariables: {
                YARN_ENABLE_IMMUTABLE_INSTALLS: {value: 'false'},
                AWS_DEFAULT_REGION: {value: config.region},
                ...(stageConfigForTests && stageConfigForTests.testAssumeRoleArn ? {TEST_ASSUME_ROLE_ARN: {value: stageConfigForTests.testAssumeRoleArn}} : {}),
            },
            buildSpec,
            cache: Cache.bucket(this.artifactsBucket),
            timeout: Duration.hours(8),
        });
    }

    private createDeployProject(id: string, config: PipelineConfig, role: Role, stageConfig: StageConfig): Project {
        return new Project(this, id, {
            role,
            environment: {
                buildImage: LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri),
                computeType: ComputeType.MEDIUM,
            },
            environmentVariables: {
                YARN_ENABLE_IMMUTABLE_INSTALLS: {value: 'false'},

                AWS_DEFAULT_REGION: {value: config.region},
            },
            buildSpec: this.createDeployBuildSpec(config, stageConfig),
            timeout: Duration.hours(1),
        });
    }

    private createSelfMutateProject(id: string, config: PipelineConfig, role: Role): Project {
        return new Project(this, id, {
            role,
            environment: {
                buildImage: LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri),
                computeType: ComputeType.MEDIUM,
                privileged: true,
            },
            environmentVariables: {
                YARN_ENABLE_IMMUTABLE_INSTALLS: {value: 'false'},

                AWS_DEFAULT_REGION: {value: config.region},
            },
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        'runtime-versions': {nodejs: config.buildSpec.nodeVersion},
                        commands: [
                            // Corepack and Yarn are pre-configured in custom image
                            'echo "Using pre-configured Yarn from custom image"',
                        ],
                    },
                    pre_build: {
                        commands: [
                            'cd packages/cdk',
                            'yarn install',
                        ],
                    },
                    build: {
                        commands: [
                            'yarn cdk deploy SwflcodersPipelineStack --app cdk.out.pipeline --require-approval never',
                        ],
                    },
                },
                env: {
                    variables: {
                        AWS_DEFAULT_REGION: config.region,
                        CDK_DEFAULT_ACCOUNT: config.account,
                        CDK_DEFAULT_REGION: config.region,
                    },
                },
            }),
            timeout: Duration.minutes(30),
        });
    }

    private createTestProject(
        id: string,
        config: PipelineConfig,
        role: Role,
        testType: 'integ' | 'e2e',
        stageConfig: StageConfig
    ): Project {
        // Use custom image if available, otherwise fall back to standard image
        const buildImage = LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri)

        return new Project(this, id, {
            role,
            environment: {
                buildImage,
                computeType: ComputeType.LARGE,
            },
            environmentVariables: {
                YARN_ENABLE_IMMUTABLE_INSTALLS: {value: 'false'},

                AWS_DEFAULT_REGION: {value: config.region},
                ...(stageConfig.testAssumeRoleArn ? {TEST_ASSUME_ROLE_ARN: {value: stageConfig.testAssumeRoleArn}} : {}),
            },
            buildSpec: this.createTestBuildSpec(config, testType, stageConfig),
            timeout: Duration.hours(1),
        });
    }

    private createBuildSpec(config: PipelineConfig): BuildSpec {
        return BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    'runtime-versions': {
                        nodejs: config.buildSpec.nodeVersion,
                    },
                    commands: [
                        'echo Using custom build image with pre-installed dependencies...',
                    ],
                },
                pre_build: {
                    commands: [
                        'echo Pre-build phase...',
                        'yarn install',
                        'echo Verifying workspace setup...',
                    ],
                },
                build: {
                    commands: [
                        'echo Build phase...',
                        'yarn pipeline:build:types',
                        'yarn pipeline:build:backend',
                        'yarn pipeline:cdk:build',
                    ],
                },
                post_build: {
                    commands: [
                        'echo Build completed',
                    ],
                },
            },
            artifacts: {
                files: [
                    '**/*',
                    'packages/backend/target/lambda/**/*',
                    'packages/cdk/cdk.out/**/*',
                    'packages/cdk/cdk.out.pipeline/**/*',
                    'packages/frontend/dist/**/*',
                ],
                'exclude-paths': [
                    'node_modules/**/*',
                    '.git/**/*',
                ],
            },
            cache: {
                paths: [
                    'node_modules/**/*',
                    'target/**/*',
                    '$HOME/.cargo/**/*',
                    '$HOME/.rustup/**/*',
                ],
            },
        });
    }

    private createDeployBuildSpec(config: PipelineConfig, stageConfig: StageConfig): BuildSpec {
        return BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    'runtime-versions': {
                        nodejs: config.buildSpec.nodeVersion,
                    },
                    commands: [
                        // Corepack and Yarn are pre-configured in custom image
                        'echo "Using pre-configured Yarn from custom image"',
                    ],
                },
                pre_build: {
                    commands: [
                        'pwd',
                        'ls -alh',
                        'cd packages/cdk',
                        'yarn install',
                        'ls -alh cdk.out',
                    ],
                },
                build: {
                    commands: [
                        // Deploy stacks in dependency order: DNS first (infrequent changes), then Bucket, then others
                        `yarn cdk deploy DnsStack-${stageConfig.name} --app cdk.out --require-approval never --verbose`,
                        `yarn cdk deploy BucketStack-${stageConfig.name} --app cdk.out --require-approval never --verbose`,
                        `yarn cdk deploy ApiStack-${stageConfig.name} CloudwatchDashboardStack-${stageConfig.name} WebsiteStack-${stageConfig.name} --app cdk.out --require-approval never --verbose`,
                    ],
                },
            },
            env: {
                variables: {
                    AWS_DEFAULT_REGION: stageConfig.region,
                    CDK_DEFAULT_ACCOUNT: stageConfig.account,
                    CDK_DEFAULT_REGION: stageConfig.region,
                },
            },
        });
    }

    private createTestBuildSpec(config: PipelineConfig, testType: 'integ' | 'e2e', stageConfig: StageConfig): BuildSpec {
        const commands = testType === 'integ'
            ? [
                'yarn pipeline:test:integ',
            ]
            : [
                'yarn pipeline:test:e2e',
            ];

        return BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    'runtime-versions': {
                        nodejs: config.buildSpec.nodeVersion,
                    },
                    commands: [
                        'echo Using custom build image with pre-installed dependencies...',
                        // Install Playwright browsers for E2E tests (always needed)
                        ...(testType === 'e2e' ? [
                            'npx playwright install',
                            'npx playwright install-deps',
                        ] : []),
                    ],
                },
                pre_build: {
                    commands: [
                        'yarn install',
                        // Fetch CDK stack outputs for API endpoints (only for E2E tests)
                        ...(testType === 'e2e' ? [
                            `STACK_NAME="ApiStack-${stageConfig.name}"`,
                            'echo "Fetching outputs for stack: $STACK_NAME"',
                            'OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs" --output json 2>/dev/null || echo "null")',
                            'if [ "$OUTPUTS" != "null" ] && [ "$OUTPUTS" != "" ]; then',
                            '  API_URL=$(echo "$OUTPUTS" | jq -r \'.[] | select(.OutputKey=="ApiEndpoint") | .OutputValue\' 2>/dev/null || echo "")',
                            '  HEALTH_URL=$(echo "$OUTPUTS" | jq -r \'.[] | select(.OutputKey=="HealthCheckEndpoint") | .OutputValue\' 2>/dev/null || echo "")',
                            '  DOMAIN=$(echo "$OUTPUTS" | jq -r \'.[] | select(.OutputKey=="Domain") | .OutputValue\' 2>/dev/null || echo "")',
                            'else',
                            '  echo "Warning: Could not fetch CloudFormation outputs, tests may fail"',
                            '  # Cannot construct API URL without CloudFormation outputs',
                            '  API_URL=""',
                            '  HEALTH_URL=""',
                            '  DOMAIN="' + stageConfig.domain + '"',
                            'fi',
                            'echo "API_URL=$API_URL"',
                            'echo "HEALTH_URL=$HEALTH_URL"',
                            'echo "DOMAIN=$DOMAIN"',
                        ] : []),
                    ],
                },
                build: {
                    commands: [
                        // Export environment variables for tests
                        'export API_URL="$API_URL"',
                        'export HEALTH_URL="$HEALTH_URL"',
                        'export BASE_URL="$TEST_BASE_URL"',
                        'export STAGE="' + stageConfig.name + '"',
                        'echo "=== Test Environment Variables ==="',
                        'echo "API_URL: $API_URL"',
                        'echo "HEALTH_URL: $HEALTH_URL"',
                        'echo "BASE_URL: $BASE_URL"',
                        'echo "STAGE: $STAGE"',
                        'echo "==================================="',
                        // Optional cross-account assume role for tests if provided via env
                        'if [ -n "$TEST_ASSUME_ROLE_ARN" ]; then echo "Assuming test role..."; CREDS=$(aws sts assume-role --role-arn "$TEST_ASSUME_ROLE_ARN" --role-session-name test-session); export AWS_ACCESS_KEY_ID=$(echo $CREDS | jq -r .Credentials.AccessKeyId); export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | jq -r .Credentials.SecretAccessKey); export AWS_SESSION_TOKEN=$(echo $CREDS | jq -r .Credentials.SessionToken); fi',
                        'echo Running tests...',
                        testType === 'integ' ? 'yarn pipeline:test:integ' : 'yarn pipeline:test:e2e',
                    ],
                },
            },
            env: {
                variables: {
                    TEST_TARGET_STAGE: stageConfig.name,
                    TEST_BASE_URL: `https://${stageConfig.domain}`,
                    PLAYWRIGHT_BROWSERS_PATH: '$HOME/.cache/ms-playwright',
                },
            },
            artifacts: {
                files: [
                    'test-results/**/*',
                    'test-reports/**/*',
                ],
            },
        });
    }
}
