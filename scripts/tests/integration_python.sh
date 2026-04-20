#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/python"

if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not installed, skipping python integration"
    exit 0
fi

if [[ -z "${PAYCREST_SENDER_API_KEY:-}" || -z "${PAYCREST_PROVIDER_API_KEY:-}" ]]; then
    echo "PAYCREST_SENDER_API_KEY and PAYCREST_PROVIDER_API_KEY not set, skipping python integration"
    exit 0
fi

python3 <<'PY'
import os
from paycrest_sdk import PaycrestClient

base_url = os.environ.get("PAYCREST_BASE_URL", "https://api.paycrest.io/v2")
sender_key = os.environ["PAYCREST_SENDER_API_KEY"]
provider_key = os.environ["PAYCREST_PROVIDER_API_KEY"]

client = PaycrestClient(
    sender_api_key=sender_key,
    provider_api_key=provider_key,
    base_url=base_url,
)

sender_stats = client.sender().get_stats()
provider_stats = client.provider().get_stats()

if not isinstance(sender_stats, dict):
    raise RuntimeError("sender stats response is not a dict")
if not isinstance(provider_stats, dict):
    raise RuntimeError("provider stats response is not a dict")

print("python integration test passed")
PY
