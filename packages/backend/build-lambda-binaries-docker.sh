#!/bin/bash

# Docker-based build script for Lambda binaries
# This script uses Docker to build all Rust Lambda binaries for ARM64 in a Linux environment
# Works consistently on M3 Mac, Intel Mac, and AWS CodeBuild

set -e

echo "🐳 Building Lambda binaries using Docker for ARM64..."
echo "📍 Host: $(uname -m) $(uname -s)"
echo "🐋 Docker: $(docker --version 2>/dev/null || echo 'Not available')"

# Change to backend directory
cd "$(dirname "$0")"

# Clean previous builds (optional)
if [ "$1" = "--clean" ]; then
    echo "🧹 Cleaning previous builds..."
    cargo clean
    docker system prune -f --volumes 2>/dev/null || true
fi

# Create a Dockerfile for building (from parent directory context)
cat > ../Dockerfile.lambda-builder << 'EOF'
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# Install build dependencies
RUN yum update -y && \
    yum install -y gcc gcc-c++ openssl-devel pkgconfig zip tar gzip && \
    yum clean all

# Install Rust
RUN curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Add ARM64 target
RUN rustup target add aarch64-unknown-linux-gnu

# Set working directory
WORKDIR /workspace

# Copy package structure (from packages/ context)
COPY backend/Cargo.toml backend/Cargo.lock ./backend/
COPY backend/src ./backend/src/
COPY types ./types/

# Change to backend directory for build
WORKDIR /workspace/backend

# Build all binaries
RUN cargo build --release --target aarch64-unknown-linux-gnu

# Create lambda directory structure and organize binaries
RUN mkdir -p target/lambda && \
    for binary in $(grep -A 1 '^\[\[bin\]\]' Cargo.toml | grep '^name = ' | sed 's/name = "\(.*\)"/\1/' | tr -d '"'); do \
        mkdir -p "target/lambda/$binary" && \
        cp "target/aarch64-unknown-linux-gnu/release/$binary" "target/lambda/$binary/bootstrap" && \
        chmod +x "target/lambda/$binary/bootstrap" && \
        echo "Built $binary -> target/lambda/$binary/bootstrap"; \
    done

CMD ["ls", "-la", "target/lambda/"]
EOF

# Create the build script that runs inside Docker
cat > build-in-docker.sh << 'EOF'
#!/bin/bash
set -e

echo "🔨 Building all binaries for ARM64 inside Docker..."

# Build all binaries for ARM64
cargo build --release --target aarch64-unknown-linux-gnu

# Extract binary names from Cargo.toml
LAMBDA_BINARIES=$(grep -A 1 '^\[\[bin\]\]' Cargo.toml | grep '^name = ' | sed 's/name = "\(.*\)"/\1/' | tr -d '"')

echo "📋 Found Lambda binaries:"
for binary in $LAMBDA_BINARIES; do
    echo "  - $binary"
done

# Create lambda directory structure and copy binaries
echo "📁 Creating Lambda directory structure..."
mkdir -p target/lambda

for binary in $LAMBDA_BINARIES; do
    echo "📦 Processing $binary..."
    
    # Create directory for this lambda
    mkdir -p "target/lambda/$binary"
    
    # Check if binary exists
    SOURCE_BINARY="target/aarch64-unknown-linux-gnu/release/$binary"
    TARGET_BOOTSTRAP="target/lambda/$binary/bootstrap"
    
    if [ -f "$SOURCE_BINARY" ]; then
        # Copy and rename to bootstrap
        cp "$SOURCE_BINARY" "$TARGET_BOOTSTRAP"
        chmod +x "$TARGET_BOOTSTRAP"
        echo "  ✅ $binary -> target/lambda/$binary/bootstrap"
    else
        echo "  ❌ Binary not found: $SOURCE_BINARY"
        echo "     This might indicate a build failure for $binary"
        exit 1
    fi
done

echo ""
echo "🎉 Lambda binaries built successfully!"
echo ""
echo "📋 Summary:"
ls -la target/lambda/*/bootstrap | while read -r line; do
    echo "  $(echo "$line" | awk '{print $9, "(" $5 " bytes)"}')"
done
EOF

chmod +x build-in-docker.sh

echo "🐳 Building Docker image..."
docker build -f ../Dockerfile.lambda-builder -t lambda-builder ..

echo "🐳 Running build in Docker container..."
docker run --rm -v "$(pwd)/target:/workspace/backend/target" lambda-builder

# Clean up
rm -f ../Dockerfile.lambda-builder build-in-docker.sh

echo ""
echo "🚀 Docker build complete! Ready for CDK deployment!"
