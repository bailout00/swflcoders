# Custom CodeBuild image for swflcoders project with Yarn, Rust, and dependencies
# Multi-platform support: works on ARM64 (M3 Mac) and AMD64 (Intel/AWS)
FROM --platform=linux/amd64 public.ecr.aws/debian/debian:trixie

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH \
    RUST_VERSION=1.88.0 \
    NODE_VERSION=22

RUN apt update && apt upgrade -y

# Install system dependencies (Debian-based)
RUN apt install -y \
    ca-certificates \
    curl \
    wget \
    unzip \
    git \
    openssh-client \
    gnupg \
    build-essential \
    python3 \
    pkg-config \
    libssl-dev \
    npm \
    awscli \
    gcc-aarch64-linux-gnu \
    libc6-dev-arm64-cross

RUN npm install npm -g
  
# Install Node.js 22 (Debian NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get update && apt-get install -y nodejs

# Enable Corepack and prepare Yarn
RUN corepack enable && corepack prepare yarn@4.5.1 --activate && yarn -v

# Install Rust with cross-compilation support for ARM64
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain $RUST_VERSION && \
    chmod -R a+w $RUSTUP_HOME $CARGO_HOME

# Add ARM64 target for Lambda cross-compilation
RUN rustup target add aarch64-unknown-linux-gnu

# Set up cross-compilation environment variables
ENV CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++ \
    AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc

# Set working directory
WORKDIR /usr/src/app

# Default command
CMD ["bash"]
