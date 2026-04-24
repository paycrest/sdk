#!/usr/bin/env python3
"""Assert a parity snapshot matches the expected shape.

Reads the JSON array of recorded HTTP calls on stdin and the SDK name
as argv[1]. Exits 0 on success, non-zero with a descriptive error
otherwise. Kept out of the driver shell script so the JSON is piped
straight to stdin without heredoc interference.
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("assert_parity: SDK name argument required", file=sys.stderr)
        return 64
    name = sys.argv[1]
    raw = sys.stdin.read()
    try:
        calls = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"{name}: could not parse calls JSON: {e}\nraw={raw!r}", file=sys.stderr)
        return 1

    if len(calls) != 3:
        print(f"{name}: expected 3 calls, got {len(calls)}: {calls}", file=sys.stderr)
        return 1

    rate, create, get = calls

    if rate["method"] != "GET" or not rate["path"].startswith("/v2/rates/base/USDT/100/NGN"):
        print(f"{name}: unexpected rate call {rate}", file=sys.stderr)
        return 1
    if "side=sell" not in rate["path"]:
        print(f"{name}: rate side missing", file=sys.stderr)
        return 1

    if create["method"] != "POST" or create["path"] != "/v2/sender/orders":
        print(f"{name}: unexpected create call {create}", file=sys.stderr)
        return 1
    body = create.get("body") or {}
    if body.get("amount") != "100":
        print(f"{name}: amount={body.get('amount')}", file=sys.stderr)
        return 1
    if body.get("rate") != "1500":
        print(f"{name}: rate injection failed, got {body.get('rate')}", file=sys.stderr)
        return 1
    source = body.get("source") or {}
    destination = body.get("destination") or {}
    if source.get("type") != "crypto" or destination.get("type") != "fiat":
        print(f"{name}: unexpected source/destination types: {source}, {destination}", file=sys.stderr)
        return 1

    if get["method"] != "GET" or not get["path"].startswith("/v2/sender/orders/"):
        print(f"{name}: unexpected get call {get}", file=sys.stderr)
        return 1

    print(f"parity: {name} OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
