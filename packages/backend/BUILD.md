# Building Lambda Binaries

This project uses Zig for cross-compilation to build ARM64 Linux binaries that run efficiently on AWS Lambda.

## Prerequisites

### Local Development (M3 Mac)

1. **Rust**: Already installed via rustup
2. **Zig**: Install via Homebrew
   ```bash
   brew install zig
   ```
3. **cargo-zigbuild**: Install via cargo
   ```bash
   cargo install cargo-zigbuild
   ```
4. **ARM64 musl target**: Add the target
   ```bash
   rustup target add aarch64-unknown-linux-musl
   ```

### AWS CodeBuild

All dependencies are automatically installed via the build buildspec (`packages/cdk/buildspecs/build.yml`).

## Building

### Quick Build
```bash
# Build all Lambda binaries for ARM64 Linux
pnpm build:lambda

# Clean build (removes all cached artifacts first)
pnpm build:lambda:clean
```

### Available Scripts
```bash
# Default: Zig cross-compilation (recommended)
pnpm build:lambda           # Uses Zig cross-compilation
pnpm build                  # Same as build:lambda

# Alternative methods (fallback/testing)
pnpm build:lambda:docker    # Docker-based build (if Docker issues persist)
pnpm build:lambda:native    # Direct cargo build (native only)
pnpm build:lambda:smart     # Attempts Docker, falls back to native

# Development
pnpm build:native           # Native cargo build (for local testing)
pnpm dev                    # Run locally with cargo run
```

## How It Works

### Zig Cross-Compilation

The Zig build process (`build-lambda-binaries-zig.sh`):

1. **Cross-compiles** all Rust binaries to ARM64 Linux using `cargo zigbuild --target aarch64-unknown-linux-musl`
2. **Organizes** binaries into Lambda-ready structure:
   ```
   target/lambda/
   ├── backend/bootstrap
   ├── ws-connect/bootstrap
   ├── ws-disconnect/bootstrap
   ├── ws-default/bootstrap
   └── ws-broadcast/bootstrap
   ```
3. **Verifies** that binaries are ARM64 ELF executables
4. **Reports** binary sizes and readiness

### Benefits of Zig

- ✅ **Consistent**: Same ARM64 Linux binaries on M3 Mac and AWS CodeBuild
- ✅ **Fast**: No Docker overhead, direct cross-compilation  
- ✅ **Reliable**: Statically linked musl binaries work consistently
- ✅ **Efficient**: Smaller binary sizes, faster cold starts on Lambda

### Output Verification

All binaries are verified as ARM64 ELF:
```bash
$ file target/lambda/backend/bootstrap
target/lambda/backend/bootstrap: ELF 64-bit LSB executable, ARM aarch64, version 1 (SYSV), statically linked, stripped
```

## Pipeline Integration

The AWS CodePipeline automatically:
1. **Installs** Rust, Zig, and cargo-zigbuild in the build environment
2. **Cross-compiles** all Lambda binaries during the build phase
3. **Packages** binaries for CDK deployment
4. **Deploys** to each stage (beta → gamma → prod)

No manual intervention required - the pipeline handles everything from source to deployment.

## Troubleshooting

### Build Failures
- Ensure Zig is installed: `zig version`
- Ensure cargo-zigbuild is installed: `cargo zigbuild --help`
- Check target is added: `rustup target list --installed | grep aarch64-unknown-linux-musl`

### Binary Issues
- Verify binary architecture: `file target/lambda/*/bootstrap`
- Check for correct Lambda directory structure
- Ensure bootstrap files are executable: `ls -la target/lambda/*/bootstrap`

### Alternative Builds
If Zig cross-compilation fails, fallback options:
- `pnpm build:lambda:docker` - Docker-based cross-compilation
- `pnpm build:lambda:native` - Native build (ARM64 Mac only)
