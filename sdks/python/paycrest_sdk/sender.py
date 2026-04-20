from .errors import PaycrestAPIError


class SenderClient:
    def __init__(self, http_client):
        self._http = http_client

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

    def create_offramp_order(self, payload: dict) -> dict:
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
