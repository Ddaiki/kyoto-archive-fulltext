"""無料・ローカルのくずし字OCR（NDL古典籍OCR-Lite）アダプタ。

Claude API を使わず（=追加課金ゼロ）、国立国会図書館の ndlkotenocr-lite を subprocess で
呼び出してページ画像を翻刻し、Claude版と同じ形の OCR JSON に整形して保存する。
構造化メタ（ページ種別・固有表現・要約）は付かないため空のまま＝全文検索の対象にはなる。

事前準備（一度だけ）:
    git clone https://github.com/ndl-lab/ndlkotenocr-lite
    python3 -m venv <venv> && <venv>/bin/pip install onnxruntime pillow numpy lxml \
        networkx pyparsing ordered-set protobuf pyyaml tqdm reportlab pypdfium2 dill
環境変数:
    NDLKOTENOCR_DIR     … クローン先（…/ndlkotenocr-lite）
    NDLKOTENOCR_PYTHON  … 上記venvの python
ライセンス: ndlkotenocr-lite は CC BY 4.0。サイトに出典表示（NDL）を行うこと。
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from ..fetch import images, record
from .transcribe import OCR_DIR, SCHEMA_VERSION

NDL_DIR = Path(os.environ.get("NDLKOTENOCR_DIR", str(Path.home() / "tools/ndlkotenocr-lite")))
NDL_PY = os.environ.get("NDLKOTENOCR_PYTHON", str(Path.home() / "tools/ndlocr-venv/bin/python"))
EMPTY_ENT = {"建造物": [], "人名": [], "地名": [], "年号": []}


def free_transcribe(media_pkey: str, *, catalog_pkey: str = "0000000402",
                    refresh: bool = False) -> dict:
    out = OCR_DIR / f"{media_pkey}.json"
    if out.exists() and not refresh:
        d = json.loads(out.read_text(encoding="utf-8"))
        if d.get("source") == "ndlkotenocr-lite" or d.get("schema_version") == SCHEMA_VERSION:
            return d

    img = images.download(media_pkey, "L", catalog_pkey=catalog_pkey)
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(
            [NDL_PY, "ocr.py", "--sourceimg", str(img.resolve()), "--output", td],
            cwd=str(NDL_DIR / "src"), check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        txt = Path(td) / f"{img.stem}.txt"
        text = txt.read_text(encoding="utf-8").strip() if txt.exists() else ""

    rec = {
        "media_pkey": media_pkey, "size": "L", "model": "ndlkotenocr-lite",
        "source": "ndlkotenocr-lite", "schema_version": SCHEMA_VERSION,
        "page_type": "", "transcription": text, "labels": [], "entities": dict(EMPTY_ENT),
        "summary": "", "keywords": [], "confidence": None, "illegible_count": 0,
        "notes": "NDL古典籍OCR-Lite（CC BY 4.0）による自動翻刻。構造化メタなし。",
        "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0,
    }
    OCR_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return rec


def run(catalog_pkey: str, start: int, count: int, workers: int = 3,
        refresh: bool = False) -> None:
    if not (NDL_DIR / "src" / "ocr.py").exists():
        raise SystemExit(f"ndlkotenocr-lite が見つかりません: {NDL_DIR}（NDLKOTENOCR_DIR を設定）")
    media = [record_media(catalog_pkey, o) for o in range(start, start + count)]

    print(f"L画像を事前取得（直列/throttle, 最大{len(media)}枚）…", flush=True)
    for mp in media:
        images.download(mp, "L", catalog_pkey=catalog_pkey)

    print(f"無料OCR（NDL古典籍OCR-Lite）を並行実行 workers={workers} …", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(free_transcribe, mp, catalog_pkey=catalog_pkey, refresh=refresh)
                for mp in media]
        for _ in as_completed(futs):
            done += 1
            if done % 10 == 0 or done == len(media):
                print(f"  {done}/{len(media)} 完了", flush=True)
    print(f"完了 {done}見開き（費用 $0）", flush=True)


def record_media(catalog_pkey: str, order: int) -> str:
    from .transcribe import _media_pkey_for_order
    return _media_pkey_for_order(order)


if __name__ == "__main__":
    import sys
    pk = sys.argv[1] if len(sys.argv) > 1 else "0000000402"
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 400
    count = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    workers = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 3
    run(pk, start, count, workers, refresh="--refresh" in sys.argv)
