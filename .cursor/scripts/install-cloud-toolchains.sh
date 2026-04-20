#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
else
    SUDO=""
fi

export DEBIAN_FRONTEND=noninteractive

# Install core packages needed for language toolchains and smoke scripts.
$SUDO apt-get update
$SUDO apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common \
    build-essential \
    pkg-config \
    libssl-dev \
    unzip \
    git

# Ensure Node.js and npm defaults are available from apt.
$SUDO apt-get install -y --no-install-recommends nodejs npm

# Ensure Go launcher for versioned toolchains is available.
$SUDO apt-get install -y --no-install-recommends golang-go

if ! command -v go1.26.0 >/dev/null 2>&1; then
    mkdir -p "$HOME/go/bin"
    go install golang.org/dl/go1.26.0@latest
fi

if [ -x "$HOME/go/bin/go1.26.0" ]; then
    $SUDO ln -sf "$HOME/go/bin/go1.26.0" /usr/local/bin/go1.26.0
fi

export PATH="$HOME/go/bin:$PATH"
command -v go1.26.0 >/dev/null
go1.26.0 download

# Install rustup and stable toolchain with formatter/lints.
if ! command -v rustup >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --default-toolchain stable
fi

if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.cargo/env"
fi

rustup toolchain install stable
rustup default stable
rustup component add rustfmt clippy --toolchain stable

for bin in rustup cargo rustfmt clippy-driver; do
    if [ -x "$HOME/.cargo/bin/$bin" ]; then
        $SUDO ln -sf "$HOME/.cargo/bin/$bin" "/usr/local/bin/$bin"
    fi
done

export PATH="$HOME/.cargo/bin:$PATH"

# Validate required tools are on PATH for smoke scripts.
command -v node >/dev/null
command -v npm >/dev/null
command -v cargo >/dev/null
command -v rustfmt >/dev/null
command -v clippy-driver >/dev/null
go1.26.0 version >/dev/null
