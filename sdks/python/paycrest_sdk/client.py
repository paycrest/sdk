from .http import HttpClient
from .provider import ProviderClient
from .sender import SenderClient


class PaycrestClient:
    def __init__(
        self,
        api_key: str | None = None,
        sender_api_key: str | None = None,
        provider_api_key: str | None = None,
        base_url: str = "https://api.paycrest.io/v2",
        timeout: int = 20,
    ):
        sender_key = sender_api_key or api_key
        provider_key = provider_api_key or api_key

        self._sender_http = HttpClient(api_key=sender_key, base_url=base_url, timeout=timeout) if sender_key else None
        self._provider_http = HttpClient(api_key=provider_key, base_url=base_url, timeout=timeout) if provider_key else None

    def sender(self) -> SenderClient:
        if self._sender_http is None:
            raise ValueError("sender_api_key (or api_key) is required")
        return SenderClient(self._sender_http)

    def provider(self) -> ProviderClient:
        if self._provider_http is None:
            raise ValueError("provider_api_key (or api_key) is required")
        return ProviderClient(self._provider_http)
