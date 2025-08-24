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
