from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class ProviderListOrdersQuery:
    """Typed filter object for ``ProviderClient.list_orders``.

    ``from_date`` / ``to_date`` map to the aggregator's ``from`` / ``to``
    query params (named to avoid clashing with Python's ``from`` keyword).
    """

    currency: str
    page: int = 1
    page_size: int = 10
    status: Optional[str] = None
    ordering: Optional[str] = None
    search: Optional[str] = None
    export: Optional[str] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None


class ProviderClient:
    def __init__(self, http_client):
        self._http = http_client

    def list_orders(
        self,
        query: "Optional[ProviderListOrdersQuery | str]" = None,
        page: int = 1,
        page_size: int = 10,
        status: Optional[str] = None,
        ordering: Optional[str] = None,
        search: Optional[str] = None,
        export: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> dict:
        """List provider-matched orders.

        The first positional argument accepts either a
        :class:`ProviderListOrdersQuery` value object or a currency code
        string (kept for backwards compatibility with the
        ``list_orders("NGN", page=…)`` signature).
        """
        if isinstance(query, str):
            currency = query
            query = None
        else:
            currency = None

        if query is None:
            if not currency:
                raise ValueError("currency (or ProviderListOrdersQuery) is required")
            query = ProviderListOrdersQuery(
                currency=currency,
                page=page,
                page_size=page_size,
                status=status,
                ordering=ordering,
                search=search,
                export=export,
                from_date=from_date,
                to_date=to_date,
            )
        response = self._http.call(
            "GET",
            "/provider/orders",
            query={
                "currency": query.currency,
                "page": query.page,
                "pageSize": query.page_size,
                "status": query.status,
                "ordering": query.ordering,
                "search": query.search,
                "export": query.export,
                "from": query.from_date,
                "to": query.to_date,
            },
        )
        return response["data"]

    def get_order(self, order_id: str) -> dict:
        response = self._http.call("GET", f"/provider/orders/{order_id}")
        return response["data"]

    def get_stats(self, currency: Optional[str] = None) -> dict:
        response = self._http.call("GET", "/provider/stats", query={"currency": currency})
        return response["data"]

    def get_node_info(self) -> dict:
        response = self._http.call("GET", "/provider/node-info")
        return response["data"]

    def get_market_rate(self, token: str, fiat: str) -> dict:
        response = self._http.call("GET", f"/provider/rates/{token}/{fiat}")
        return response["data"]
