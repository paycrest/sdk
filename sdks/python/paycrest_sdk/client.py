from .http import HttpClient
from .sender import SenderClient


class PaycrestClient:
    def __init__(self, api_key: str, base_url: str = "https://api.paycrest.io/v2", timeout: int = 20):
        if not api_key:
            raise ValueError("api_key is required")
        self._http = HttpClient(api_key=api_key, base_url=base_url, timeout=timeout)

    def sender(self) -> SenderClient:
        return SenderClient(self._http)

    def provider(self):
        raise NotImplementedError("Provider SDK support is not available yet in v2 monorepo")
