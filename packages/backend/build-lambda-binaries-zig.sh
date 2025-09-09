#!/bin/bash

# Cross-compilation build script using Zig for Lambda binaries
# Works consistently on M3 Mac and AWS CodeBuild

set -e
set -o pipefail  # Exit on pipe failures too

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
echo "🔨 Starting cargo zigbuild..."
if ! cargo zigbuild --release --target aarch64-unknown-linux-musl; then
    echo "❌ cargo zigbuild failed!"
    exit 1
fi
echo "✅ cargo zigbuild completed successfully"

# Determine Cargo target directory robustly (handles workspace root vs package-local)
# Prefer cargo metadata when available; fallback to local target directory
TARGET_DIR_ROOT=$(cargo metadata --format-version 1 -q 2>/dev/null | jq -r .target_directory 2>/dev/null || echo "$(pwd)/target")
ARCH_TARGET="aarch64-unknown-linux-musl"
echo "📂 Using Cargo target directory: $TARGET_DIR_ROOT"

# Extract binary names from Cargo.toml
LAMBDA_BINARIES=$(grep -A 1 '^\[\[bin\]\]' Cargo.toml | grep '^name = ' | sed 's/name = "\(.*\)"/\1/' | tr -d '"')

echo "📋 Found Lambda binaries:"
for binary in $LAMBDA_BINARIES; do
    echo "  - $binary"
done

if [ -z "$LAMBDA_BINARIES" ]; then
    echo "❌ No binaries found in Cargo.toml!"
    exit 1
fi

# Create lambda directory structure and copy binaries
echo "📁 Creating Lambda directory structure..."
mkdir -p target/lambda

for binary in $LAMBDA_BINARIES; do
    echo "📦 Processing $binary..."
    
    # Create directory for this lambda
    mkdir -p "target/lambda/$binary"
    
    # Check if binary exists (prefer cross-compiled musl target under the resolved cargo target directory)
    SOURCE_BINARY="$TARGET_DIR_ROOT/$ARCH_TARGET/release/$binary"
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
        echo "  🚨 Build failed - exiting with error code 1"
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
