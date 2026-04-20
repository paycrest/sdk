class SenderClient:
    def __init__(self, http_client):
        self._http = http_client

    def create_order(self, payload: dict) -> dict:
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
