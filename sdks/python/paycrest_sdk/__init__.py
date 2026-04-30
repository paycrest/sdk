"""Paycrest SDK for Python.

`__all__` is the documented public surface. A handful of additional
helpers (`AggregatorRegistry`, `build_recipient_payload`,
`encrypt_recipient_payload`, `RecipientPayload`) remain importable from
their submodules — they're internal building blocks of the gateway path
and reserved for advanced users / tests.
"""

from .client import PaycrestClient
from .errors import (
    AuthenticationError,
    NetworkError,
    NotFoundError,
    OrderRejectedError,
    PaycrestAPIError,
    ProviderUnavailableError,
    RateLimitError,
    RateQuoteUnavailableError,
    ValidationError,
)
from .gateway_client import (
    GatewayClient,
    GatewayCreateOrderArgs,
    GatewayOrderResult,
    GatewayPathConfig,
    GatewayTransactor,
    scale_rate,
    to_subunits,
)
from .http import (
    DEFAULT_RETRY_POLICY,
    HttpClient,
    RequestHookContext,
    RequestHooks,
    RetryPolicy,
)
from .networks import NETWORKS, NetworkInfo, get_network, register_network
from .provider import ProviderClient, ProviderListOrdersQuery
from .registry import (
    SupportedToken,
    clear_registered_tokens,
    list_registered_tokens,
    register_token,
    register_tokens,
)
from .sender import (
    ListOrdersQuery,
    SenderClient,
    WaitForStatusOptions,
)
from .webhook_middleware import (
    PaycrestWebhookEvent,
    fastapi_paycrest_webhook,
    flask_paycrest_webhook,
    parse_paycrest_webhook,
)
from .webhooks import verify_webhook_signature

__all__ = [
    # Client + role-specific clients.
    "PaycrestClient",
    "SenderClient",
    "ProviderClient",
    # Query value objects + wait helpers.
    "ListOrdersQuery",
    "ProviderListOrdersQuery",
    "WaitForStatusOptions",
    # Off-ramp gateway path.
    "GatewayClient",
    "GatewayPathConfig",
    "GatewayTransactor",
    "GatewayOrderResult",
    "GatewayCreateOrderArgs",
    "to_subunits",
    "scale_rate",
    # Network + token registries.
    "NETWORKS",
    "NetworkInfo",
    "get_network",
    "register_network",
    "SupportedToken",
    "register_token",
    "register_tokens",
    "list_registered_tokens",
    "clear_registered_tokens",
    # HTTP layer for advanced configuration.
    "HttpClient",
    "RetryPolicy",
    "DEFAULT_RETRY_POLICY",
    "RequestHooks",
    "RequestHookContext",
    # Typed errors.
    "PaycrestAPIError",
    "ValidationError",
    "AuthenticationError",
    "NotFoundError",
    "RateLimitError",
    "RateQuoteUnavailableError",
    "ProviderUnavailableError",
    "OrderRejectedError",
    "NetworkError",
    # Webhooks.
    "verify_webhook_signature",
    "parse_paycrest_webhook",
    "fastapi_paycrest_webhook",
    "flask_paycrest_webhook",
    "PaycrestWebhookEvent",
]
