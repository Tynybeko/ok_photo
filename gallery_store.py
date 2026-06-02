"""Хранилище фото галереи: manifest + файлы на диске."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
IMAGES_DIR = DATA_DIR / "images"
MANIFEST_FILE = DATA_DIR / "manifest.json"
LEGACY_HTML = ROOT / "gallery.html"


def ensure_dirs() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def load_manifest() -> list[dict[str, Any]]:
    ensure_dirs()
    if not MANIFEST_FILE.exists():
        return []
    try:
        data = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_manifest(items: list[dict[str, Any]]) -> None:
    ensure_dirs()
    MANIFEST_FILE.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def migrate_legacy_embedded() -> int:
    """Переносит встроенные base64-фото из gallery.html в data/images/."""
    if MANIFEST_FILE.exists() and MANIFEST_FILE.stat().st_size > 10:
        return 0
    if not LEGACY_HTML.exists():
        return 0

    text = LEGACY_HTML.read_text(encoding="utf-8")
    m = re.search(
        r'<script id="data" type="application/json">(.*?)</script>',
        text,
        re.DOTALL,
    )
    if not m:
        return 0

    import base64

    legacy = json.loads(m.group(1))
    items: list[dict[str, Any]] = []
    ensure_dirs()

    for entry in legacy:
        name = entry["n"]
        mime = entry.get("m", "image/webp")
        raw = base64.b64decode(entry["d"])
        path = IMAGES_DIR / name
        path.write_bytes(raw)
        items.append(
            {
                "id": name,
                "name": name,
                "mime": mime,
                "source": "legacy",
            }
        )

    save_manifest(items)
    return len(items)


def next_import_name(ext: str) -> str:
    items = load_manifest()
    nums = []
    for it in items:
        m = re.match(r"^imp_(\d+)", it.get("id", ""))
        if m:
            nums.append(int(m.group(1)))
    n = max(nums, default=0) + 1
    return f"imp_{n:04d}{ext}"


def add_photo(
    data: bytes,
    mime: str,
    *,
    source: str = "ok",
    profile_url: str | None = None,
    original_url: str | None = None,
) -> dict[str, Any]:
    ext = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mime.split(";")[0], ".bin")
    photo_id = next_import_name(ext)
    ensure_dirs()
    (IMAGES_DIR / photo_id).write_bytes(data)
    entry = {
        "id": photo_id,
        "name": photo_id,
        "mime": mime.split(";")[0],
        "source": source,
    }
    if profile_url:
        entry["profile"] = profile_url
    if original_url:
        entry["url"] = original_url
    items = load_manifest()
    items.insert(0, entry)
    save_manifest(items)
    return entry


def photo_path(photo_id: str) -> Path | None:
    p = IMAGES_DIR / photo_id
    return p if p.is_file() else None


def list_for_api() -> list[dict[str, Any]]:
    return [
        {
            "id": it["id"],
            "name": it.get("name", it["id"]),
            "mime": it.get("mime", "image/jpeg"),
            "source": it.get("source"),
            "profile": it.get("profile"),
        }
        for it in load_manifest()
    ]
