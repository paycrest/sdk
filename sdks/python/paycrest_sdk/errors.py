"""Typed error taxonomy.

``PaycrestAPIError`` is the base class. Specific subclasses let callers
branch with ``isinstance`` instead of string-matching messages. All
subclasses preserve the base shape (status_code + details + message)
so existing catch blocks keep working.
"""

from __future__ import annotations

from typing import Any, Optional


class PaycrestAPIError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 0,
        details: Any = None,
        retry_after_seconds: Optional[float] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.details = details
        self.retry_after_seconds = retry_after_seconds


class ValidationError(PaycrestAPIError):
    """400 Bad Request with optional structured field errors.

    ``field_errors`` is populated when the aggregator returns its
    conventional ``data: [{field, message}, ...]`` shape. Empty
    otherwise — callers that only want a message should read
    ``.args[0]``/``str(error)`` as usual.
    """

    def __init__(self, message: str, details: Any = None) -> None:
        super().__init__(message, status_code=400, details=details)
        self.field_errors = _parse_field_errors(details)


def _parse_field_errors(details: Any) -> list[dict[str, str]]:
    if not isinstance(details, list):
        return []
    out: list[dict[str, str]] = []
    for item in details:
        if isinstance(item, dict):
            field = item.get("field")
            message = item.get("message")
            if isinstance(field, str) and isinstance(message, str):
                out.append({"field": field, "message": message})
    return out


class AuthenticationError(PaycrestAPIError):
    def __init__(self, message: str = "Authentication failed — check API-Key", details: Any = None) -> None:
        super().__init__(message, status_code=401, details=details)


class NotFoundError(PaycrestAPIError):
    def __init__(self, message: str = "Resource not found", details: Any = None) -> None:
        super().__init__(message, status_code=404, details=details)


class RateLimitError(PaycrestAPIError):
    def __init__(
        self,
        message: str = "Rate limit exceeded",
        retry_after_seconds: Optional[float] = None,
        details: Any = None,
    ) -> None:
        super().__init__(
            message,
            status_code=429,
            details=details,
            retry_after_seconds=retry_after_seconds,
        )


class ProviderUnavailableError(PaycrestAPIError):
    def __init__(
        self,
        message: str = "No provider available for this order",
        status_code: int = 503,
        details: Any = None,
    ) -> None:
        super().__init__(message, status_code=status_code, details=details)


class OrderRejectedError(PaycrestAPIError):
    def __init__(self, message: str, status_code: int = 400, details: Any = None) -> None:
        super().__init__(message, status_code=status_code, details=details)


class RateQuoteUnavailableError(PaycrestAPIError):
    def __init__(
        self,
        message: str = "Rate quote unavailable for this pair",
        details: Any = None,
    ) -> None:
        super().__init__(message, status_code=404, details=details)


class NetworkError(PaycrestAPIError):
    def __init__(self, message: str, cause: Any = None) -> None:
        super().__init__(message, status_code=0, details=cause)


def classify_http_error(
    status_code: int,
    message: str,
    details: Any = None,
    retry_after_seconds: Optional[float] = None,
) -> PaycrestAPIError:
    if status_code == 400:
        return ValidationError(message, details)
    if status_code in (401, 403):
        return AuthenticationError(message, details)
    if status_code == 404:
        return NotFoundError(message, details)
    if status_code == 429:
        return RateLimitError(message, retry_after_seconds, details)
    if status_code == 503:
        return ProviderUnavailableError(message, status_code, details)
    return PaycrestAPIError(message, status_code, details, retry_after_seconds)
