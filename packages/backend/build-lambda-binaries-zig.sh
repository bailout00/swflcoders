#!/bin/bash

# Cross-compilation build script using Zig for Lambda binaries
# Works consistently on M3 Mac and AWS CodeBuild

set -e

echo "🦎 Building Lambda binaries using Zig cross-compilation for ARM64..."
echo "📍 Host: $(uname -m) $(uname -s)"
echo "🔧 Zig: $(zig version 2>/dev/null || echo 'Not available')"

# Change to backend directory
cd "$(dirname "$0")"

# Clean previous builds (optional)
if [ "$1" = "--clean" ]; then
    echo "🧹 Cleaning previous builds..."
    cargo clean
fi

echo "🔨 Building all binaries for ARM64 Linux (musl)..."

# Build all binaries for ARM64 Linux using Zig
cargo zigbuild --release --target aarch64-unknown-linux-musl

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
    SOURCE_BINARY="target/aarch64-unknown-linux-musl/release/$binary"
    TARGET_BOOTSTRAP="target/lambda/$binary/bootstrap"
    
    if [ -f "$SOURCE_BINARY" ]; then
        # Copy and rename to bootstrap
        cp "$SOURCE_BINARY" "$TARGET_BOOTSTRAP"
        chmod +x "$TARGET_BOOTSTRAP"
        
        # Verify the binary
        file "$TARGET_BOOTSTRAP" || echo "  (file command not available)"
        echo "  ✅ $binary -> target/lambda/$binary/bootstrap ($(stat -c%s "$TARGET_BOOTSTRAP" 2>/dev/null || stat -f%z "$TARGET_BOOTSTRAP") bytes)"
    else
        echo "  ❌ Binary not found: $SOURCE_BINARY"
        echo "     This might indicate a build failure for $binary"
        exit 1
    fi
done

echo ""
echo "🎉 Lambda binaries built successfully using Zig cross-compilation!"
echo ""
echo "📋 Summary:"
ls -la target/lambda/*/bootstrap | while read -r line; do
    echo "  $(echo "$line" | awk '{print $9, "(" $5 " bytes)"}')"
done

echo ""
echo "🚀 Ready for CDK deployment!"
