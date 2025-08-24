#!/bin/bash

# Build script for Lambda binaries
# This script builds all Rust Lambda binaries for ARM64 and organizes them for CDK deployment

set -e

echo "🚀 Building Lambda binaries for ARM64..."

# Change to backend directory
cd "$(dirname "$0")"

# Clean previous builds (optional)
if [ "$1" = "--clean" ]; then
    echo "🧹 Cleaning previous builds..."
    cargo clean
fi

# Ensure ARM64 target is installed
echo "📦 Ensuring ARM64 target is available..."
rustup target add aarch64-unknown-linux-gnu

# Build all binaries for ARM64
echo "🔨 Building all binaries for ARM64..."
if cargo build --release --target aarch64-unknown-linux-gnu; then
    echo "✅ ARM64 build successful"
    TARGET_DIR="target/aarch64-unknown-linux-gnu/release"
else
    echo "⚠️  ARM64 cross-compilation failed. Falling back to native build..."
    echo "🔨 Building for native target..."
    cargo build --release
    TARGET_DIR="target/release"
    echo "📝 Note: You're using native binaries. For Lambda deployment, you'll need ARM64 binaries."
    echo "    Consider using Docker for cross-compilation or building on an ARM64 system."
fi

# Extract binary names from Cargo.toml
echo "🔍 Extracting Lambda binary names from Cargo.toml..."
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
    SOURCE_BINARY="$TARGET_DIR/$binary"
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

echo ""
echo "🚀 Ready for CDK deployment!"
