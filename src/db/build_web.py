"""manifest と OCR 結果を結合し、フロント用 web/data.json を生成する。

プロトタイプはクライアントサイド全文検索（静的JSON）。Phase 3 で本格化する際は
ここを SQLite FTS5 生成に差し替える（hosting_decision.md 参照）。
"""
from __future__ import annotations

import json
from pathlib import Path

from ..fetch import record
from ..ocr.transcribe import OCR_DIR

WEB_DATA = Path("web/data.json")


def _ocr_for(media_pkey: str) -> dict | None:
    p = OCR_DIR / f"{media_pkey}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return None


def build(catalog_pkeys: list[str]) -> Path:
    records = []
    for pk in catalog_pkeys:
        manifest = record.MANIFEST_DIR / f"{pk}.json"
        if not manifest.exists():
            # プロトタイプでは先頭1ページ分の manifest を許容
            rec = record.build_record(pk, max_pages=1)
            data = json.loads(rec.to_json())
        else:
            data = json.loads(manifest.read_text(encoding="utf-8"))

        pages = []
        for p in data["pages"]:
            ocr = _ocr_for(p["media_pkey"])
            pages.append({
                "order": p["order"],
                "media_pkey": p["media_pkey"],
                "thumb": p["img_S"],
                "image": p["img_L"],
                "image_full": p["img_O"],
                "text": (ocr or {}).get("transcription", ""),
                "confidence": (ocr or {}).get("confidence"),
            })
        records.append({
            "pkey": data["pkey"],
            "title": data["metadata"].get("タイトル", ""),
            "title_yomi": data["metadata"].get("タイトルよみ", ""),
            "author": data["metadata"].get("編著者", ""),
            "category": data["metadata"].get("区分", ""),
            "classification": data["metadata"].get("分類", ""),
            "call_number": data["metadata"].get("請求記号", ""),
            "media_total": data["media_total"],
            "pages": pages,
        })

    out = {
        "source": "京都府立京都学・歴彩館 歴史資料アーカイブ（公開）",
        "source_url": "https://www.archives.kyoto.jp/websearchpe/",
        "records": records,
    }
    WEB_DATA.parent.mkdir(parents=True, exist_ok=True)
    WEB_DATA.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    transcribed = sum(1 for r in records for p in r["pages"] if p["text"])
    total = sum(len(r["pages"]) for r in records)
    print(f"wrote {WEB_DATA} : {len(records)}資料 / {total}ページ / 翻刻済み {transcribed}ページ")
    return WEB_DATA


if __name__ == "__main__":
    import sys

    pks = sys.argv[1:] or ["0000000402"]
    build(pks)
