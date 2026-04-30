#!/usr/bin/env bash
# Cross-SDK parity harness.
#
# Starts a tiny Python fixture server and drives each SDK through the
# same off-ramp scenario (rate-first create → get). After each client
# runs it snapshots the recorded HTTP calls and asserts they match the
# golden parity envelope: exactly `[GET /rates/..., POST /sender/orders,
# GET /sender/orders/:id]` in that order, with the expected bodies.
#
# Runs all five SDKs: TypeScript, Python, Go, Rust, PHP. Any SDK whose
# toolchain is missing is skipped with a message; the harness stays
# green in that case so contributors can run partial validation.
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../../.." && pwd)}"
HARNESS_DIR="$ROOT/scripts/tests/parity"

# --- start fixture server ------------------------------------------------
SERVER_LOG="$(mktemp)"
cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -f "$SERVER_LOG"
}
trap cleanup EXIT

python3 "$HARNESS_DIR/fixture_server.py" > "$SERVER_LOG" &
SERVER_PID=$!

# wait for the server to print its port (first line of stdout)
for _ in $(seq 1 50); do
    PORT="$(head -n 1 "$SERVER_LOG" 2>/dev/null || true)"
    if [[ -n "$PORT" ]]; then
        break
    fi
    sleep 0.1
done
if [[ -z "${PORT:-}" ]]; then
    echo "fixture server never reported a port" >&2
    exit 1
fi

SERVER_ROOT="http://127.0.0.1:$PORT"
BASE_URL="$SERVER_ROOT/v2"
export PAYCREST_BASE_URL="$BASE_URL"
echo "parity: fixture server on $BASE_URL"

# --- helpers -------------------------------------------------------------
reset_server() {
    curl -sS -X POST "$SERVER_ROOT/__reset" >/dev/null
}

fetch_calls() {
    curl -sS "$SERVER_ROOT/__calls"
}

assert_parity() {
    local sdk_name="$1"
    fetch_calls | python3 "$HARNESS_DIR/assert_parity.py" "$sdk_name"
}

# --- TypeScript ----------------------------------------------------------
if command -v node >/dev/null 2>&1; then
    ( cd "$ROOT/sdks/typescript" && npm run --silent build >/dev/null )
    reset_server
    node "$HARNESS_DIR/ts-client.mjs"
    assert_parity typescript
else
    echo "parity: skipping typescript (node missing)"
fi

# --- Python --------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
    ( cd "$ROOT/sdks/python" && python3 -m pip install --quiet --disable-pip-version-check . >/dev/null 2>&1 ) || true
    reset_server
    python3 "$HARNESS_DIR/py-client.py"
    assert_parity python
else
    echo "parity: skipping python (python3 missing)"
fi

# --- Go ------------------------------------------------------------------
GO_CMD=""
if command -v go1.26.0 >/dev/null 2>&1; then
    GO_CMD="go1.26.0"
elif command -v go >/dev/null 2>&1; then
    GO_CMD="go"
fi
if [[ -n "$GO_CMD" ]]; then
    reset_server
    ( cd "$HARNESS_DIR/go-client" && "$GO_CMD" run . )
    assert_parity go
else
    echo "parity: skipping go (go toolchain missing)"
fi

# --- Rust ----------------------------------------------------------------
if command -v cargo >/dev/null 2>&1; then
    reset_server
    ( cd "$HARNESS_DIR/rust-client" && cargo run --quiet )
    assert_parity rust
else
    echo "parity: skipping rust (cargo missing)"
fi

# --- PHP -----------------------------------------------------------------
if command -v php >/dev/null 2>&1 && [[ -d "$ROOT/sdks/laravel/vendor" ]]; then
    reset_server
    php "$HARNESS_DIR/php-client.php"
    assert_parity php
else
    echo "parity: skipping php (php or composer install missing)"
fi

echo "parity: all checks passed"
