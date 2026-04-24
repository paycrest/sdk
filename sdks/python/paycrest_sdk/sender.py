from typing import Optional

from .errors import PaycrestAPIError
from .gateway_client import GatewayClient, GatewayOrderResult


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

        raise PaycrestAPIError(
            "Invalid sender order direction. Expected crypto->fiat or fiat->crypto.",
            status_code=400,
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
                raise PaycrestAPIError(
                    "Gateway dispatch is not configured. Pass `gateway=GatewayPathConfig(...)` to PaycrestClient.",
                    status_code=400,
                )
            return self._gateway.create_offramp_order(payload, rate_resolver=self._resolve_rate_for_gateway)
        if method != "api":
            raise PaycrestAPIError(f'Unknown off-ramp method "{method}"', status_code=400)

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
            raise PaycrestAPIError("Aggregator returned no sell-side rate", status_code=404)
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

    def list_orders(self, page: int = 1, page_size: int = 10, status: str | None = None) -> dict:
        response = self._http.call(
            "GET",
            "/sender/orders",
            query={"page": page, "pageSize": page_size, "status": status},
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
            raise PaycrestAPIError(
                f"Unable to fetch {side} rate for requested order.",
                status_code=404,
                details=quote,
            )

        prepared = dict(payload)
        prepared["rate"] = side_quote["rate"]
        return prepared
