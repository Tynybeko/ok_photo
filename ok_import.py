"""Импорт фотографий с OK.ru (профиль) или из HAR."""

from __future__ import annotations

import base64
import http.cookiejar
import json
import re
import ssl
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlparse

from gallery_store import add_photo, load_manifest

ROOT = Path(__file__).resolve().parent
COOKIES_FILE = ROOT / "cookies.txt"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

OKCDN_PHOTO_RE = re.compile(
    r"https?://(?:vki3|i|pimg|dp)\.okcdn\.ru/i\?r=[A-Za-z0-9_\-]+(?:&[^\"'\s<>]*)?",
    re.I,
)
SKIP_URL_PARTS = ("/static/", "/res/assets/", "holder_", "ico_", "pixel/")


def normalize_profile_url(url: str) -> tuple[str, str | None]:
    url = url.strip()
    if not url:
        raise ValueError("Пустая ссылка")
    if not url.startswith("http"):
        url = "https://" + url
    parsed = urlparse(url)
    if "ok.ru" not in parsed.netloc and "odnoklassniki.ru" not in parsed.netloc:
        raise ValueError("Ссылка должна быть с ok.ru")

    path = parsed.path.rstrip("/")
    m = re.search(r"/profile/([^/]+)(?:/photos)?", path, re.I)
    if m:
        pid = m.group(1)
        return f"https://ok.ru/profile/{pid}/photos", pid

    m = re.search(r"/([^/]+)/photos", path)
    if m and m.group(1) not in ("profile", "group"):
        return f"https://ok.ru/{m.group(1)}/photos", None

    raise ValueError(
        "Не удалось разобрать ссылку. Пример: https://ok.ru/profile/123456789/photos"
    )


def _load_cookies() -> http.cookiejar.MozillaCookieJar | None:
    if not COOKIES_FILE.exists():
        return None
    jar = http.cookiejar.MozillaCookieJar(str(COOKIES_FILE))
    try:
        jar.load(ignore_discard=True, ignore_expires=True)
        return jar
    except Exception:
        return None


def _opener() -> urllib.request.OpenerDirector:
    ctx = ssl.create_default_context()
    jar = _load_cookies()
    if jar:
        return urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar),
            urllib.request.HTTPSHandler(context=ctx),
        )
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))


def fetch_html(url: str, timeout: int = 45) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
    )
    with _opener().open(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_photo_urls(html: str) -> list[str]:
    text = unescape(html)
    found: list[str] = []
    seen: set[str] = set()
    for raw in OKCDN_PHOTO_RE.findall(text):
        if any(p in raw for p in SKIP_URL_PARTS):
            continue
        url = raw.replace("\\u0026", "&").split('"')[0].split("'")[0]
        # превью в srcset — берём URL с максимальным dpr
        if not url.startswith("http"):
            url = "https:" + url.lstrip("/")
        key = url.split("&")[0]
        if key in seen:
            continue
        seen.add(key)
        found.append(_best_quality_url(url))
    return found


def _best_quality_url(url: str) -> str:
    if "dpr=" not in url:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}dpr=2"
    return url


def _extract_friend_id(html: str) -> str | None:
    m = re.search(r'st-prm_friendId["\']?\s*[:=]\s*["\']?(\d+)', html)
    if m:
        return m.group(1)
    m = re.search(r"st\.friendId=(\d+)", html)
    if m:
        return m.group(1)
    m = re.search(r"/profile/(\d+)", html)
    return m.group(1) if m else None


def collect_profile_urls(profile_url: str, log: Callable[[str], None] | None = None) -> list[str]:
    def _log(msg: str) -> None:
        if log:
            log(msg)

    photos_url, pid = normalize_profile_url(profile_url)
    _log(f"Загрузка {photos_url}…")
    html = fetch_html(photos_url)
    friend_id = pid or _extract_friend_id(html)
    if not friend_id:
        raise ValueError("Не найден ID профиля на странице")

    all_urls: list[str] = []
    seen: set[str] = set()

    def add_from(page_html: str) -> int:
        n = 0
        for u in extract_photo_urls(page_html):
            k = u.split("&")[0]
            if k not in seen:
                seen.add(k)
                all_urls.append(u)
                n += 1
        return n

    add_from(html)
    _log(f"На первой странице: {len(all_urls)} фото")

    # пагинация (с cookies часто открывается больше)
    for fp in range(1, 40):
        page_url = (
            f"https://ok.ru/dk?st.cmd=anonymFriendPhotos"
            f"&st.friendId={friend_id}"
            f"&st.layer.lg.ftid=0&st.layer.lg.fp={fp}"
            f"&st._aid=FriendPhotoStream_Photos_Over"
        )
        try:
            chunk = fetch_html(page_url, timeout=30)
        except urllib.error.URLError:
            break
        added = add_from(chunk)
        if added == 0:
            break
        _log(f"Страница {fp + 1}: +{added} (всего {len(all_urls)})")

    if not COOKIES_FILE.exists() and len(all_urls) < 15:
        _log(
            "Мало фото без авторизации. Положите cookies.txt (экспорт из браузера) "
            "в папку с галереей для полного альбома."
        )

    return all_urls


def download_image(url: str) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with _opener().open(req, timeout=60) as resp:
        data = resp.read()
        ctype = resp.headers.get_content_type() or "image/jpeg"
    return data, ctype


def existing_url_keys() -> set[str]:
    keys: set[str] = set()
    for it in load_manifest():
        u = it.get("url")
        if u:
            keys.add(u.split("&")[0])
    return keys


def import_from_profile(
    profile_url: str,
    log: Callable[[str], None] | None = None,
) -> dict:
    urls = collect_profile_urls(profile_url, log=log)
    known = existing_url_keys()
    added = 0
    skipped = 0
    errors = 0

    for i, url in enumerate(urls, 1):
        key = url.split("&")[0]
        if key in known:
            skipped += 1
            continue
        try:
            data, mime = download_image(url)
            if len(data) < 500:
                errors += 1
                continue
            add_photo(
                data,
                mime,
                source="ok",
                profile_url=profile_url,
                original_url=url,
            )
            known.add(key)
            added += 1
            if log and i % 10 == 0:
                log(f"Скачано {i}/{len(urls)}…")
        except Exception:
            errors += 1

    return {
        "found": len(urls),
        "added": added,
        "skipped": skipped,
        "errors": errors,
        "has_cookies": COOKIES_FILE.exists(),
    }


def import_from_har(har_bytes: bytes) -> dict:
    har = json.loads(har_bytes.decode("utf-8"))
    entries = har.get("log", {}).get("entries", [])
    added = 0
    skipped = 0
    known = existing_url_keys()

    for entry in entries:
        url = entry.get("request", {}).get("url", "")
        if not OKCDN_PHOTO_RE.search(url):
            continue
        if any(p in url for p in SKIP_URL_PARTS):
            continue
        key = url.split("&")[0]
        if key in known:
            skipped += 1
            continue

        content = entry.get("response", {}).get("content", {})
        text = content.get("text")
        if not text:
            continue
        mime = (content.get("mimeType") or "image/webp").split(";")[0]
        if not mime.startswith("image/"):
            continue

        raw = (
            base64.b64decode(text)
            if content.get("encoding") == "base64"
            else text.encode("latin1")
        )
        if len(raw) < 500:
            continue
        add_photo(raw, mime, source="har", original_url=url)
        known.add(key)
        added += 1

    return {"added": added, "skipped": skipped, "entries": len(entries)}
