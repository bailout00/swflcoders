# CDK Pipeline Setup

This project uses AWS CDK Pipelines for a modern, self-mutating CI/CD pipeline that automatically builds, tests, and deploys your application across multiple environments.

## Architecture

The pipeline creates a hierarchical stack structure:
```
SwflcodersPipelineStack/
├── Beta/
│   ├── ApiStack
│   └── CloudwatchDashboardStack
├── Gamma/
│   ├── ApiStack
│   └── CloudwatchDashboardStack
└── Prod/
    ├── ApiStack
    └── CloudwatchDashboardStack
```

## Pipeline Flow

1. **Source**: GitHub repository via CodeStar Connection
2. **Build**: Installs Node.js, Rust, Zig, and builds all Lambda binaries
3. **Self-Mutate**: Updates the pipeline itself if CDK code changes
4. **Deploy Beta**: Deploys to beta environment → E2E tests
5. **Deploy Gamma**: Manual approval → Deploy to gamma → E2E tests
6. **Deploy Prod**: Manual approval → Deploy to production

## Setup Instructions

### 1. Update Configuration

Edit `lib/config.ts` and update these values:

```typescript
// Update with your actual GitHub details
export const pipelineConfig: PipelineConfig = {
  // ... existing config
  github: {
    owner: 'your-github-username',        // ← Your GitHub username
    repo: 'repo-name',                  // ← Your repository name
    branch: 'main',                      // ← Your main branch
    connectionArn: 'arn:aws:codestar-connections:us-east-1:<pipeline account>:connection/YOUR_CONNECTION_ID', // ← Your CodeStar connection
  },
};

// Update with your actual AWS account IDs
const BETA_ACCOUNT = '';     // ← Your beta account
const GAMMA_ACCOUNT = '';    // ← Your gamma account  
const PROD_ACCOUNT = '';     // ← Your prod account
```

### 2. Create CodeStar Connection

1. Go to AWS Console → CodePipeline → Settings → Connections
2. Create a new connection to GitHub
3. Complete the GitHub authorization
4. Copy the connection ARN to your config

### 3. Bootstrap CDK

Bootstrap CDK in all accounts and regions:

```bash
# Pipeline account (where the pipeline runs)
cdk bootstrap aws://<pipeline account>/us-east-1

# Beta account
cdk bootstrap aws://<beta account>/us-east-1

# Gamma account  
cdk bootstrap aws://<gamma account>/us-east-1

# Prod account
cdk bootstrap aws://<prod account>/us-east-1
```

### 4. Deploy Pipeline

Deploy the pipeline stack:

```bash
yarn deploy:pipeline
```

This deploys the pipeline stack with all stages. The pipeline will immediately start running and deploy to all environments.

## Available Commands

### Pipeline Management
```bash
yarn list:pipeline      # List all pipeline stacks
yarn synth:pipeline     # Synthesize pipeline CloudFormation
yarn diff:pipeline      # Show changes to pipeline
yarn deploy:pipeline    # Deploy the pipeline stack
```

### Individual Stage Development
```bash
yarn deploy:beta        # Deploy just beta stage locally
yarn deploy:gamma       # Deploy just gamma stage locally  
yarn deploy:prod        # Deploy just prod stage locally
```

### General
```bash
yarn build             # Build project and synthesize stacks
yarn type-check        # TypeScript type checking
```

## Pipeline Features

### ✅ Self-Mutating
The pipeline automatically updates itself when you change CDK code. No manual pipeline updates needed.

### ✅ Cross-Account
Deploys to separate AWS accounts for proper environment isolation.

### ✅ Rust/Zig Integration
Automatically installs Rust, Zig, and builds ARM64 Lambda binaries during the build phase.

### ✅ Manual Approvals
Gamma and Prod deployments require manual approval for safety.

### ✅ E2E Testing
Runs end-to-end tests after Beta and Gamma deployments.

### ✅ Caching
Caches npm packages, Cargo dependencies, and Docker layers for faster builds.

## Monitoring

Once deployed, monitor your pipeline:
- **AWS Console → CodePipeline → SwflcodersApp**
- **CloudWatch Logs** for build and deployment logs
- **CloudFormation Console** to view deployed stacks

## Troubleshooting

### Pipeline Build Failures
1. Check CodeBuild logs in CloudWatch
2. Ensure GitHub connection is working
3. Verify account IDs and permissions

### Deployment Failures
1. Check CDK bootstrap status in target accounts
2. Verify IAM permissions for cross-account deployment
3. Review CloudFormation stack events

### GitHub Integration
1. Ensure CodeStar connection is `AVAILABLE` status
2. Check webhook is created in GitHub repository
3. Verify branch name matches configuration

The pipeline will automatically handle deployments on every push to your main branch!
