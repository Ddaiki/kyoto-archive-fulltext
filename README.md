# 京都学・歴彩館 古典籍アーカイブ 全文検索サイト

京都府立京都学・歴彩館「歴史資料アーカイブ（公開）」の古典籍カタログ
（`cls=152_old_books_catalog`、全 **2,716 件**）を対象に、くずし字本文を
Claude API の vision で翻刻テキスト化し、**全文検索できる Web サイト**を構築する
プロジェクト。

**公開URL（プロトタイプ）: <https://ddaiki.github.io/kyoto-archive-fulltext/>**

現状: 全2,716件のカタログを区分で絞り込み可能。華頂要略は先頭400見開きを構造化OCR済みで、
本文全文検索に加え、**ページ種別（平面図_指図ほか）絞り込み・図面ギャラリー・建造物/年号の
ファセット検索（和暦→西暦変換つき）・固有表現の横断・画像ライトボックス送り**に対応。
指図はタイル分割で小注記まで抽出（例: `塀重門` で平面図が引ける）。

> 出典: ©京都府立京都学・歴彩館 歴史資料アーカイブ（公開）
> <https://www.archives.kyoto.jp/websearchpe/>
> 本リポジトリは公開データを研究・教育目的で二次利用する。画像の著作権・利用条件は
> 提供元に帰属する。サイト上に出典クレジットを明記する。

## ステータス

| Phase | 内容 | 状態 |
|-------|------|------|
| 0 | 画像取得可能性の調査 | ✅ **完了 → 取得可能（GO）** [`docs/feasibility.md`](docs/feasibility.md) |
| 1 | データ取得パイプライン | 🟡 全2,716件の基本メタデータ列挙済（区分/タイトル/よみ/編著者）。媒体・画像は資料単位で取得 |
| 2 | くずし字OCR（Claude vision） | 🟡 検証完了・首巻49見開き翻刻済み（実測$0.0147/見開き）[`docs/ocr_cost.md`](docs/ocr_cost.md) |
| 3 | 検索DB（SQLite FTS5） | 🟡 暫定: 静的JSON＋クライアント検索（FTS5化は規模拡大時） |
| 4 | Web サイト＋デプロイ | ✅ **公開中**（GitHub Pages）[`docs/hosting_decision.md`](docs/hosting_decision.md) |
| 5 | UIブラッシュアップ（Claude Design） | ⏳ |

**プロトタイプ（華頂要略を縦に1本）が公開稼働中。** 以降は公開サイトを見ながら、
初期スコープ拡大（全件列挙・追加翻刻）と UI 改善を進める。

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

## プロトタイプの実行（華頂要略を縦に1本）

```bash
. .venv/bin/activate
export SCRAPER_CONTACT_EMAIL="<連絡先>"

# 1) メタデータ＋画像一覧の取得（先頭50画像分の manifest）
python -m src.fetch.record 0000000402 1

# 2) ページ画像のダウンロード（L サイズ・キャッシュ）
python -m src.fetch.images 0000000402 9 L

# 3) くずし字OCR（要 ANTHROPIC_API_KEY。表紙等を避け4枚目から4見開き）
python -m src.ocr.transcribe 0000000402 4 4

# 4) フロント用データ生成
python -m src.db.build_web 0000000402

# 5) ローカル表示
( cd web && python -m http.server 8765 )   # → http://localhost:8765
```

各ステップは取得済みを再利用（idempotent）。OCR 結果は `data/ocr/`、
概算費用は実行ログと `docs/ocr_cost.md` に記録する。

### 無料OCR（NDL古典籍OCR-Lite, 課金なし）

Claude API を使わずローカルCPUで翻刻する手段（`docs/free_ocr.md` 参照）。一度だけ準備:

```bash
mkdir -p ~/tools && cd ~/tools
git clone https://github.com/ndl-lab/ndlkotenocr-lite
python3 -m venv ndlocr-venv
ndlocr-venv/bin/pip install onnxruntime pillow numpy lxml networkx pyparsing \
  ordered-set protobuf pyyaml tqdm reportlab pypdfium2 dill
```

実行（既定で `~/tools/ndlkotenocr-lite` を参照。`NDLKOTENOCR_DIR` で変更可）:

```bash
python -m src.ocr.free_ocr 0000000402 400 50 3   # orders 400-449 を無料OCR（$0）
```

無料OCRは本文テキストのみ（ページ種別・固有表現等の構造化メタは付かない）。サイトでは
「NDL翻刻」バッジで表示し、CC BY 4.0 に基づき出典クレジットを掲示する。

## 設計方針

- **取得元に負荷をかけない**: 直列・1リクエスト/1〜2秒間隔、リトライ指数バックオフ、
  取得済みはローカルキャッシュして再取得しない（idempotent）。
- **段階実行**: 華頂要略（pkey=0000000402）を初期検証対象として「取得→数ページOCR→
  最小フロント表示」まで縦に1本通し、精度とコストを確認してから全件展開する。
- **コスト管理**: OCR は処理枚数・トークン・概算費用を集計し記録。全件展開は依頼者承認後。
