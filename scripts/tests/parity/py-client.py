#!/usr/bin/env python3
"""Cross-SDK parity client (Python)."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "sdks" / "python"))

from paycrest_sdk import PaycrestClient  # noqa: E402

base_url = os.environ.get("PAYCREST_BASE_URL")
if not base_url:
    print("PAYCREST_BASE_URL is required", file=sys.stderr)
    sys.exit(1)

client = PaycrestClient(sender_api_key="parity-key", base_url=base_url)
sender = client.sender()

order = sender.create_offramp_order({
    "amount": "100",
    "source": {"type": "crypto", "currency": "USDT", "network": "base", "refundAddress": "0xabc"},
    "destination": {
        "type": "fiat",
        "currency": "NGN",
        "recipient": {
            "institution": "GTBINGLA",
            "accountIdentifier": "1234567890",
            "accountName": "Jane Doe",
            "memo": "Payout",
        },
    },
})
if not order.get("id"):
    print("py-client: no order id returned", file=sys.stderr)
    sys.exit(2)
refreshed = sender.get_order(order["id"])
if refreshed.get("status") != "settled":
    print(f"py-client: unexpected status {refreshed.get('status')}", file=sys.stderr)
    sys.exit(3)
print("py-client: OK")
