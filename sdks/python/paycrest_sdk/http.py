import json
import random
import time
import uuid
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


@dataclass
class RequestHookContext:
    method: str
    url: str
    attempt: int
    idempotency_key: Optional[str] = None
    status_code: Optional[int] = None
    duration_ms: Optional[float] = None
    error: Optional[Exception] = None


class RequestHooks:
    """Plug-in observation hooks. Each attribute is an optional
    callable that accepts a :class:`RequestHookContext`. Exceptions
    raised inside a hook are swallowed so a faulty tracer can't break
    the SDK's own error semantics.
    """

    def __init__(
        self,
        on_request: Optional[callable] = None,
        on_response: Optional[callable] = None,
        on_error: Optional[callable] = None,
    ):
        self.on_request = on_request
        self.on_response = on_response
        self.on_error = on_error


def _invoke_hook(hook, ctx: RequestHookContext) -> None:
    if hook is None:
        return
    try:
        hook(ctx)
    except Exception:  # noqa: BLE001 — hooks must never break the HTTP path
        pass


class HttpClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: int = 20,
        retry_policy: Optional[RetryPolicy] = None,
        hooks: Optional[RequestHooks] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retry_policy = retry_policy or DEFAULT_RETRY_POLICY
        self.hooks = hooks or RequestHooks()

    def call(
        self,
        method: str,
        path: str,
        body: Any = None,
        query: Optional[Mapping[str, Any]] = None,
        retry_policy: Optional[RetryPolicy] = None,
        idempotency_key: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        url = f"{self.base_url}{path}"
        if query:
            params = {k: v for k, v in query.items() if v is not None}
            encoded = parse.urlencode(params)
            if encoded:
                url = f"{url}?{encoded}"

        policy = retry_policy or self.retry_policy
        # Auto-generate an Idempotency-Key on POSTs so the same logical
        # request keeps the same header on every retry attempt.
        effective_idempotency_key = idempotency_key
        if effective_idempotency_key is None and method.upper() == "POST":
            effective_idempotency_key = str(uuid.uuid4())

        last_error: Optional[PaycrestAPIError] = None

        effective_timeout = timeout if timeout is not None else self.timeout

        for attempt in range(1, policy.retries + 1):
            ctx = RequestHookContext(
                method=method.upper(),
                url=url,
                attempt=attempt,
                idempotency_key=effective_idempotency_key,
            )
            _invoke_hook(self.hooks.on_request, ctx)
            started_at = time.monotonic()
            try:
                response = self._send(method, url, body, effective_idempotency_key, effective_timeout)
                ctx.duration_ms = (time.monotonic() - started_at) * 1000
                ctx.status_code = 200
                _invoke_hook(self.hooks.on_response, ctx)
                return response
            except PaycrestAPIError as exc:
                ctx.duration_ms = (time.monotonic() - started_at) * 1000
                ctx.status_code = exc.status_code or None
                ctx.error = exc
                _invoke_hook(self.hooks.on_error, ctx)
                last_error = exc
                if attempt >= policy.retries:
                    break
                if not self._is_retryable(exc, method):
                    break
                delay = self._compute_backoff(attempt, exc, policy)
                time.sleep(delay)
            except Exception as exc:  # any non-classified transport error
                ctx.duration_ms = (time.monotonic() - started_at) * 1000
                wrapped = NetworkError("Unexpected transport error", cause=str(exc))
                ctx.error = wrapped
                _invoke_hook(self.hooks.on_error, ctx)
                last_error = wrapped
                if attempt >= policy.retries:
                    break
                delay = self._compute_backoff(attempt, last_error, policy)
                time.sleep(delay)

        raise last_error or NetworkError("Unknown HTTP failure")

    def _send(
        self,
        method: str,
        url: str,
        body: Any,
        idempotency_key: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["API-Key"] = self.api_key
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        req = request.Request(url=url, data=payload, method=method, headers=headers)

        effective_timeout = timeout if timeout is not None else self.timeout
        try:
            with request.urlopen(req, timeout=effective_timeout) as response:
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
