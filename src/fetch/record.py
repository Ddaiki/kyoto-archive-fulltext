"""カタログ1レコードのメタデータと、紐づくページ画像（メディア）一覧を取得して
manifest JSON を組み立てる。

画像一覧は詳細ページが内部で叩く Ajax `/rest/link` をページング（pnList=[1, N]、
1ページ50件）して全件列挙する。取得結果は data/manifests/<pkey>.json に保存し、
再実行では再取得しない。
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

from bs4 import BeautifulSoup

from . import client

CLS = "152_old_books_catalog"
MEDIA_CLS = "150_media_old_books"
PER_PAGE = 50
MANIFEST_DIR = Path("data/manifests")


@dataclass
class Page:
    order: int          # 0始まりの通し番号
    media_pkey: str     # 150_media_old_books の pkey
    detaillnk_idx: int  # mediaDetail へのリンクで使う index
    # 画像URL（サイズ別）。原寸/大は OCR で使用、サムネは一覧表示で使用。
    img_L: str
    img_O: str
    img_S: str


@dataclass
class Record:
    pkey: str
    cls: str
    metadata: dict
    media_total: int
    pages: list[Page] = field(default_factory=list)

    def to_json(self) -> str:
        d = asdict(self)
        return json.dumps(d, ensure_ascii=False, indent=2)


def media_url(media_pkey: str, size: str) -> str:
    # ?c4700 はキャッシュバスター。無くても取得可能なので付けない。
    return f"{client.BASE}/rest/media/{size}?cls={MEDIA_CLS}&pkey={media_pkey}"


def parse_metadata(detail_html: str) -> dict:
    soup = BeautifulSoup(detail_html, "html.parser")
    meta: dict[str, str] = {}
    for row in soup.select("table.tableB tbody tr"):
        th = row.find("th", attrs={"scope": "col"})
        td = row.find("td")
        if not th or td is None:
            continue
        key = th.get_text(strip=True)
        val = td.get_text(" ", strip=True)
        if key:
            meta[key] = val
    return meta


def _parse_link_page(html: str) -> tuple[int, list[tuple[str, int]]]:
    """1ページ分の (総件数, [(media_pkey, detaillnk_idx), ...]) を返す。"""
    soup = BeautifulSoup(html, "html.parser")

    total = 0
    hit = soup.find("p", class_="result-hitcount")
    if hit:
        m = re.search(r"([0-9,]+)\s*件のデータ", hit.get_text())
        if m:
            total = int(m.group(1).replace(",", ""))

    items: list[tuple[str, int]] = []
    for a in soup.select("a.listImage[href]"):
        href = a["href"]
        pk = re.search(r"lPkey=(\d{10})", href)
        idx = re.search(r"detaillnkIdx=(\d+)", href)
        if pk:
            items.append((pk.group(1), int(idx.group(1)) if idx else 1))
    return total, items


def build_record(pkey: str, *, max_pages: int | None = None,
                 refresh: bool = False) -> Record:
    """レコードの manifest を構築（キャッシュ優先）。

    max_pages を指定すると画像一覧の先頭 N ページ（N×50枚）だけ列挙する
    （プロトタイプ用。華頂要略は全341ページ＝17,020枚あるため）。
    """
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    out = MANIFEST_DIR / f"{pkey}.json"
    if out.exists() and not refresh and max_pages is None:
        return _load(out)

    referer = client.detail_referer(pkey)
    detail_html = client.get_text("detail", {"cls": CLS, "pkey": pkey}, cache_group="html")
    metadata = parse_metadata(detail_html)

    # 1ページ目で総件数と総ページ数を把握
    first = _link_page(pkey, 1, referer)
    media_total, first_items = _parse_link_page(first)
    total_pages = max(1, -(-media_total // PER_PAGE)) if media_total else 1
    if max_pages is not None:
        total_pages = min(total_pages, max_pages)

    pairs: list[tuple[str, int]] = list(first_items)
    for n in range(2, total_pages + 1):
        html = _link_page(pkey, n, referer)
        _, items = _parse_link_page(html)
        pairs.extend(items)

    pages = [
        Page(
            order=i,
            media_pkey=mp,
            detaillnk_idx=idx,
            img_L=media_url(mp, "L"),
            img_O=media_url(mp, "O"),
            img_S=media_url(mp, "S"),
        )
        for i, (mp, idx) in enumerate(pairs)
    ]
    rec = Record(pkey=pkey, cls=CLS, metadata=metadata, media_total=media_total, pages=pages)

    if max_pages is None:
        out.write_text(rec.to_json(), encoding="utf-8")
    return rec


def _link_page(pkey: str, n: int, referer: str) -> str:
    # pnList=[1, n]: index0=ダミー(totalPages=1)、index1=画像一覧セクション
    return client.get_text(
        "rest/link",
        {"cls": CLS, "pkey": pkey, "pnList[]": ["1", str(n)],
         "lnk": "false", "lnkDic": "false"},
        referer=referer, xhr=True, cache_group="link",
    )


def _load(path: Path) -> Record:
    d = json.loads(path.read_text(encoding="utf-8"))
    d["pages"] = [Page(**p) for p in d["pages"]]
    return Record(**d)


if __name__ == "__main__":
    import sys
    pk = sys.argv[1] if len(sys.argv) > 1 else "0000000402"
    mp = int(sys.argv[2]) if len(sys.argv) > 2 else None
    rec = build_record(pk, max_pages=mp)
    print(f"pkey={rec.pkey}")
    print(f"title={rec.metadata.get('タイトル')}")
    print(f"分類={rec.metadata.get('分類')} 区分={rec.metadata.get('区分')}")
    print(f"media_total={rec.media_total} 列挙済ページ画像={len(rec.pages)}")
    for p in rec.pages[:3]:
        print(f"  [{p.order}] media={p.media_pkey} L={p.img_L}")
