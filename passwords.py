"""Пароли галереи: ротация каждые 2 дня."""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone

ROTATION_DAYS = 2
PERIOD_MS = ROTATION_DAYS * 24 * 60 * 60 * 1000


def get_secret() -> str:
    return os.environ.get("PASSWORD_SECRET", "ok-gallery-default-secret")


def get_password_period(now_ms: int | None = None) -> int:
    if now_ms is None:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    return now_ms // PERIOD_MS


def get_period_end_ms(period: int) -> int:
    return (period + 1) * PERIOD_MS


def _derive(role: str, period: int, secret: str | None = None) -> str:
    secret = secret or get_secret()
    raw = hashlib.sha256(f"{secret}|p{period}|{role}".encode()).digest()
    import base64

    b64 = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    clean = "".join(c for c in b64 if c.isalnum())
    prefix = "v" if role == "view" else "e"
    return prefix + clean[:11]


def get_current_passwords(now_ms: int | None = None) -> dict:
    period = get_password_period(now_ms)
    secret = get_secret()
    end_ms = get_period_end_ms(period)
    valid_until = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc).isoformat()
    return {
        "view": _derive("view", period, secret),
        "admin": _derive("admin", period, secret),
        "period": period,
        "validUntil": valid_until,
        "rotationDays": ROTATION_DAYS,
    }


def validate_password(password: str, role: str = "any", now_ms: int | None = None) -> str | None:
    cur = get_current_passwords(now_ms)
    if role in ("view", "any") and password == cur["view"]:
        return "view"
    if role in ("admin", "any") and password == cur["admin"]:
        return "admin"
    return None


def is_admin_password(password: str | None) -> bool:
    if not password:
        return False
    return validate_password(password, "admin") == "admin"
