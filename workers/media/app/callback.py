"""Signed worker -> web callbacks so the web app can trust job results."""
from __future__ import annotations
import hashlib
import hmac
import json
import time

import httpx


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def post_callback(url: str, secret: str, payload: dict, client: httpx.Client | None = None) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode()
    ts = str(int(time.time()))
    (client or httpx).post(
        url, content=body, timeout=30,
        headers={"content-type": "application/json", "x-timestamp": ts, "x-signature": sign(secret, ts, body)},
    ).raise_for_status()
