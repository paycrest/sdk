#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/rust"

if ! command -v cargo >/dev/null 2>&1; then
    echo "cargo is required on PATH for Rust smoke tests"
    exit 1
fi

if ! command -v rustfmt >/dev/null 2>&1; then
    echo "rustfmt is required on PATH for Rust smoke tests"
    exit 1
fi

if ! command -v clippy-driver >/dev/null 2>&1; then
    echo "clippy-driver is required on PATH for Rust smoke tests"
    exit 1
fi

cargo test
