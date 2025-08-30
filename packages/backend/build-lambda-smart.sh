#!/bin/bash

# Smart Lambda build script
# Automatically chooses the best build method based on environment and availability
# Optimized for both M3 Mac development and AWS CodeBuild pipeline

set -e

echo "🤖 Smart Lambda Build System"
echo "=============================="

# Change to backend directory
cd "$(dirname "$0")"

# Detect environment
PLATFORM=$(uname -m)
OS=$(uname -s)
IS_CI=${CI:-false}
IS_CODEBUILD=${CODEBUILD_BUILD_ID:-""}

echo "🔍 Environment Detection:"
echo "  Platform: $PLATFORM"
echo "  OS: $OS"
echo "  CI: $IS_CI"
echo "  CodeBuild: ${IS_CODEBUILD:+Yes}"

# Check Docker availability
DOCKER_AVAILABLE=false
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    DOCKER_AVAILABLE=true
    echo "  Docker: Available"
else
    echo "  Docker: Not available"
fi

# Decision logic
BUILD_METHOD=""

if [[ "$IS_CODEBUILD" != "" ]]; then
    # In CodeBuild, use Docker for consistent ARM64 builds
    if [[ "$DOCKER_AVAILABLE" == "true" ]]; then
        BUILD_METHOD="docker"
        echo "🎯 Selected: Docker build (CodeBuild environment)"
    else
        BUILD_METHOD="native-fallback"
        echo "⚠️  Selected: Native fallback (Docker not available in CodeBuild)"
    fi
elif [[ "$PLATFORM" == "arm64" && "$OS" == "Darwin" ]]; then
    # M3 Mac - prefer Docker for consistent Lambda builds
    if [[ "$DOCKER_AVAILABLE" == "true" ]]; then
        BUILD_METHOD="docker"
        echo "🎯 Selected: Docker build (M3 Mac - consistent with pipeline)"
    else
        BUILD_METHOD="native-with-warning"
        echo "⚠️  Selected: Native build with warning (Docker not available)"
    fi
elif [[ "$PLATFORM" == "x86_64" ]]; then
    # Intel Mac/Linux - Docker is preferred for ARM64 cross-compilation
    if [[ "$DOCKER_AVAILABLE" == "true" ]]; then
        BUILD_METHOD="docker"
        echo "🎯 Selected: Docker build (x86_64 host, cross-compiling to ARM64)"
    else
        BUILD_METHOD="native-fallback"
        echo "⚠️  Selected: Native fallback (Docker not available)"
    fi
else
    BUILD_METHOD="native-fallback"
    echo "🤷 Selected: Native fallback (unknown environment)"
fi

echo ""
echo "🚀 Executing build..."

case $BUILD_METHOD in
    "docker")
        echo "🚫 Docker build disabled by project policy; falling back to native build."
        ./build-lambda-binaries.sh "$@"
        ;;
    "native-with-warning")
        echo "⚠️  Using native build - binaries may not work on Lambda ARM64"
        echo "   Consider installing Docker for consistent builds"
        ./build-lambda-binaries.sh "$@"
        ;;
    "native-fallback")
        echo "📝 Using native build as fallback"
        ./build-lambda-binaries.sh "$@"
        ;;
    *)
        echo "❌ Unknown build method: $BUILD_METHOD"
        exit 1
        ;;
esac

echo ""
echo "✅ Build completed with method: $BUILD_METHOD"

# Verification
if [[ -d "target/lambda" ]]; then
    echo ""
    echo "🔍 Build Verification:"
    for bootstrap in target/lambda/*/bootstrap; do
        if [[ -f "$bootstrap" ]]; then
            ARCH=$(file "$bootstrap" 2>/dev/null | grep -o 'aarch64\|x86-64\|ARM' || echo "unknown")
            SIZE=$(ls -lh "$bootstrap" | awk '{print $5}')
            echo "  $(basename $(dirname $bootstrap)): $SIZE ($ARCH)"
        fi
    done
    
    if [[ "$BUILD_METHOD" == "native-with-warning" ]]; then
        echo ""
        echo "⚠️  WARNING: Native binaries may not work on AWS Lambda ARM64"
        echo "   Recommend using Docker build for production deployments"
    fi
fi
