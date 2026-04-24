import json
import random
import time
from dataclasses import dataclass
from typing import Any, Mapping, Optional
from urllib import error, parse, request

from .errors import NetworkError, PaycrestAPIError, RateLimitError, classify_http_error


@dataclass
class RetryPolicy:
    """Retry policy applied to HTTP requests.

    Default: retry GETs on transport errors + 429/500/502/503/504 with
    exponential backoff + full jitter (capped at ``max_delay_ms``).
    POSTs retry **only** on transport errors that happened before the
    server acknowledged the request — automatic retry of acknowledged
    POST failures is unsafe for payment SDKs.
    """

    retries: int = 3
    base_delay_ms: int = 500
    max_delay_ms: int = 10_000


DEFAULT_RETRY_POLICY = RetryPolicy()
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


class HttpClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: int = 20,
        retry_policy: Optional[RetryPolicy] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retry_policy = retry_policy or DEFAULT_RETRY_POLICY

    def call(
        self,
        method: str,
        path: str,
        body: Any = None,
        query: Optional[Mapping[str, Any]] = None,
        retry_policy: Optional[RetryPolicy] = None,
    ):
        url = f"{self.base_url}{path}"
        if query:
            params = {k: v for k, v in query.items() if v is not None}
            encoded = parse.urlencode(params)
            if encoded:
                url = f"{url}?{encoded}"

        policy = retry_policy or self.retry_policy
        last_error: Optional[PaycrestAPIError] = None

        for attempt in range(1, policy.retries + 1):
            try:
                return self._send(method, url, body)
            except PaycrestAPIError as exc:
                last_error = exc
                if attempt >= policy.retries:
                    break
                if not self._is_retryable(exc, method):
                    break
                delay = self._compute_backoff(attempt, exc, policy)
                time.sleep(delay)
            except Exception as exc:  # any non-classified transport error
                last_error = NetworkError("Unexpected transport error", cause=str(exc))
                if attempt >= policy.retries:
                    break
                delay = self._compute_backoff(attempt, last_error, policy)
                time.sleep(delay)

        raise last_error or NetworkError("Unknown HTTP failure")

    def _send(self, method: str, url: str, body: Any):
        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["API-Key"] = self.api_key
        req = request.Request(url=url, data=payload, method=method, headers=headers)

        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw)
        except error.HTTPError as exc:
            details_raw = exc.read().decode("utf-8")
            try:
                parsed = json.loads(details_raw)
                message = parsed.get("message", "Paycrest API request failed")
                data = parsed.get("data")
            except json.JSONDecodeError:
                message = "Paycrest API request failed"
                data = details_raw

            retry_after = None
            header = exc.headers.get("Retry-After") if exc.headers else None
            if header:
                try:
                    retry_after = float(header)
                except ValueError:
                    retry_after = None

            raise classify_http_error(exc.code, message, data, retry_after) from exc
        except error.URLError as exc:
            raise NetworkError("Network error calling Paycrest API", cause=str(exc)) from exc

    @staticmethod
    def _is_retryable(exc: PaycrestAPIError, method: str) -> bool:
        if isinstance(exc, NetworkError):
            return True
        if method.upper() != "GET":
            return False
        return exc.status_code in _RETRYABLE_STATUS_CODES

    @staticmethod
    def _compute_backoff(attempt: int, exc: PaycrestAPIError, policy: RetryPolicy) -> float:
        if isinstance(exc, RateLimitError) and exc.retry_after_seconds and exc.retry_after_seconds > 0:
            return min(exc.retry_after_seconds, policy.max_delay_ms / 1000)
        exponential_ms = policy.base_delay_ms * (2 ** (attempt - 1))
        jittered_ms = random.uniform(0, exponential_ms)
        return min(jittered_ms, policy.max_delay_ms) / 1000
