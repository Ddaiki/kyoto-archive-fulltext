"""カタログ各レコードの詳細ページから、一覧に無いメタデータ（分類・請求記号・巻次・
解説など）を取得する。Claude API は使わず、詳細ページHTMLのスクレイピングのみ（課金なし）。

全2,716件を直列・throttle付きで取得（取得元サーバに配慮）。HTMLは client がキャッシュ
するため再実行は速い。抽出結果は data/details.json に逐次保存し、再開可能。
"""
from __future__ import annotations

import json
from pathlib import Path

from . import client
from .catalog import build_catalog
from .record import CLS, parse_metadata

DETAILS_JSON = Path("data/details.json")
# 詳細ページから拾う項目（検索・絞り込みに有用なもの）
FIELDS = ["分類", "請求記号", "巻次", "出版者", "出版年月", "解説", "別書名", "内容細目"]
SAVE_EVERY = 50


def _load() -> dict:
    if DETAILS_JSON.exists():
        return json.loads(DETAILS_JSON.read_text(encoding="utf-8"))
    return {}


def _save(data: dict) -> None:
    DETAILS_JSON.parent.mkdir(parents=True, exist_ok=True)
    DETAILS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def build_details(pkeys: list[str] | None = None, *, refresh: bool = False) -> dict:
    if pkeys is None:
        pkeys = [c["pkey"] for c in build_catalog()]
    data = {} if refresh else _load()

    todo = [pk for pk in pkeys if pk not in data]
    print(f"詳細取得: 対象{len(pkeys)} / 取得済み{len(pkeys)-len(todo)} / 残り{len(todo)}", flush=True)

    done = 0
    for pk in todo:
        html = client.get_text("detail", {"cls": CLS, "pkey": pk}, cache_group="html")
        meta = parse_metadata(html)
        data[pk] = {f: meta.get(f, "") for f in FIELDS}
        done += 1
        if done % SAVE_EVERY == 0:
            _save(data)
            print(f"  {done}/{len(todo)} 取得", flush=True)
    _save(data)
    return data


if __name__ == "__main__":
    import sys
    d = build_details(refresh="--refresh" in sys.argv)
    from collections import Counter
    c = Counter((v.get("分類") or "（分類なし）") for v in d.values())
    print(f"完了 {len(d)}件")
    print("分類 上位:", c.most_common(15))
