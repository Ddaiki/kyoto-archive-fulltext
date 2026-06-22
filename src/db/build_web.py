"""カタログ全件メタデータ＋（翻刻済み資料の）ページ/翻刻を結合し web/data.json を生成。

- 全2,716件は区分・タイトル・よみ・編著者など軽量メタデータ（catalog.json 由来）。
- 翻刻済み資料（detailed_pkeys）には詳細メタデータ（分類・請求記号）とページ/翻刻を付与。

プロトタイプはクライアントサイド検索＋絞り込み（静的JSON）。規模拡大時に FTS5 へ。
"""
from __future__ import annotations

import json
from pathlib import Path

from ..fetch import catalog, record
from ..ocr.transcribe import OCR_DIR

WEB_DATA = Path("web/data.json")


def _ocr_for(media_pkey: str) -> dict | None:
    p = OCR_DIR / f"{media_pkey}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _attach_pages(rec: dict, catalog_pkey: str) -> None:
    """翻刻済み資料に詳細メタデータとページ/翻刻を付与。"""
    manifest = record.MANIFEST_DIR / f"{catalog_pkey}.json"
    if manifest.exists():
        data = json.loads(manifest.read_text(encoding="utf-8"))
    else:
        data = json.loads(record.build_record(catalog_pkey, max_pages=1).to_json())

    meta = data["metadata"]
    rec["classification"] = meta.get("分類", "")
    rec["call_number"] = meta.get("請求記号", "")
    rec["media_total"] = data["media_total"]
    rec["pages"] = [{
        "order": p["order"],
        "media_pkey": p["media_pkey"],
        "thumb": p["img_S"],
        "image": p["img_L"],
        "image_full": p["img_O"],
        "text": (_ocr_for(p["media_pkey"]) or {}).get("transcription", ""),
        "confidence": (_ocr_for(p["media_pkey"]) or {}).get("confidence"),
    } for p in data["pages"]]


def build(detailed_pkeys: list[str]) -> Path:
    cat = catalog.build_catalog()
    records = []
    for c in cat:
        records.append({
            "pkey": c["pkey"],
            "category": c.get("区分", ""),
            "title": c.get("タイトル", ""),
            "yomi": c.get("タイトルよみ", ""),
            "author": c.get("編著者", ""),
            "publisher": c.get("出版者", ""),
            "year": c.get("出版年月", ""),
            "restriction": c.get("閲覧制限", ""),
        })

    by_pkey = {r["pkey"]: r for r in records}
    for pk in detailed_pkeys:
        if pk in by_pkey:
            _attach_pages(by_pkey[pk], pk)

    # 区分ファセット件数
    facet: dict[str, int] = {}
    for r in records:
        facet[r["category"]] = facet.get(r["category"], 0) + 1

    out = {
        "source": "京都府立京都学・歴彩館 歴史資料アーカイブ（公開）",
        "source_url": "https://www.archives.kyoto.jp/websearchpe/",
        "catalog_total": len(records),
        "facets": {"category": dict(sorted(facet.items(), key=lambda kv: -kv[1]))},
        "transcribed_pkeys": [pk for pk in detailed_pkeys if pk in by_pkey],
        "records": records,
    }
    WEB_DATA.parent.mkdir(parents=True, exist_ok=True)
    WEB_DATA.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    tp = sum(1 for r in records if r.get("pages"))
    pg = sum(len([p for p in r.get("pages", []) if p["text"]]) for r in records)
    print(f"wrote {WEB_DATA} : 全{len(records)}資料 / 翻刻付き{tp}資料 / 翻刻{pg}見開き")
    return WEB_DATA


if __name__ == "__main__":
    import sys

    pks = sys.argv[1:] or ["0000000402"]
    build(pks)
