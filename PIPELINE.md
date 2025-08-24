# CodePipeline Setup Guide

This document provides step-by-step instructions for setting up and deploying the AWS CodePipeline for the Swflcoders project.

## Overview

The CodePipeline automatically deploys your application through three environments:
- **Beta** (`beta.swflcoders.jknott.dev`) - Development testing
- **Gamma** (`gamma.swflcoders.jknott.dev`) - Staging/Pre-production  
- **Prod** (`swflcoders.jknott.dev`) - Production

### Pipeline Flow
1. **Source** → Trigger on GitHub push
2. **Build** → Compile TypeScript, build types, run tests
3. **Beta** → Deploy → Manual Approval → E2E Tests
4. **Gamma** → Deploy → Manual Approval → E2E Tests  
5. **Prod** → Deploy

## Prerequisites

### 1. AWS Setup
```bash
# Ensure you have AWS CLI configured
aws sts get-caller-identity

# Bootstrap CDK (one-time per account/region)
cd packages/cdk
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

### 2. GitHub Integration (Recommended)

#### Create CodeStar Connection
1. Go to AWS Console → CodeSuite → Settings → Connections
2. Create connection → GitHub → Authorize AWS access
3. Note the Connection ARN (format: `arn:aws:codestar-connections:REGION:ACCOUNT:connection/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`)

#### Update Pipeline Configuration
Edit `packages/cdk/lib/stacks/pipeline-stack.ts`:
```typescript
const sourceAction = new cpactions.CodeStarConnectionsSourceAction({
  actionName: 'Source',
  owner: 'YOUR_GITHUB_USERNAME',           // ← Replace this
  repo: 'YOUR_REPOSITORY_NAME',            // ← Replace this
  branch: 'main',                          // ← Replace this if different
  connectionArn: 'YOUR_CONNECTION_ARN',    // ← Replace this
  output: sourceOutput,
  triggerOnPush: true,
});
```

## Deployment Instructions

### 1. Deploy the Pipeline Stack
```bash
# From project root
pnpm deploy:pipeline

