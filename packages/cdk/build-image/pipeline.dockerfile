# Custom CodeBuild image for swflcoders project with Yarn, Rust, and dependencies
# ARM64-native build image for faster Lambda deployment and compatibility
FROM --platform=linux/arm64 public.ecr.aws/debian/debian:trixie

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH \
    RUST_VERSION=1.88.0 \
    NODE_VERSION=22

RUN apt update && apt upgrade -y

# Install system dependencies (ARM64-native)
RUN apt install -y \
    ca-certificates \
    curl \
    jq \
    wget \
    unzip \
    git \
    openssh-client \
    gnupg \
    build-essential \
    clang \
    lld \
    python3 \
    pkg-config \
    libssl-dev \
    musl-dev \
    musl-tools \
    npm \
    awscli \
    docker.io

RUN npm install npm -g
  
# Install Node.js 22 (Debian NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get update && apt-get install -y nodejs

# Enable Corepack and prepare Yarn
RUN corepack enable && corepack prepare yarn@4.5.1 --activate && yarn -v

# Install Rust with native ARM64 and cross-compilation support
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain $RUST_VERSION && \
    chmod -R a+w $RUSTUP_HOME $CARGO_HOME

# Add ARM64 targets for Lambda deployment (native ARM64 build)
RUN rustup target add aarch64-unknown-linux-gnu && \
    rustup target add aarch64-unknown-linux-musl

# Install sccache for build caching
RUN cargo install sccache && sccache --version

# Install Zig for cross-compilation support (ARM64 version)
RUN wget https://ziglang.org/download/0.13.0/zig-linux-aarch64-0.13.0.tar.xz && \
    tar -xf zig-linux-aarch64-0.13.0.tar.xz && \
    mv zig-linux-aarch64-0.13.0 /usr/local/zig && \
    rm zig-linux-aarch64-0.13.0.tar.xz

# Add Zig to PATH
ENV PATH=/usr/local/zig:$PATH

# Install cargo-zigbuild for Zig-based cross-compilation
RUN cargo install cargo-zigbuild

# Set up cross-compilation environment variables (primarily for musl builds)
ENV CC_aarch64_unknown_linux_gnu=clang \
    CXX_aarch64_unknown_linux_gnu=clang++ \
    AR_aarch64_unknown_linux_gnu=llvm-ar \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=clang \
    RUSTFLAGS="-Clinker=clang -Clink-arg=-fuse-ld=lld"

# Default sccache config
ENV RUSTC_WRAPPER=/usr/local/cargo/bin/sccache \
    SCCACHE_DIR=/codebuild/sccache

# Set working directory
WORKDIR /usr/src/app

# Default command
CMD ["bash"]
