import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Pipeline, Artifact } from 'aws-cdk-lib/aws-codepipeline';
import { 
  CodeStarConnectionsSourceAction, 
  CodeBuildAction,
  ManualApprovalAction 
} from 'aws-cdk-lib/aws-codepipeline-actions';
import {
    Project,
    BuildSpec,
    ComputeType,
    Cache,
    LocalCacheMode, LinuxArmBuildImage,
} from 'aws-cdk-lib/aws-codebuild';
import { Role, ServicePrincipal, PolicyStatement, Effect, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { PipelineConfig, StageConfig } from '../config';
import { CustomImageStack } from './custom-image-stack';

export interface PipelineStackProps extends StackProps {
  pipelineConfig: PipelineConfig;
  betaStage: StageConfig;
  gammaStage: StageConfig;
  prodStage: StageConfig;
  customImageStack?: CustomImageStack;
}

export class PipelineStack extends Stack {
  public readonly pipeline: Pipeline;
  private readonly customImageStack?: CustomImageStack;
  private readonly artifactsBucket: Bucket;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const { pipelineConfig, betaStage, gammaStage, prodStage, customImageStack } = props;
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

    // Source artifacts
    const sourceOutput = new Artifact();

    // Build artifacts
    const buildOutput = new Artifact();
    // Test stages don't publish artifacts

    // CDK deploy artifacts for each stage
    const betaDeployOutput = new Artifact();

    // Create the main pipeline
    this.pipeline = new Pipeline(this, 'SwflcodersPipeline', {
      pipelineName: 'swflcoders-main-pipeline',
      artifactBucket: this.artifactsBucket,
      stages: [
        // Source stage
        {
          stageName: 'Source',
          actions: [
            new CodeStarConnectionsSourceAction({
              actionName: 'GitHubSource',
              owner: pipelineConfig.github.owner,
              repo: pipelineConfig.github.repo,
              branch: pipelineConfig.github.branch,
              connectionArn: pipelineConfig.github.connectionArn,
              output: sourceOutput,
            }),
          ],
        },

        // Build stage
        {
          stageName: 'Build',
          actions: [
            new CodeBuildAction({
              actionName: 'BuildApp',
              project: this.createBuildProject('BuildProject', pipelineConfig, codeBuildRole, 'build', betaStage),
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },

        // Self-mutate pipeline (deploy/update nt-pipeline itself)
        {
          stageName: 'UpdatePipeline',
          actions: [
            new CodeBuildAction({
              actionName: 'SelfMutate',
              project: this.createSelfMutateProject('SelfMutateProject', pipelineConfig, codeBuildRole),
              input: buildOutput,
              runOrder: 1,
            }),
          ],
        },

        // Deploy to Beta
        {
          stageName: 'DeployBeta',
          actions: [
            new CodeBuildAction({
              actionName: 'CDKDeployBeta',
              project: this.createDeployProject('DeployBetaProject', pipelineConfig, codeBuildRole, betaStage),
              input: buildOutput,
              outputs: [betaDeployOutput],
            }),
          ],
        },

        // Tests now run in the Build step; no separate Test stage

        // // Manual approval for Gamma
        // {
        //   stageName: 'ApproveGamma',
        //   actions: [
        //     new ManualApprovalAction({
        //       actionName: 'ApproveGammaDeployment',
        //       additionalInformation: 'Review beta tests and approve deployment to gamma environment',
        //     }),
        //   ],
        // },
        //
        // // Deploy to Gamma
        // {
        //   stageName: 'DeployGamma',
        //   actions: [
        //     new CodeBuildAction({
        //       actionName: 'CDKDeployGamma',
        //       project: this.createDeployProject('DeployGammaProject', pipelineConfig, codeBuildRole, gammaStage),
        //       input: buildOutput,
        //       outputs: [gammaDeployOutput],
        //     }),
        //   ],
        // },
        //
        // // Integration Tests (Gamma -> Prod)
        // {
        //   stageName: 'TestGamma',
        //   actions: [
        //     new CodeBuildAction({
        //       actionName: 'IntegrationTestsGamma',
        //       project: this.createTestProject('IntegTestGammaProject', pipelineConfig, codeBuildRole, 'integ', gammaStage),
        //       input: buildOutput,
        //     }),
        //     new CodeBuildAction({
        //       actionName: 'E2ETestsGamma',
        //       project: this.createTestProject('E2ETestGammaProject', pipelineConfig, codeBuildRole, 'e2e', gammaStage),
        //       input: buildOutput,
        //       runOrder: 2,
        //     }),
        //   ],
        // },

        // Manual approval for Production
        {
          stageName: 'ApproveProd',
          actions: [
            new ManualApprovalAction({
              actionName: 'ApproveProdDeployment',
              additionalInformation: 'Review gamma tests and approve deployment to production environment',
            }),
          ],
        },

        // Deploy to Production
        {
          stageName: 'DeployProd',
          actions: [
            new CodeBuildAction({
              actionName: 'CDKDeployProd',
              project: this.createDeployProject('DeployProdProject', pipelineConfig, codeBuildRole, prodStage),
              input: buildOutput,
            }),
          ],
        },
      ],
    });
  }

  private createBuildProject(
    id: string, 
    config: PipelineConfig, 
    role: Role,
    buildType: 'build' | 'test',
    stageConfigForTests?: StageConfig,
  ): Project {
    const buildSpec = buildType === 'build' ? this.createBuildSpec(config) : this.createTestBuildSpec(config);

    // Use custom image if available, otherwise fall back to standard image
    const buildImage = this.customImageStack 
      ? LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri)
      : LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0

    return new Project(this, id, {
      role,
      environment: {
        buildImage,
        computeType: ComputeType.LARGE,
      },
      environmentVariables: {
        YARN_ENABLE_IMMUTABLE_INSTALLS: { value: 'false' },
        RUSTC_WRAPPER: { value: '/usr/local/cargo/bin/sccache' },
        SCCACHE_DIR: { value: '/codebuild/sccache' },
        SCCACHE_BUCKET: { value: this.artifactsBucket.bucketName },
        AWS_DEFAULT_REGION: { value: config.region },
        ...(stageConfigForTests?.testAssumeRoleArn ? { TEST_ASSUME_ROLE_ARN: { value: stageConfigForTests.testAssumeRoleArn } } : {}),
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
        buildImage: this.customImageStack 
          ? LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri)
          : LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: ComputeType.MEDIUM,
      },
      environmentVariables: {
        YARN_ENABLE_IMMUTABLE_INSTALLS: { value: 'false' },
        RUSTC_WRAPPER: { value: '/usr/local/cargo/bin/sccache' },
        SCCACHE_DIR: { value: '/codebuild/sccache' },
        SCCACHE_BUCKET: { value: this.artifactsBucket.bucketName },
        AWS_DEFAULT_REGION: { value: config.region },
      },
      buildSpec: this.createDeployBuildSpec(config, stageConfig),
      timeout: Duration.hours(1),
    });
  }

  private createSelfMutateProject(id: string, config: PipelineConfig, role: Role): Project {
    return new Project(this, id, {
      role,
      environment: {
        buildImage: this.customImageStack 
          ? LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri)
          : LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: ComputeType.MEDIUM,
        privileged: true,
      },
      environmentVariables: {
        YARN_ENABLE_IMMUTABLE_INSTALLS: { value: 'false' },
        RUSTC_WRAPPER: { value: '/usr/local/cargo/bin/sccache' },
        SCCACHE_DIR: { value: '/codebuild/sccache' },
        SCCACHE_BUCKET: { value: this.artifactsBucket.bucketName },
        AWS_DEFAULT_REGION: { value: config.region },
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: config.buildSpec.nodeVersion },
            commands: [
              'corepack enable',
              'corepack prepare yarn@4.9.2 --activate',
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
    const buildImage = this.customImageStack 
      ? LinuxArmBuildImage.fromDockerRegistry(this.customImageStack.imageUri)
      : LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0

    return new Project(this, id, {
      role,
      environment: {
        buildImage,
        computeType: ComputeType.LARGE,
      },
      environmentVariables: {
        YARN_ENABLE_IMMUTABLE_INSTALLS: { value: 'false' },
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
            // Only install dependencies if not using custom image
            ...(this.customImageStack ? [] : [
              'echo Installing system dependencies...',
              'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
              '. $HOME/.cargo/env',
              `rustup install ${config.buildSpec.rustVersion}`,
              `rustup default ${config.buildSpec.rustVersion}`,
              'rustup target add aarch64-unknown-linux-gnu',
              'corepack enable',
              'corepack prepare yarn@4.9.2 --activate',
              'echo System dependencies installed',
            ]),
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
            'corepack enable',
            'corepack prepare yarn@4.9.2 --activate',
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

  private createTestBuildSpec(config: PipelineConfig, testType?: 'integ' | 'e2e', stageConfig?: StageConfig): BuildSpec {
    const commands = testType === 'integ' 
      ? [
          'yarn pipeline:test:integ',
        ]
      : testType === 'e2e'
      ? [
          'yarn pipeline:test:e2e',
        ]
      : [
          'yarn pipeline:test:unit',
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
            // Only install dependencies if not using custom image
            ...(this.customImageStack ? [] : [
              'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
              '. $HOME/.cargo/env',
              `rustup install ${config.buildSpec.rustVersion}`,
              `rustup default ${config.buildSpec.rustVersion}`,
              'corepack enable',
              'corepack prepare yarn@4.9.2 --activate',
            ]),
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
          ],
        },
        build: {
          commands: [
            'echo Build phase...',
            'yarn pipeline:build:types',
            'yarn pipeline:build:backend',
            'yarn pipeline:cdk:build',
            // Optional cross-account assume role for tests if provided via env
            'if [ -n "$TEST_ASSUME_ROLE_ARN" ]; then echo "Assuming test role..."; CREDS=$(aws sts assume-role --role-arn "$TEST_ASSUME_ROLE_ARN" --role-session-name test-session); export AWS_ACCESS_KEY_ID=$(echo $CREDS | jq -r .Credentials.AccessKeyId); export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | jq -r .Credentials.SecretAccessKey); export AWS_SESSION_TOKEN=$(echo $CREDS | jq -r .Credentials.SessionToken); fi',
            'echo Running tests...',
            'yarn pipeline:test:integ',
            'yarn pipeline:test:e2e',
          ],
        },
      },
      env: {
        variables: {
          TEST_TARGET_STAGE: stageConfig?.name || 'beta',
          TEST_BASE_URL: stageConfig ? `https://${stageConfig.domain}` : 'https://beta.swflcoders.jknott.dev',
          ...(testType === 'e2e' && {
            PLAYWRIGHT_BROWSERS_PATH: '$HOME/.cache/ms-playwright',
          }),
        },
      },
      // No artifacts for test steps (avoid upload failures when no files exist)
    });
  }
}
