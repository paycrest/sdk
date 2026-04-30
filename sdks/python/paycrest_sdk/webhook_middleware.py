"""Web-framework webhook helpers.

Every integrator ends up writing the same ten lines (read body, HMAC,
compare, parse JSON, bind to handler). Ship it once. Three entry points:

* :func:`parse_paycrest_webhook` — framework-agnostic: takes raw bytes
  + header, returns the parsed + verified event or raises.
* :func:`fastapi_paycrest_webhook` — FastAPI ``Depends(...)`` factory.
* :func:`flask_paycrest_webhook` — Flask view decorator that injects
  the verified event as a keyword argument.

The FastAPI / Flask integrations import their frameworks lazily so
API-only users don't need those packages installed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Optional

from .webhooks import verify_webhook_signature


@dataclass(frozen=True)
class PaycrestWebhookEvent:
    event: Optional[str]
    timestamp: Optional[str]
    data: Any


def parse_paycrest_webhook(
    raw_body: bytes | str,
    signature: Optional[str],
    secret: str,
) -> PaycrestWebhookEvent:
    """Framework-agnostic parse + verify.

    Raises :class:`ValueError` on missing / bad signature or malformed
    JSON so callers can map it to their own HTTP status codes.
    """
    if not signature:
        raise ValueError("paycrest webhook: missing signature")
    body_str = raw_body.decode("utf-8") if isinstance(raw_body, (bytes, bytearray)) else raw_body
    if not verify_webhook_signature(body_str, signature, secret):
        raise ValueError("paycrest webhook: invalid signature")
    try:
        payload = json.loads(body_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"paycrest webhook: invalid JSON body: {e}") from e
    return PaycrestWebhookEvent(
        event=payload.get("event"),
        timestamp=payload.get("timestamp"),
        data=payload.get("data"),
    )


def fastapi_paycrest_webhook(
    secret: str,
    signature_header: str = "x-paycrest-signature",
):
    """Return a FastAPI dependency that parses + verifies a webhook.

    Usage::

        from fastapi import Depends, FastAPI
        from paycrest_sdk import fastapi_paycrest_webhook

        webhook_dep = fastapi_paycrest_webhook(secret=SECRET)
        app = FastAPI()

        @app.post("/webhooks/paycrest")
        async def handler(event = Depends(webhook_dep)):
            return {"id": event.data["id"]}
    """
    try:
        from fastapi import Header, HTTPException, Request  # noqa: F401
    except ImportError as e:
        raise ImportError(
            "fastapi_paycrest_webhook requires FastAPI. `pip install fastapi`."
        ) from e

    from fastapi import HTTPException, Request

    async def dependency(request: Request) -> PaycrestWebhookEvent:
        signature = request.headers.get(signature_header) or request.headers.get(signature_header.lower())
        raw = await request.body()
        try:
            return parse_paycrest_webhook(raw, signature, secret)
        except ValueError as err:
            status = 400 if "invalid JSON" in str(err) else 401
            raise HTTPException(status_code=status, detail=str(err))

    return dependency


def flask_paycrest_webhook(
    secret: str,
    signature_header: str = "X-Paycrest-Signature",
    arg_name: str = "event",
):
    """Flask view decorator that injects the verified event as a kwarg.

    Usage::

        from flask import Flask
        from paycrest_sdk import flask_paycrest_webhook

        app = Flask(__name__)

        @app.post("/webhooks/paycrest")
        @flask_paycrest_webhook(secret=SECRET)
        def handle(event):
            return {"ok": True}
    """
    try:
        from flask import request as flask_request, abort, jsonify  # noqa: F401
    except ImportError as e:
        raise ImportError(
            "flask_paycrest_webhook requires Flask. `pip install flask`."
        ) from e

    from flask import abort, request as flask_request

    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            signature = flask_request.headers.get(signature_header)
            try:
                event = parse_paycrest_webhook(flask_request.get_data(), signature, secret)
            except ValueError as err:
                status = 400 if "invalid JSON" in str(err) else 401
                abort(status, description=str(err))
                return None  # abort() raises; keep mypy happy
            kwargs[arg_name] = event
            return view(*args, **kwargs)

        wrapped.__name__ = view.__name__
        wrapped.__doc__ = view.__doc__
        return wrapped

    return decorator
