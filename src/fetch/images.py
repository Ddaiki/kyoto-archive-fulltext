"""ページ画像のダウンロード（サイズ別・キャッシュ付き）。"""
from __future__ import annotations

from pathlib import Path

from . import client, record

IMG_DIR = Path("data/images")


def download(media_pkey: str, size: str = "L", *, catalog_pkey: str | None = None) -> Path:
    """メディアを指定サイズで取得し data/images/<size>/<pkey>.jpg に保存。返り値はパス。"""
    out = IMG_DIR / size / f"{media_pkey}.jpg"
    if out.exists():
        return out
    referer = client.detail_referer(catalog_pkey) if catalog_pkey else None
    data = client.get_bytes(
        f"rest/media/{size}",
        {"cls": record.MEDIA_CLS, "pkey": media_pkey},
        referer=referer,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return out


if __name__ == "__main__":
    import sys

    pk = sys.argv[1] if len(sys.argv) > 1 else "0000000402"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 9
    size = sys.argv[3] if len(sys.argv) > 3 else "L"
    rec = record.build_record(pk, max_pages=1)
    for p in rec.pages[:n]:
        path = download(p.media_pkey, size, catalog_pkey=pk)
        print(f"[{p.order}] {path} ({path.stat().st_size} bytes)")
