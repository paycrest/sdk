#!/usr/bin/env python3
"""Tiny fixture server for cross-SDK parity testing.

Serves the subset of Paycrest API endpoints needed for a single
off-ramp scenario (rate-first create → get), records every incoming
request, and exposes that record via `/__calls`. Runs on any free
localhost port; prints the port to stdout on startup so shell scripts
can pick it up.

Zero dependencies — relies only on Python's stdlib http.server.
"""

from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

_RECORDED_CALLS: list[dict[str, Any]] = []
_LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:  # silence default stderr logging
        pass

    def _read_json_body(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    def _record(self, method: str, body: Any) -> None:
        with _LOCK:
            _RECORDED_CALLS.append({
                "method": method,
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body": body,
            })

    def _respond(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/__calls":
            with _LOCK:
                snapshot = list(_RECORDED_CALLS)
            self._respond(200, snapshot)
            return

        self._record("GET", None)

        # Rate quote: /v2/rates/base/USDT/100/NGN?side=sell
        if self.path.startswith("/v2/rates/"):
            self._respond(200, {
                "status": "success",
                "message": "OK",
                "data": {"sell": {"rate": "1500"}},
            })
            return

        # Get order by id — status depends on id to let waitForStatus tests work.
        if self.path.startswith("/v2/sender/orders/"):
            order_id = self.path.rsplit("/", 1)[-1]
            # Any id starting with "pending-" stays pending; otherwise settled.
            status = "pending" if order_id.startswith("pending-") else "settled"
            self._respond(200, {
                "status": "success",
                "message": "OK",
                "data": {"id": order_id, "status": status, "rate": "1500"},
            })
            return

        if self.path.startswith("/v2/pubkey"):
            self._respond(200, {"status": "success", "message": "OK", "data": ""})
            return

        self._respond(404, {"status": "error", "message": f"unhandled GET {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        body = self._read_json_body()

        if self.path == "/__reset":
            with _LOCK:
                _RECORDED_CALLS.clear()
            self._respond(200, {"status": "ok"})
            return

        self._record("POST", body)

        if self.path == "/v2/sender/orders":
            # Echo back the rate the SDK injected so the driver can confirm parity.
            rate = (body or {}).get("rate")
            self._respond(201, {
                "status": "success",
                "message": "Created",
                "data": {"id": "ord-parity-1", "status": "initiated", "rate": rate},
            })
            return

        self._respond(404, {"status": "error", "message": f"unhandled POST {self.path}"})


def main() -> None:
    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    print(port, flush=True)  # first line of stdout — drivers pick this up
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"fixture server failed: {e}", file=sys.stderr)
        sys.exit(1)
