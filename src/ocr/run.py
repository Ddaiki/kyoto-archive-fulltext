"""ページ範囲を並行翻刻するバッチランナー。

- 画像（L）は事前に直列・throttle付きでダウンロード（取得元サーバに配慮）。
- 翻刻（Claude API 呼び出し）はスレッドプールで並行化し、所要時間を短縮。
- 進捗・ページ種別分布・合計費用を集計して表示。
- 各ページ結果はキャッシュされ、再実行で再課金しない。

使い方: python -m src.ocr.run <catalog_pkey> <start_order> <count> [workers] [--refresh]
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..fetch import images
from . import transcribe as T


def run(catalog_pkey: str, start: int, count: int, workers: int = 4,
        refresh: bool = False) -> None:
    orders = list(range(start, start + count))
    media = [T._media_pkey_for_order(o) for o in orders]

    # 1) L画像を直列で事前取得（礼儀正しいクロール。キャッシュ済みはスキップ）
    print(f"画像を事前取得中（最大{len(media)}枚, 直列/throttle）…", flush=True)
    for mp in media:
        images.download(mp, "L", catalog_pkey=catalog_pkey)

    # 2) 翻刻を並行実行
    print(f"翻刻を並行実行中（workers={workers}）…", flush=True)
    results = {}
    done = 0

    def work(mp):
        return mp, T.transcribe(mp, catalog_pkey=catalog_pkey, refresh=refresh)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(work, mp) for mp in media]
        for fut in as_completed(futs):
            mp, r = fut.result()
            results[mp] = r
            done += 1
            if done % 20 == 0 or done == len(media):
                cost = sum(x.cost_usd for x in results.values())
                print(f"  {done}/{len(media)} 完了  累計 ${cost:.3f}", flush=True)

    total_cost = sum(r.cost_usd for r in results.values())
    types: dict[str, int] = {}
    o_count = 0
    for r in results.values():
        types[r.page_type] = types.get(r.page_type, 0) + 1
        o_count += r.size == "O"
    print(f"\n完了: {len(results)}見開き  合計 ${total_cost:.4f}  "
          f"平均 ${total_cost/max(1,len(results)):.4f}/見開き  O昇格={o_count}")
    print(f"ページ種別: {dict(sorted(types.items(), key=lambda kv: -kv[1]))}")


if __name__ == "__main__":
    import os

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY が未設定です。")
    pk = sys.argv[1] if len(sys.argv) > 1 else "0000000402"
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    count = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    workers = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 4
    refresh = "--refresh" in sys.argv
    run(pk, start, count, workers, refresh)
