# 京都学・歴彩館 古典籍アーカイブ 全文検索サイト

京都府立京都学・歴彩館「歴史資料アーカイブ（公開）」の古典籍カタログ
（`cls=152_old_books_catalog`、全 **2,716 件**）を対象に、くずし字本文を
Claude API の vision で翻刻テキスト化し、**全文検索できる Web サイト**を構築する
プロジェクト。

> 出典: ©京都府立京都学・歴彩館 歴史資料アーカイブ（公開）
> <https://www.archives.kyoto.jp/websearchpe/>
> 本リポジトリは公開データを研究・教育目的で二次利用する。画像の著作権・利用条件は
> 提供元に帰属する。サイト上に出典クレジットを明記する。

## ステータス

| Phase | 内容 | 状態 |
|-------|------|------|
| 0 | 画像取得可能性の調査 | ✅ **完了 → 取得可能（GO）** [`docs/feasibility.md`](docs/feasibility.md) |
| 1 | データ取得パイプライン | ⏳ 着手前（依頼者の判断待ち） |
| 2 | くずし字OCR（Claude vision） | ⏳ コスト検証待ち [`docs/ocr_cost.md`](docs/ocr_cost.md) |
| 3 | 検索DB（SQLite FTS5） | ⏳ |
| 4 | Web サイト＋デプロイ | ⏳ [`docs/hosting_decision.md`](docs/hosting_decision.md) |
| 5 | UIブラッシュアップ | ⏳ |

現在の到達点は **Phase 0 完了**。Phase 0 の結論と、全件展開・OCR課金の前に確認したい
分岐は `docs/feasibility.md` 末尾「依頼者への確認事項」に記載。

## ディレクトリ構成（予定）

```
.
├── docs/
│   ├── feasibility.md        # Phase 0 調査結果（取得経路・規約・レート方針）
│   ├── ocr_cost.md           # Phase 2 コスト試算と検証ログ
│   └── hosting_decision.md   # Phase 4 デプロイ先選定理由
├── src/
│   ├── fetch/                # Phase 1: カタログ列挙・メタデータ・画像取得
│   ├── ocr/                  # Phase 2: Claude vision 翻刻
│   └── db/                   # Phase 3: FTS5 構築
├── web/                      # Phase 4: フロントエンド
├── data/                     # キャッシュ・DB（.gitignore 済み）
├── .env.example              # 必要な環境変数のひな形
└── requirements.txt
```

## セットアップ（暫定）

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # ANTHROPIC_API_KEY を記入（Phase 2 以降）
```

実行手順は各 Phase 実装時に追記する。

## 設計方針

- **取得元に負荷をかけない**: 直列・1リクエスト/1〜2秒間隔、リトライ指数バックオフ、
  取得済みはローカルキャッシュして再取得しない（idempotent）。
- **段階実行**: 華頂要略（pkey=0000000402）を初期検証対象として「取得→数ページOCR→
  最小フロント表示」まで縦に1本通し、精度とコストを確認してから全件展開する。
- **コスト管理**: OCR は処理枚数・トークン・概算費用を集計し記録。全件展開は依頼者承認後。
