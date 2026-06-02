#!/usr/bin/env python3
"""Сервер галереи: фото, общие удаления, импорт с OK.ru."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from gallery_store import (
    IMAGES_DIR,
    migrate_legacy_embedded,
    photo_path,
    list_for_api,
)
from ok_import import import_from_har, import_from_profile

ROOT = Path(__file__).resolve().parent
DELETED_FILE = ROOT / "deleted.json"
GALLERY_FILE = ROOT / "gallery.html"
HOST = "0.0.0.0"
PORT = 8765
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "tinytiny")

_import_lock = threading.Lock()


def _is_admin(handler: BaseHTTPRequestHandler, body: dict | None) -> bool:
    got = handler.headers.get("X-Admin-Password") or (body or {}).get("adminPassword")
    return got == ADMIN_PASSWORD


def load_deleted() -> set[str]:
    if not DELETED_FILE.exists():
        return set()
    try:
        data = json.loads(DELETED_FILE.read_text(encoding="utf-8"))
        return set(data) if isinstance(data, list) else set()
    except (json.JSONDecodeError, OSError):
        return set()


def save_deleted(names: set[str]) -> None:
    DELETED_FILE.write_text(
        json.dumps(sorted(names), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _send_json(self, code: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length > 0 else b""

    def _read_json_body(self) -> dict | None:
        try:
            return json.loads(self._read_body().decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def _send_file(self, path: Path) -> None:
        data = path.read_bytes()
        mime, _ = mimetypes.guess_type(str(path))
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/deleted":
            self._send_json(200, sorted(load_deleted()))
            return

        if path == "/api/photos":
            deleted = load_deleted()
            photos = [p for p in list_for_api() if p["id"] not in deleted]
            self._send_json(200, photos)
            return

        if path == "/api/status":
            self._send_json(
                200,
                {
                    "photos": len(list_for_api()),
                    "deleted": len(load_deleted()),
                    "cookies": (ROOT / "cookies.txt").exists(),
                },
            )
            return

        m = re.match(r"^/media/(.+)$", path)
        if m:
            photo_id = m.group(1)
            if ".." in photo_id or "/" in photo_id:
                self.send_error(400)
                return
            fp = photo_path(photo_id)
            if not fp:
                self.send_error(404)
                return
            self._send_file(fp)
            return

        if path in ("/", "/gallery.html"):
            if not GALLERY_FILE.exists():
                self.send_error(404)
                return
            self._send_file(GALLERY_FILE)
            return

        self.send_error(404)

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/deleted":
            body = self._read_json_body()
            if not _is_admin(self, body):
                self._send_json(403, {"error": "Нужен пароль редактирования"})
                return
            name = (body or {}).get("name")
            if not name or not isinstance(name, str):
                self._send_json(400, {"error": "name required"})
                return
            deleted = load_deleted()
            deleted.add(name)
            save_deleted(deleted)
            self._send_json(200, {"ok": True, "deleted": sorted(deleted)})
            return

        if path == "/api/import":
            body = self._read_json_body()
            if not _is_admin(self, body):
                self._send_json(403, {"error": "Нужен пароль редактирования"})
                return
            url = (body or {}).get("url", "").strip()
            if not url:
                self._send_json(400, {"error": "url required"})
                return
            if not _import_lock.acquire(blocking=False):
                self._send_json(409, {"error": "Импорт уже выполняется"})
                return
            try:
                result = import_from_profile(url)
                self._send_json(200, {"ok": True, **result})
            except Exception as exc:
                self._send_json(400, {"error": str(exc)})
            finally:
                _import_lock.release()
            return

        if path == "/api/import/har":
            if self.headers.get("X-Admin-Password") != ADMIN_PASSWORD:
                self._send_json(403, {"error": "Нужен пароль редактирования"})
                return
            raw = self._read_body()
            ctype = self.headers.get("Content-Type", "")
            har_bytes: bytes | None = None

            if "multipart/form-data" in ctype:
                boundary = None
                for part in ctype.split(";"):
                    part = part.strip()
                    if part.startswith("boundary="):
                        boundary = part.split("=", 1)[1].strip('"')
                        break
                if boundary:
                    for chunk in raw.split(f"--{boundary}".encode()):
                        if b"filename=" in chunk and b"{" in chunk:
                            idx = chunk.find(b"\r\n\r\n")
                            if idx >= 0:
                                har_bytes = chunk[idx + 4 :].rsplit(b"\r\n", 1)[0]
                                break
            else:
                har_bytes = raw

            if not har_bytes:
                self._send_json(400, {"error": "HAR file required"})
                return

            if not _import_lock.acquire(blocking=False):
                self._send_json(409, {"error": "Импорт уже выполняется"})
                return
            try:
                result = import_from_har(har_bytes)
                self._send_json(200, {"ok": True, **result})
            except Exception as exc:
                self._send_json(400, {"error": str(exc)})
            finally:
                _import_lock.release()
            return

        self.send_error(404)


def main() -> None:
    if not GALLERY_FILE.exists():
        raise SystemExit(f"Не найден {GALLERY_FILE}")

    n = migrate_legacy_embedded()
    if n:
        print(f"Перенесено {n} фото из gallery.html → data/images/")

    os.chdir(ROOT)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    import socket

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan = s.getsockname()[0]
        s.close()
    except OSError:
        lan = "127.0.0.1"

    print(f"Галерея: http://127.0.0.1:{PORT}/")
    print(f"В сети:    http://{lan}:{PORT}/")
    print(f"Фото:      {IMAGES_DIR}")
    print(f"Удаления:  {DELETED_FILE}")
    print("Импорт OK: cookies.txt в этой папке (опционально)")
    print("Остановка: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен")


if __name__ == "__main__":
    main()
