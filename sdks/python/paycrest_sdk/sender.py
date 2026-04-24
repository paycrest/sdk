from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence, Union

from .errors import (
    PaycrestAPIError,
    RateQuoteUnavailableError,
    ValidationError,
)
from .gateway_client import GatewayClient, GatewayOrderResult

TERMINAL_STATUSES = frozenset({"settled", "refunded", "expired", "cancelled"})
WaitStatusTarget = Union[str, Sequence[str]]


@dataclass
class ListOrdersQuery:
    """Typed filter object for ``SenderClient.list_orders`` (and provider
    equivalents via the provider client).
    """

    page: int = 1
    page_size: int = 10
    status: Optional[str] = None


@dataclass
class WaitForStatusOptions:
    """Options for :meth:`SenderClient.wait_for_status`."""

    poll_ms: int = 3_000
    timeout_ms: int = 5 * 60 * 1000


class SenderClient:
    def __init__(self, http_client, gateway_client: Optional[GatewayClient] = None, public_http=None):
        self._http = http_client
        self._gateway = gateway_client
        self._public_http = public_http

    def create_order(self, payload: dict) -> dict:
        source_type = payload.get("source", {}).get("type")
        destination_type = payload.get("destination", {}).get("type")

        if source_type == "crypto" and destination_type == "fiat":
            return self.create_offramp_order(payload)
        if source_type == "fiat" and destination_type == "crypto":
            return self.create_onramp_order(payload)

        raise ValidationError(
            "Invalid sender order direction. Expected crypto->fiat or fiat->crypto.",
        )

    def create_offramp_order(self, payload: dict, method: str = "api"):
        """Create an off-ramp order.

        Args:
            payload: The off-ramp order body (same shape in both modes).
            method:  ``"api"`` (default) routes through the aggregator.
                     ``"gateway"`` dispatches directly to the on-chain
                     Gateway contract using the transactor configured on
                     the client. The return type differs accordingly:

                     - ``"api"``: ``dict`` (PaymentOrder envelope)
                     - ``"gateway"``: :class:`GatewayOrderResult`
        """
        if method == "gateway":
            if self._gateway is None:
                raise ValidationError(
                    "Gateway dispatch is not configured. Pass `gateway=GatewayPathConfig(...)` to PaycrestClient.",
                )
            return self._gateway.create_offramp_order(payload, rate_resolver=self._resolve_rate_for_gateway)
        if method != "api":
            raise ValidationError(f'Unknown off-ramp method "{method}"')

        payload = self._resolve_rate_if_missing(
            payload,
            network=payload["source"]["network"],
            token=payload["source"]["currency"],
            amount=payload["amount"],
            fiat=payload["destination"]["currency"],
            side="sell",
        )
        response = self._http.call("POST", "/sender/orders", body=payload)
        return response["data"]

    def _resolve_rate_for_gateway(self, network: str, token: str, amount: str, fiat: str) -> str:
        if self._public_http is None:
            raise PaycrestAPIError("Public HTTP client missing for rate resolution", status_code=500)
        response = self._public_http.call(
            "GET",
            f"/rates/{network}/{token}/{amount}/{fiat}",
            query={"side": "sell"},
        )
        data = response.get("data") or {}
        sell = data.get("sell") or {}
        rate = sell.get("rate")
        if not rate:
            raise RateQuoteUnavailableError("Aggregator returned no sell-side rate", details=data)
        return rate

    def create_onramp_order(self, payload: dict) -> dict:
        payload = self._resolve_rate_if_missing(
            payload,
            network=payload["destination"]["recipient"]["network"],
            token=payload["destination"]["currency"],
            amount=payload["amount"],
            fiat=payload["source"]["currency"],
            side="buy",
        )
        response = self._http.call("POST", "/sender/orders", body=payload)
        return response["data"]

    def list_orders(
        self,
        query: Optional[ListOrdersQuery] = None,
        *,
        page: int = 1,
        page_size: int = 10,
        status: Optional[str] = None,
    ) -> dict:
        """List sender orders.

        Accepts either a :class:`ListOrdersQuery` value object or legacy
        keyword arguments (``page``, ``page_size``, ``status``) for
        backwards compatibility.
        """
        if query is None:
            query = ListOrdersQuery(page=page, page_size=page_size, status=status)
        response = self._http.call(
            "GET",
            "/sender/orders",
            query={"page": query.page, "pageSize": query.page_size, "status": query.status},
        )
        return response["data"]

    def get_order(self, order_id: str) -> dict:
        response = self._http.call("GET", f"/sender/orders/{order_id}")
        return response["data"]

    def get_stats(self) -> dict:
        response = self._http.call("GET", "/sender/stats")
        return response["data"]

    def verify_account(self, institution: str, account_identifier: str) -> str:
        response = self._http.call(
            "POST",
            "/verify-account",
            body={"institution": institution, "accountIdentifier": account_identifier},
        )
        return response["data"]

    def get_token_rate(
        self,
        network: str,
        token: str,
        amount: str,
        fiat: str,
        side: str | None = None,
        provider_id: str | None = None,
    ) -> dict:
        response = self._http.call(
            "GET",
            f"/rates/{network}/{token}/{amount}/{fiat}",
            query={"side": side, "provider_id": provider_id},
        )
        return response["data"]

    def wait_for_status(
        self,
        order_id: str,
        target: WaitStatusTarget,
        options: Optional[WaitForStatusOptions] = None,
    ) -> dict:
        """Poll ``get_order(order_id)`` until the order reaches ``target``
        or the timeout expires.

        ``target`` accepts a specific status, an iterable of statuses, or
        the literal string ``"terminal"`` (settled / refunded / expired /
        cancelled).
        """
        opts = options or WaitForStatusOptions()
        deadline = time.monotonic() + (opts.timeout_ms / 1000)
        last: Optional[dict] = None
        while True:
            last = self.get_order(order_id)
            if _matches_target(last.get("status"), target):
                return last
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise PaycrestAPIError(
                    f"Timed out waiting for order {order_id} to reach {_describe_target(target)}; "
                    f"last status={last.get('status')}",
                    status_code=408,
                    details=last,
                )
            time.sleep(min(opts.poll_ms / 1000, remaining))

    def _resolve_rate_if_missing(
        self,
        payload: dict,
        network: str,
        token: str,
        amount: str,
        fiat: str,
        side: str,
    ) -> dict:
        if payload.get("rate"):
            return payload

        quote = self.get_token_rate(network=network, token=token, amount=amount, fiat=fiat, side=side)
        side_quote = quote.get(side)
        if not side_quote or not side_quote.get("rate"):
            raise RateQuoteUnavailableError(
                f"Unable to fetch {side} rate for requested order.",
                details=quote,
            )

        prepared = dict(payload)
        prepared["rate"] = side_quote["rate"]
        return prepared


def _matches_target(status: Optional[str], target: WaitStatusTarget) -> bool:
    if status is None:
        return False
    if target == "terminal":
        return status in TERMINAL_STATUSES
    if isinstance(target, str):
        return status == target
    return status in set(target)


def _describe_target(target: WaitStatusTarget) -> str:
    if target == "terminal":
        return "a terminal status"
    if isinstance(target, str):
        return target
    return "|".join(target)
