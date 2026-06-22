"""京都学・歴彩館アーカイブへの取得元配慮済みHTTPクライアント。

- 直列・リクエスト間隔 1.5 秒（取得元サーバに負荷をかけない）
- 5xx/タイムアウトは指数バックオフでリトライ
- GET レスポンスはローカルキャッシュ（再実行で再取得しない / idempotent）
- User-Agent に連絡先を明記
"""
from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from urllib.parse import urlencode

import requests

BASE = "https://www.archives.kyoto.jp/websearchpe"
CACHE_DIR = Path(os.environ.get("ARCHIVE_CACHE_DIR", "data/cache"))
MIN_INTERVAL = float(os.environ.get("ARCHIVE_MIN_INTERVAL", "1.5"))  # 秒
MAX_RETRIES = 4

_contact = os.environ.get("SCRAPER_CONTACT_EMAIL", "")
USER_AGENT = (
    f"kyoto-archive-fulltext/0.1 (research; respectful crawl"
    + (f"; contact: {_contact}" if _contact else "")
    + ")"
)

_last_request_ts = 0.0


def _throttle() -> None:
    global _last_request_ts
    wait = MIN_INTERVAL - (time.monotonic() - _last_request_ts)
    if wait > 0:
        time.sleep(wait)
    _last_request_ts = time.monotonic()


def _cache_path(method: str, url: str, params: dict | None, suffix: str) -> Path:
    key = f"{method} {url}?{urlencode(params or {}, doseq=True)}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / suffix / f"{digest}{_ext_for(suffix)}"


def _ext_for(suffix: str) -> str:
    return ".bin" if suffix == "media" else ".cache"


def get_text(path: str, params: dict | None = None, *, referer: str | None = None,
             xhr: bool = False, cache_group: str = "html") -> str:
    """GET し本文を文字列で返す。キャッシュ優先。"""
    data = _get_bytes(path, params, referer=referer, xhr=xhr, cache_group=cache_group)
    return data.decode("utf-8", errors="replace")


def get_bytes(path: str, params: dict | None = None, *, referer: str | None = None,
              cache_group: str = "media") -> bytes:
    """GET しバイト列で返す（画像用）。キャッシュ優先。"""
    return _get_bytes(path, params, referer=referer, xhr=False, cache_group=cache_group)


def post_text(path: str, data: dict, *, referer: str | None = None,
              cache_group: str = "list") -> str:
    """POST（検索一覧）。本文を文字列で返す。キャッシュ優先。"""
    url = path if path.startswith("http") else f"{BASE}/{path.lstrip('/')}"
    cache = _cache_path("POST", url, data, cache_group)
    if cache.exists():
        return cache.read_bytes().decode("utf-8", errors="replace")

    _throttle()
    headers = {"User-Agent": USER_AGENT}
    if referer:
        headers["Referer"] = referer
    body = _with_retries(lambda: requests.post(url, data=data, headers=headers, timeout=40))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(body)
    return body.decode("utf-8", errors="replace")


def _get_bytes(path: str, params: dict | None, *, referer: str | None,
               xhr: bool, cache_group: str) -> bytes:
    url = path if path.startswith("http") else f"{BASE}/{path.lstrip('/')}"
    cache = _cache_path("GET", url, params, cache_group)
    if cache.exists():
        return cache.read_bytes()

    _throttle()
    headers = {"User-Agent": USER_AGENT}
    if referer:
        headers["Referer"] = referer
    if xhr:
        headers["X-Requested-With"] = "XMLHttpRequest"
    body = _with_retries(lambda: requests.get(url, params=params, headers=headers, timeout=60))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(body)
    return body


def _with_retries(call) -> bytes:
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = call()
            if resp.status_code >= 500:
                raise requests.HTTPError(f"server {resp.status_code}")
            resp.raise_for_status()
            return resp.content
        except (requests.RequestException,) as exc:  # noqa: PERF203
            last_exc = exc
            time.sleep(min(2 ** attempt, 30) + 0.5)
    raise RuntimeError(f"request failed after {MAX_RETRIES} retries") from last_exc


def detail_referer(catalog_pkey: str, cls: str = "152_old_books_catalog") -> str:
    return f"{BASE}/detail?cls={cls}&pkey={catalog_pkey}"
