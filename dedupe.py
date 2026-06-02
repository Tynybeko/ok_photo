"""Дедупликация фото по URL (okcdn r=) и хешу содержимого."""

from __future__ import annotations

import hashlib
import re
from typing import Any

R_PARAM_RE = re.compile(r"[?&]r=([A-Za-z0-9_-]+)")


def url_dedupe_key(url: str | None) -> str:
    if not url:
        return ""
    m = R_PARAM_RE.search(url)
    if m:
        return f"r:{m.group(1)}"
    return url.split("&")[0].split("?")[0]


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def dedupe_state_from_manifest(manifest: list[dict[str, Any]]) -> tuple[set[str], set[str]]:
    url_keys: set[str] = set()
    content_hashes: set[str] = set()
    for it in manifest:
        if it.get("contentHash"):
            content_hashes.add(it["contentHash"])
        u = it.get("originalUrl") or it.get("url")
        if u:
            url_keys.add(url_dedupe_key(u))
    return url_keys, content_hashes


def is_duplicate(
    url_keys: set[str],
    content_hashes: set[str],
    batch_url_keys: set[str],
    batch_hashes: set[str],
    url: str | None,
    data: bytes | None,
) -> bool:
    uk = url_dedupe_key(url) if url else ""
    if uk and (uk in url_keys or uk in batch_url_keys):
        return True
    if data:
        h = content_hash(data)
        if h in content_hashes or h in batch_hashes:
            return True
    return False


def register_dedupe(
    url_keys: set[str],
    content_hashes: set[str],
    batch_url_keys: set[str],
    batch_hashes: set[str],
    url: str | None,
    data: bytes | None,
) -> str | None:
    uk = url_dedupe_key(url) if url else ""
    if uk:
        url_keys.add(uk)
        batch_url_keys.add(uk)
    h = None
    if data:
        h = content_hash(data)
        content_hashes.add(h)
        batch_hashes.add(h)
    return h
