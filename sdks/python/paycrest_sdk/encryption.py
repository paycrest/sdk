"""Hybrid AES-256-GCM + RSA-2048 recipient encryption.

Matches ``utils/crypto/crypto.go::encryptHybridJSON`` in the Paycrest
aggregator byte-for-byte. Zero external dependencies — uses only the
Python standard library (``os.urandom``, ``hashlib``, ``hmac``-style
primitives are not sufficient; we need AES-GCM and RSA from
``cryptography``, which is a common and widely-vendored package).
"""

from __future__ import annotations

import base64
import json
import os
import struct
from dataclasses import asdict, dataclass
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


@dataclass
class RecipientPayload:
    """Plaintext struct encrypted into the on-chain ``messageHash``.

    Field names + order match the aggregator's ``crypto.EncryptOrderRecipient``
    payload struct exactly so the aggregator can decode what we produce.
    """

    Nonce: str
    AccountIdentifier: str
    AccountName: str
    Institution: str
    ProviderID: str
    Memo: str
    Metadata: dict[str, Any] | None


def build_recipient_payload(
    *,
    institution: str,
    account_identifier: str,
    account_name: str,
    memo: str,
    provider_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> RecipientPayload:
    nonce_bytes = os.urandom(12)
    return RecipientPayload(
        Nonce=base64.b64encode(nonce_bytes).decode("ascii"),
        AccountIdentifier=account_identifier,
        AccountName=account_name,
        Institution=institution,
        ProviderID=provider_id,
        Memo=memo,
        Metadata=metadata,
    )


def encrypt_recipient_payload(payload: RecipientPayload, public_key_pem: str) -> str:
    """Build the base64 envelope the Gateway contract expects.

    Envelope layout (matches aggregator):

        [4 bytes BE: encrypted-AES-key length]
        [encrypted-AES-key bytes]
        [12-byte AES-GCM nonce]
        [AES-GCM ciphertext][16-byte auth tag]
    """
    plaintext = json.dumps(asdict(payload), separators=(",", ":")).encode("utf-8")

    aes_key = os.urandom(32)
    aes_nonce = os.urandom(12)
    ciphertext_with_tag = AESGCM(aes_key).encrypt(aes_nonce, plaintext, None)

    public_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise ValueError("Aggregator public key is not RSA")
    encrypted_key = public_key.encrypt(aes_key, padding.PKCS1v15())

    envelope = (
        struct.pack(">I", len(encrypted_key))
        + encrypted_key
        + aes_nonce
        + ciphertext_with_tag
    )
    return base64.b64encode(envelope).decode("ascii")
