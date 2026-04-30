"""Concurrency regression tests for ``AggregatorRegistry``.

Stand up an in-process HTTP server that counts request hits, then fire
N concurrent first-fetch callers and assert the registry serializes
them into a single underlying request. Without ``_fetch_lock`` (the
TOCTOU window we closed pre-2.1) these tests would record N hits per N
callers because each thread misses the cache check before the first
writer populates it.
"""

from __future__ import annotations

import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from time import sleep

from paycrest_sdk.http import HttpClient
from paycrest_sdk.registry import AggregatorRegistry


class _CountingHandler(BaseHTTPRequestHandler):
    """Records each request and replies with the canned token list. A
    50ms delay forces concurrent callers to overlap on the slow path
    instead of finishing serially."""

    def log_message(self, *args, **kwargs):  # silence default stderr
        pass

    def do_GET(self):  # noqa: N802
        self.server.hits += 1  # type: ignore[attr-defined]
        sleep(0.05)
        if self.path.startswith("/tokens"):
            body = json.dumps({
                "status": "success",
                "data": [{
                    "symbol": "USDT",
                    "contractAddress": "0xToken",
                    "decimals": 6,
                    "baseCurrency": "USD",
                    "network": "base",
                }],
            }).encode("utf-8")
        elif self.path == "/pubkey":
            body = json.dumps({
                "status": "success",
                "data": "-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----\n",
            }).encode("utf-8")
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _spawn_counting_server() -> tuple[HTTPServer, threading.Thread]:
    server = HTTPServer(("127.0.0.1", 0), _CountingHandler)
    server.hits = 0  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


class RegistryConcurrencyTests(unittest.TestCase):
    def _registry_pointed_at(self, server: HTTPServer) -> AggregatorRegistry:
        port = server.server_address[1]
        http = HttpClient(api_key="", base_url=f"http://127.0.0.1:{port}", timeout=5)
        return AggregatorRegistry(http)

    def test_concurrent_first_fetches_share_one_tokens_request(self):
        server, _ = _spawn_counting_server()
        try:
            registry = self._registry_pointed_at(server)
            with ThreadPoolExecutor(max_workers=16) as pool:
                results = list(pool.map(
                    lambda _: registry.get_tokens_for_network("base"),
                    range(16),
                ))
            for tokens in results:
                self.assertEqual(len(tokens), 1)
                self.assertEqual(tokens[0].symbol, "USDT")
            self.assertEqual(
                server.hits, 1,  # type: ignore[attr-defined]
                "registry must serialize first-fetches; "
                f"saw {server.hits} HTTP hits",  # type: ignore[attr-defined]
            )
            # Subsequent fetches stay cached — no new hits.
            registry.get_tokens_for_network("base")
            self.assertEqual(server.hits, 1)  # type: ignore[attr-defined]
        finally:
            server.shutdown()
            server.server_close()

    def test_concurrent_first_fetches_share_one_pubkey_request(self):
        server, _ = _spawn_counting_server()
        try:
            registry = self._registry_pointed_at(server)
            with ThreadPoolExecutor(max_workers=16) as pool:
                pem_values = list(pool.map(lambda _: registry.get_public_key(), range(16)))
            for pem in pem_values:
                self.assertIn("BEGIN PUBLIC KEY", pem)
            self.assertEqual(server.hits, 1)  # type: ignore[attr-defined]
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
