"""カタログ全件（2,716レコード）の基本メタデータを列挙する。

検索結果一覧 `/list`（空条件・500件/頁・全6頁）をパースして、
pkey・区分・タイトル・よみ・編著者・出版者・出版年月・閲覧制限を取得する。
分類・請求記号は一覧に無い（詳細ページ側）ため、ここでは扱わない。
API課金は無し。結果は data/catalog.json にキャッシュ。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

from . import client

CLS = "152_old_books_catalog"
DISPNUM = 500
CATALOG_JSON = Path("data/catalog.json")


def _list_page(pn: int) -> str:
    referer = f"{client.BASE}/search?cls={CLS}"
    return client.post_text(
        "list",
        {"cls": CLS, "chkCls": CLS, "secIdx": "0", "pn": str(pn),
         "dispnum": str(DISPNUM), "sort": "", "order": "", "imginfo": "on"},
        referer=referer, cache_group="list",
    )


def _parse_rows(html: str) -> tuple[int, list[dict]]:
    soup = BeautifulSoup(html, "html.parser")

    # 件数は result-hitcount から取る。#dlMax の「最大100000件」を拾わないこと。
    total = 0
    hit = soup.find("p", class_="result-hitcount")
    m = re.search(r"([0-9,]+)\s*件のデータ", hit.get_text()) if hit else None
    if m:
        total = int(m.group(1).replace(",", ""))

    table = soup.find("table")
    if not table:
        return total, []
    headers = [th.get_text(strip=True) for th in table.select("thead th")]

    rows: list[dict] = []
    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        a = tr.find("a", href=re.compile(r"pkey=\d{10}"))
        if not a:
            continue
        pkey = re.search(r"pkey=(\d{10})", a["href"]).group(1)
        rec: dict[str, str] = {"pkey": pkey}
        # ヘッダ列名と td を対応づける（先頭の「No」列ぶんを考慮）
        offset = len(tds) - len(headers)
        for i, label in enumerate(headers):
            idx = i + offset
            if label and 0 <= idx < len(tds):
                rec[label] = tds[idx].get_text(" ", strip=True)
        rows.append(rec)
    return total, rows


def build_catalog(refresh: bool = False) -> list[dict]:
    if CATALOG_JSON.exists() and not refresh:
        return json.loads(CATALOG_JSON.read_text(encoding="utf-8"))["records"]

    total, first = _parse_rows(_list_page(1))
    pages = max(1, -(-total // DISPNUM))
    pages = min(pages, 20)  # 安全弁: 件数誤検出による暴走を防ぐ（全件でも6頁）
    records = list(first)
    for pn in range(2, pages + 1):
        _, rows = _parse_rows(_list_page(pn))
        records.extend(rows)

    CATALOG_JSON.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_JSON.write_text(
        json.dumps({"total": total, "count": len(records), "records": records},
                   ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"catalog: total={total} 取得={len(records)} → {CATALOG_JSON}")
    return records


if __name__ == "__main__":
    recs = build_catalog(refresh="--refresh" in __import__("sys").argv)
    print(f"{len(recs)} records")
    # 区分の分布を確認
    from collections import Counter
    c = Counter(r.get("区分", "") for r in recs)
    for k, v in c.most_common(10):
        print(f"  区分 {k or '(空)'}: {v}")
    print("sample:", {k: recs[0].get(k) for k in ("pkey", "区分", "タイトル", "編著者")})
