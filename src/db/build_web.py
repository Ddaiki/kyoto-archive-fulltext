"""カタログ全件メタデータ＋（翻刻済み資料の）ページ/翻刻/構造化メタデータを結合して
web/data.json を生成する。

- 全2,716件は区分・タイトル・よみ・編著者など軽量メタデータ（catalog.json 由来）。
- 翻刻済み資料には詳細メタデータ（分類・請求記号）と、ページ単位の
  翻刻・ページ種別・注記ラベル・固有表現（建造物/人名/地名/年号）・要約・キーワードを付与。

これにより「平面図だけ抽出」「特定の門の記載箇所」「建立年代」等の多角検索を可能にする。
"""
from __future__ import annotations

import json
from pathlib import Path

from ..fetch import catalog, record
from ..ocr.transcribe import OCR_DIR

WEB_DATA = Path("web/data.json")
DETAIL_MAX_PAGES = 9  # 翻刻対象資料で列挙するページ数（×50）。9→先頭450見開き。


def _ocr_for(media_pkey: str) -> dict | None:
    p = OCR_DIR / f"{media_pkey}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _attach_pages(rec: dict, catalog_pkey: str) -> None:
    data = json.loads(record.build_record(catalog_pkey, max_pages=DETAIL_MAX_PAGES).to_json())
    meta = data["metadata"]
    rec["classification"] = meta.get("分類", "")
    rec["call_number"] = meta.get("請求記号", "")
    rec["media_total"] = data["media_total"]

    pages = []
    for p in data["pages"]:
        o = _ocr_for(p["media_pkey"]) or {}
        pages.append({
            "order": p["order"],
            "media_pkey": p["media_pkey"],
            "thumb": p["img_S"],
            "image": p["img_L"],
            "image_full": p["img_O"],
            "page_type": o.get("page_type", ""),
            "text": o.get("transcription", ""),
            "labels": o.get("labels", []),
            "entities": o.get("entities", {}),
            "summary": o.get("summary", ""),
            "keywords": o.get("keywords", []),
            "confidence": o.get("confidence"),
            "source": o.get("source", "claude"),
        })
    rec["pages"] = pages


DETAILS_JSON = Path("data/details.json")


def _load_details() -> dict:
    return json.loads(DETAILS_JSON.read_text(encoding="utf-8")) if DETAILS_JSON.exists() else {}


def build(detailed_pkeys: list[str]) -> Path:
    cat = catalog.build_catalog()
    details = _load_details()  # 詳細頁由来の分類・請求記号など（課金なしクロール）
    records = [{
        "pkey": c["pkey"],
        "category": c.get("区分", ""),
        "title": c.get("タイトル", ""),
        "yomi": c.get("タイトルよみ", ""),
        "author": c.get("編著者", ""),
        "publisher": c.get("出版者", ""),
        "year": c.get("出版年月", ""),
        "restriction": c.get("閲覧制限", ""),
        "classification": (details.get(c["pkey"], {}) or {}).get("分類", ""),
        "call_number": (details.get(c["pkey"], {}) or {}).get("請求記号", ""),
    } for c in cat]

    by_pkey = {r["pkey"]: r for r in records}
    for pk in detailed_pkeys:
        if pk in by_pkey:
            _attach_pages(by_pkey[pk], pk)

    cat_facet: dict[str, int] = {}
    cls_facet: dict[str, int] = {}
    for r in records:
        cat_facet[r["category"]] = cat_facet.get(r["category"], 0) + 1
        c = r.get("classification") or ""
        if c:
            cls_facet[c] = cls_facet.get(c, 0) + 1

    out = {
        "source": "京都府立京都学・歴彩館 歴史資料アーカイブ（公開）",
        "source_url": "https://www.archives.kyoto.jp/websearchpe/",
        "catalog_total": len(records),
        "details_count": len(details),
        "facets": {
            "category": dict(sorted(cat_facet.items(), key=lambda kv: -kv[1])),
            "classification": dict(sorted(cls_facet.items(), key=lambda kv: -kv[1])),
        },
        "transcribed_pkeys": [pk for pk in detailed_pkeys if pk in by_pkey],
        "records": records,
    }
    WEB_DATA.parent.mkdir(parents=True, exist_ok=True)
    WEB_DATA.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    tp = [r for r in records if r.get("pages")]
    pg = sum(len([p for p in r["pages"] if p["text"] or p["labels"]]) for r in tp)
    print(f"wrote {WEB_DATA} : 全{len(records)}資料 / 翻刻付き{len(tp)}資料 / 内容のある{pg}見開き")
    return WEB_DATA


if __name__ == "__main__":
    import sys

    pks = sys.argv[1:] or ["0000000402"]
    build(pks)