# Or manually:
cd packages/cdk
pnpm build
pnpm deploy:pipeline
```

### 2. Verify Pipeline Creation
1. Go to AWS Console → CodePipeline → Pipelines
2. You should see "Swflcoders" pipeline
3. Initial execution will start automatically if GitHub is connected

### 3. Monitor Pipeline Execution
- **Source Stage**: Pulls code from GitHub
- **Build Stage**: Compiles and tests (view logs in CodeBuild console)
- **Beta Stage**: Deploys to beta environment
  - **Manual Approval Required**: Click "Review" → "Approve" to continue
  - **E2E Tests**: Runs Playwright tests against beta environment
- **Gamma Stage**: Same process for staging environment
- **Prod Stage**: Final deployment to production (no E2E after prod)

## Pipeline Architecture

### CodeBuild Projects

#### Build Project
- **Environment**: Node.js 22 with pnpm
- **Buildspec**: `packages/cdk/buildspecs/build.yml`
- **Purpose**: Compile types, build CDK, run type checks
- **Artifacts**: Full workspace (excluding node_modules)

#### Deploy Projects (Beta/Gamma/Prod)
- **Environment**: Node.js 22 with Docker (privileged for Rust Lambda bundling)
- **Buildspec**: `packages/cdk/buildspecs/deploy.yml`
- **Purpose**: CDK synthesize and deploy all app stacks
- **Features**: Auto-bootstrap CDK if needed

#### E2E Projects (Beta/Gamma)
- **Environment**: Node.js 22 with Playwright
- **Buildspec**: `packages/cdk/buildspecs/e2e.yml`
- **Purpose**: Run end-to-end tests against deployed environments
- **Features**: Auto-discover endpoints from CloudFormation outputs

### IAM Permissions

Deploy projects have broad permissions for CDK operations:
- CloudFormation: Full access
- IAM: Role management for Lambda/API Gateway
- Lambda, API Gateway, DynamoDB, S3, Logs: Full access
- Route53, ACM, KMS: Certificate and DNS management

E2E projects have minimal permissions:
- CloudFormation: Describe stacks only
- CloudWatch Logs: Write test results

## Environment Variables

The pipeline automatically sets environment variables for each stage:

### Deploy Steps
- `STAGE`: beta/gamma/prod
- `STACK_NAME_PREFIX`: ApiStack
- `AWS_REGION`: us-east-1

### E2E Steps
- `STAGE`: beta/gamma/prod
- `BASE_URL`: https://[stage].swflcoders.jknott.dev (or root domain for prod)
- `API_URL`: API Gateway endpoint
- `HEALTH_URL`: Health check endpoint
- `CI`: true (enables CI-optimized Playwright config)

## E2E Test Configuration

Playwright tests automatically:
- Use only Chromium in CI (faster execution)
- Discover endpoints from CloudFormation stack outputs
- Run with line reporter for clean CI logs
- Capture screenshots and traces on failure

Example test structure:
```typescript
// packages/e2e/tests/health.spec.ts
test('API health check', async ({ request }) => {
  const healthUrl = process.env.HEALTH_URL!;
  const response = await request.get(healthUrl);
  expect(response.status()).toBe(200);
});
```

## Manual Operations

### Deploy Pipeline Changes
When you modify the pipeline stack itself:
```bash
pnpm deploy:pipeline
```

### Manual Stage Deployments  
Deploy directly to specific environments:
```bash
pnpm deploy:beta
pnpm deploy:gamma  
pnpm deploy:prod
```

### Run E2E Tests Locally
```bash
cd packages/e2e
BASE_URL=https://beta.swflcoders.jknott.dev pnpm test
```

### View Logs
- **CodeBuild Logs**: AWS Console → CodeBuild → Build projects → Build history
- **Pipeline History**: AWS Console → CodePipeline → Swflcoders → History
- **CloudFormation Events**: AWS Console → CloudFormation → [StackName] → Events

## Troubleshooting

### Common Issues

#### 1. Build Failures
- **Node.js Version**: Ensure buildspecs use Node.js 22
- **Dependencies**: Check if new dependencies need to be added to buildspecs
- **Type Errors**: Run `pnpm type-check` locally to catch TypeScript issues

#### 2. Deploy Failures
- **CDK Bootstrap**: Ensure CDK is bootstrapped in your account/region
- **IAM Permissions**: Deploy projects need broad permissions for CDK operations
- **Docker Issues**: Rust Lambda bundling requires privileged mode

#### 3. E2E Test Failures
- **Stack Outputs**: Ensure your stacks export required outputs (ApiEndpoint, HealthCheckEndpoint, Domain)
- **Timing Issues**: Add waits for services to fully start up
- **Environment Variables**: Check if tests can access required URLs

#### 4. GitHub Integration Issues
- **Connection Status**: Verify CodeStar connection is active in AWS Console
- **Branch Protection**: Ensure CodePipeline can access your default branch
- **Webhooks**: Pipeline should automatically create webhooks for push triggers

### Stack Outputs Required
Your CDK stacks must export these outputs for E2E tests:
```typescript
new cdk.CfnOutput(this, 'ApiEndpoint', {
  value: api.url,
  description: 'API Gateway endpoint URL',
});

new cdk.CfnOutput(this, 'HealthCheckEndpoint', {
  value: `${api.url}health`,
  description: 'Health check endpoint',
});

new cdk.CfnOutput(this, 'Domain', {
  value: stageConfig.domain,
  description: 'Configured domain',
});
```

## Future Enhancements

### Multiple Stack Support
To add new stacks:
1. Create stack in `packages/cdk/lib/stacks/new-stack.ts`
2. Register in `packages/cdk/lib/stacks/index.ts`
3. Import and instantiate in `packages/cdk/bin/app.ts`

The pipeline will automatically deploy all registered stacks.

### Notifications
Add SNS notifications for pipeline state changes:
```typescript
// In PipelineStack
const topic = new sns.Topic(this, 'PipelineNotifications');
// Add EventBridge rules for pipeline state changes
```

### Advanced Deployment Strategies
- Blue/Green deployments with CodeDeploy
- Canary releases with Lambda aliases
- Database migrations with custom CodeBuild projects

## Security Considerations

1. **Least Privilege**: Consider scoping IAM permissions to specific resources
2. **Secrets Management**: Use AWS Secrets Manager for sensitive configuration
3. **Branch Protection**: Protect your main branch to prevent unauthorized deployments
4. **Manual Approvals**: Required between stages to prevent accidental production deployments
5. **Audit Trail**: All deployments are logged in CloudTrail and CodePipeline history

## Cost Optimization

- **CodeBuild**: Uses on-demand pricing, only charges for build time
- **Caching**: Buildspecs include pnpm and Docker layer caching
- **Artifact Storage**: S3 bucket for pipeline artifacts (minimal cost)
- **Lambda**: Pay-per-request pricing for deployed functions
