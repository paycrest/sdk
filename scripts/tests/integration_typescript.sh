#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT/sdks/typescript"

if [[ -z "${PAYCREST_BASE_URL:-}" || -z "${PAYCREST_SENDER_API_KEY:-}" ]]; then
    echo "TypeScript integration skipped (PAYCREST_BASE_URL and PAYCREST_SENDER_API_KEY required)"
    exit 0
fi

npm install --no-fund --no-audit
npm run build

node --input-type=module <<'EOF'
import { createPaycrestClient } from "./dist/index.js";

const baseUrl = process.env.PAYCREST_BASE_URL;
const senderApiKey = process.env.PAYCREST_SENDER_API_KEY;
const providerApiKey = process.env.PAYCREST_PROVIDER_API_KEY;

const client = createPaycrestClient({
  baseUrl,
  senderApiKey,
  providerApiKey,
});

const senderStats = await client.sender().getStats();
if (!senderStats || typeof senderStats !== "object") {
  throw new Error("sender stats response is invalid");
}
console.log("typescript integration sender stats ok");

if (providerApiKey) {
  const providerStats = await client.provider().getStats();
  if (!providerStats || typeof providerStats !== "object") {
    throw new Error("provider stats response is invalid");
  }
  console.log("typescript integration provider stats ok");
} else {
  console.log("typescript integration provider skipped (PAYCREST_PROVIDER_API_KEY missing)");
}
EOF
