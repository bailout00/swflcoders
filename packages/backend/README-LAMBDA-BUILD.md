# Lambda Binary Build System

This directory contains scripts to automatically build all Rust Lambda binaries for deployment with AWS CDK.

## Overview

The build system automatically detects all Lambda binaries defined in `Cargo.toml` and builds them in the correct format for Lambda deployment. Each binary is compiled and copied to `target/lambda/<binary-name>/bootstrap` for CDK to package.

## Build Scripts

### 1. Native Build with Fallback (`build-lambda-binaries.sh`)

**Recommended for development and most use cases.**

```bash
# Build all Lambda binaries (tries ARM64, falls back to native)
pnpm build:lambda

# Clean build all Lambda binaries  
pnpm build:lambda:clean

# Or run directly
./build-lambda-binaries.sh
./build-lambda-binaries.sh --clean
```

**How it works:**
1. Attempts to build for ARM64 Linux (`aarch64-unknown-linux-gnu`)
2. If cross-compilation fails (common on macOS), falls back to native build
3. Creates `target/lambda/<binary>/bootstrap` for each Lambda function
4. Reports build status and binary sizes

### 2. Docker Build (`build-lambda-binaries-docker.sh`)

**Use when you need true ARM64 Linux binaries for production deployment.**

```bash
# Build all Lambda binaries using Docker
pnpm build:lambda:docker

# Clean build using Docker
pnpm build:lambda:docker:clean

# Or run directly
./build-lambda-binaries-docker.sh
./build-lambda-binaries-docker.sh --clean
```

**How it works:**
1. Creates a temporary Docker image with Amazon Linux 2023
2. Installs Rust and ARM64 cross-compilation tools
3. Builds all binaries inside the container
4. Copies binaries to host filesystem
5. Cleans up Docker artifacts

## Lambda Functions

The build system automatically detects these Lambda functions from `Cargo.toml`:

- **backend** - Main REST API Lambda (`../backend/target/lambda/backend/`)
- **ws-connect** - WebSocket connect handler (`../backend/target/lambda/ws-connect/`)
- **ws-disconnect** - WebSocket disconnect handler (`../backend/target/lambda/ws-disconnect/`)
- **ws-default** - WebSocket default message handler (`../backend/target/lambda/ws-default/`)
- **ws-broadcast** - WebSocket broadcast handler (`../backend/target/lambda/ws-broadcast/`)

## CDK Integration

The CDK stack (`packages/cdk/lib/stacks/api-stack.ts`) expects pre-built binaries in the `target/lambda/` directories:

```typescript
// Each Lambda uses pre-built binaries
code: lambda.Code.fromAsset('../backend/target/lambda/backend')
code: lambda.Code.fromAsset('../backend/target/lambda/ws-connect')
// ... etc
```

## Development Workflow

### For Local Development/Testing
```bash
# Quick build for testing (uses native binaries)
cd packages/backend
pnpm build:lambda
```

### For Production Deployment
```bash
# Build true ARM64 binaries for Lambda
cd packages/backend  
pnpm build:lambda:docker

# Deploy with CDK
cd packages/cdk
pnpm deploy:beta  # or deploy:gamma, deploy:prod
```

## Adding New Lambda Functions

To add a new Lambda function:

1. **Add binary to `Cargo.toml`:**
   ```toml
   [[bin]]
   name = "my-new-lambda"
   path = "src/lambdas/my_new_lambda.rs"
   ```

2. **Create the source file:**
   ```rust
   // src/lambdas/my_new_lambda.rs
   use lambda_runtime::{run, service_fn, Error, LambdaEvent};
   // ... your Lambda code
   ```

3. **Build binaries:**
   ```bash
   pnpm build:lambda
   ```

4. **Update CDK stack:**
   ```typescript
   const myNewFunction = new lambda.Function(this, 'MyNewFunction', {
     // ...
     code: lambda.Code.fromAsset('../backend/target/lambda/my-new-lambda'),
     // ...
   });
   ```

The build script will automatically detect and build the new binary!

## Troubleshooting

### Cross-compilation fails on macOS
This is expected. The native build fallback will work for development. Use Docker build for production.

### Missing binaries after build
- Check that `Cargo.toml` has the correct `[[bin]]` entries
- Ensure source files exist at the specified paths
- Run with `--clean` to force a fresh build

### Docker build fails
- Ensure Docker is installed and running
- Check that you have sufficient disk space
- Try `docker system prune` to clean up Docker resources

## Architecture Notes

- **Native builds** work for local development and testing but may not run on Lambda
- **ARM64 Linux builds** are required for production Lambda deployment
- **Bootstrap naming** is required - Lambda runtime looks for a file named `bootstrap`
- **File permissions** are preserved - binaries are marked executable automatically
