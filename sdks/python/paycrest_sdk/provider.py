class ProviderClient:
    def __init__(self, http_client):
        self._http = http_client

    def list_orders(
        self,
        currency: str,
        page: int = 1,
        page_size: int = 10,
        status: str | None = None,
        ordering: str | None = None,
        search: str | None = None,
        export: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> dict:
        response = self._http.call(
            "GET",
            "/provider/orders",
            query={
                "currency": currency,
                "page": page,
                "pageSize": page_size,
                "status": status,
                "ordering": ordering,
                "search": search,
                "export": export,
                "from": from_date,
                "to": to_date,
            },
        )
        return response["data"]

    def get_order(self, order_id: str) -> dict:
        response = self._http.call("GET", f"/provider/orders/{order_id}")
        return response["data"]

    def get_stats(self, currency: str | None = None) -> dict:
        response = self._http.call("GET", "/provider/stats", query={"currency": currency})
        return response["data"]

    def get_node_info(self) -> dict:
        response = self._http.call("GET", "/provider/node-info")
        return response["data"]

    def get_market_rate(self, token: str, fiat: str) -> dict:
        response = self._http.call("GET", f"/provider/rates/{token}/{fiat}")
        return response["data"]
