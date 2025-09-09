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

# Create symlink for docker command (CDK looks for 'docker', not 'docker.io')
RUN ln -sf /usr/bin/docker.io /usr/bin/docker

RUN npm install npm -g
  
# Install Node.js 22 (Debian NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get update && apt-get install -y nodejs

# Enable Corepack and prepare Yarn (matching CodeBuild version)
RUN corepack enable && corepack prepare yarn@4.9.2 --activate && yarn -v

# Install Rust with native ARM64 and cross-compilation support
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain $RUST_VERSION && \
    chmod -R a+w $RUSTUP_HOME $CARGO_HOME

# Add ARM64 targets for Lambda deployment (native ARM64 build)
RUN rustup target add aarch64-unknown-linux-gnu && \
    rustup target add aarch64-unknown-linux-musl

# Build caching removed - using CodeBuild's built-in S3 caching instead

# Configure Docker daemon
RUN mkdir -p /etc/docker && \
    echo '{"storage-driver": "overlay2", "mtu": 1450}' > /etc/docker/daemon.json

# Create Docker group and add codebuild-user
RUN groupadd -g 497 docker || true

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

RUN npx playwright install && npx playwright install-deps
# Removed sccache environment configuration

# Set working directory
WORKDIR /usr/src/app

# Start Docker daemon and set up environment
RUN service docker start || true

# Set up entrypoint to ensure Docker is running
COPY <<EOF /usr/local/bin/docker-entrypoint.sh
#!/bin/bash
# Start Docker daemon if not already running
if ! pgrep -f dockerd > /dev/null; then
    echo "Starting Docker daemon..."
    dockerd &
    sleep 2
fi

# Add user to docker group if not already
if ! groups | grep -q docker; then
    usermod -a -G docker codebuild-user 2>/dev/null || true
fi

# Execute the main command
exec "\$@"
EOF

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Default command with Docker entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bash"]
