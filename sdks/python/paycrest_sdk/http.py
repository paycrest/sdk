import json
from urllib import parse, request, error

from .errors import PaycrestAPIError


class HttpClient:
    def __init__(self, api_key: str, base_url: str, timeout: int = 20):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def call(self, method: str, path: str, body=None, query=None):
        url = f"{self.base_url}{path}"
        if query:
            params = {k: v for k, v in query.items() if v is not None}
            encoded = parse.urlencode(params)
            if encoded:
                url = f"{url}?{encoded}"

        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")

        req = request.Request(
            url=url,
            data=payload,
            method=method,
            headers={
                "API-Key": self.api_key,
                "Content-Type": "application/json",
            },
        )

        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw)
        except error.HTTPError as exc:
            details = exc.read().decode("utf-8")
            try:
                parsed = json.loads(details)
                message = parsed.get("message", "Paycrest API request failed")
                data = parsed.get("data")
            except json.JSONDecodeError:
                message = "Paycrest API request failed"
                data = details
            raise PaycrestAPIError(message, status_code=exc.code, details=data) from exc
        except error.URLError as exc:
            raise PaycrestAPIError("Network error calling Paycrest API", details=str(exc)) from exc
