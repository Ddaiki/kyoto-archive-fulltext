# Phase 0 — 画像取得可能性 調査結果

調査日: 2026-06-22
対象: 京都府立京都学・歴彩館 歴史資料アーカイブ（公開）
古典籍カタログ `cls=152_old_books_catalog`
初期検証対象: 華頂要略 本篇170巻（pkey=`0000000402`）

## 結論: **取得可能（GO）**

カタログ全件のレコード列挙・メタデータ・ページ画像（原寸を含む）すべてが、
公開エンドポイントから機械的に取得できることを実機確認した。IIIF/manifest は無いが、
独自の REST 経由で同等のことが可能。**Phase 1（取得パイプライン）へ進める。**

ただし全件OCRは規模が大きくコストが無視できない（後述・要承認）。

---

## サイト構成（実測）

サーバは Microsoft IIS（Windows）上の Thymeleaf 製。詳細ページは
`image_v=false` で、画像は別メディアレコード（`150_media_old_books`）側に紐づき、
詳細ページ読み込み時に Ajax で関連一覧を後読みする方式。

### 1. カタログ全件のレコード列挙

`POST /websearchpe/list`（検索結果一覧。空条件で全件）

```
POST https://www.archives.kyoto.jp/websearchpe/list
Content-Type: application/x-www-form-urlencoded
Referer: https://www.archives.kyoto.jp/websearchpe/search?cls=152_old_books_catalog

cls=152_old_books_catalog&chkCls=152_old_books_catalog&secIdx=0&pn=1&dispnum=500&sort=&order=&imginfo=on
```

- 総件数: **2,716 件**（レスポンス内 `hitcount` = `2,716件`）
- `dispnum=500` 指定で 1 ページ 500 件、`totalPages=6` → `pn=1..6` で全 pkey を列挙可能。
- pkey は 10 桁ゼロ埋め（`0000000001` …）。詳細リンク
  `detail?cls=152_old_books_catalog&pkey=##########` から抽出できる。

### 2. レコード単位のメタデータ

`GET /websearchpe/detail?cls=152_old_books_catalog&pkey=##########`（HTML パース）

詳細ページ HTML の `<th scope="col">…</th>` 見出しで以下の構造化項目を確認:

> 区分 / タイトル / タイトルよみ / 巻次 / 編著者 / 出版者 / 出版年月 /
> 内容細目 / 別書名 / 別書名よみ / 解説 / 分類 / 請求記号 / 書誌詳細 /
> 図書館書籍リンク情報 / 参照 / 閲覧制限 / 閲覧事前予約

（華頂要略の例: 資料名「華頂要略 本篇170巻」・編著者「進藤爲善編」・貴重図書・分類188.45）

### 3. レコードに紐づくページ画像（巻・ページ単位）の列挙

`GET /websearchpe/rest/link`（関連一覧。詳細ページが内部で叩く Ajax）

```
GET /websearchpe/rest/link?cls=152_old_books_catalog&pkey=0000000402&pnList%5B%5D=-1&lnk=false&lnkDic=false
ヘッダ: X-Requested-With: XMLHttpRequest, Referer: <該当detailページ>
```

- レスポンスは `#dispListDiv` を含む HTML 断片。各メディアの
  `lCls=150_media_old_books` / `lPkey=##########` とサムネ `src` を含む。
- ページング: レスポンス内 hidden `name="totalPages"`。`pnList[]` でページ指定。
  1 ページあたり **50 メディア**表示。
- 華頂要略の関連メディアは `totalPages=341` → **約 17,050 ページ画像**（50×341）。
  これは170巻構成ゆえの突出した例。多くの資料は 1〜数十枚規模と推定。

### 4. 実画像の取得

`GET /websearchpe/rest/media/{サイズ}?cls=150_media_old_books&pkey=##########`

実測した利用可能サイズと容量（華頂要略 首巻表紙 pkey=0000093229 で計測）:

| サイズ記号 | 解像度 | 容量 | 用途 |
|-----------|--------|------|------|
| `S` | 250×181 px | ~10 KB | サムネ |
| `M` | 400×289 px | ~24 KB | 一覧 |
| `L` | 1200×869 px | ~245 KB | **OCR候補（標準）** |
| `O` | 3500×2537 px | ~3.4 MB | 原寸（Exif/TIFF由来）。判読困難箇所用 |
| `XL`,`F` | — | 404 | 存在しない |

いずれも `image/jpeg` で返る（200 OK）。`L` の版面はくずし字の筆致が明瞭に読め、
本文ページの翻刻に十分。表紙には資料保存用のカラースケール/物差しが写り込む
（典型的な高品質デジタル化）。

---

## アクセス規約・レート方針

- **robots.txt**: 存在しない（`/robots.txt` は 404／IIS既定エラー）。明示的なクロール禁止は無い。
- **利用規約ページ**: `websearchpe/{terms,agreement,about}` はいずれも 404。
  利用条件は提供元（歴彩館 本体サイト `pref.kyoto.jp/rekisaikan`）に従う想定。
  公開データだが画像著作権・出典表記を尊重し、**サイトに出典クレジットを明記**する。
- **認証不要**: API キー等は不要。`Referer` と（rest/link は）`X-Requested-With` が要る。

### 本プロジェクトのスクレイピング方針（取得元に負荷をかけない）

- **並列度 1（直列）**、リクエスト間隔 **1〜2 秒**。
- User-Agent に連絡先を明記（例:
  `Mozilla/5.0 (kyoto-archive-fulltext research; contact: <email>)`）。
- 取得済みレスポンス・画像は **ローカルキャッシュし再取得しない**（idempotent / 再開可能）。
- 失敗時は指数バックオフでリトライ。5xx/タイムアウトは間隔を空ける。
- 大量取得（華頂要略の約 1.7 万枚等）は夜間・低トラフィック帯に分割実行も検討。

---

## 規模感（取得・処理量の見積り）

- カタログ: **2,716 レコード**。
- 画像総数: 未確定（全件のメディア数集計は Phase 1 で実施）。華頂要略 1 件で約 17,050 枚と
  突出。残り 2,715 件は単点〜数十枚が主体と推定。総数は概ね **数万〜十数万枚**のオーダー。
- この規模差が **OCR コストを大きく左右する**ため、Phase 2 のコスト検証（華頂要略の
  数ページ）と全件展開の承認を分ける。試算は `docs/ocr_cost.md` 参照。

---

## 依頼者への確認事項（全件展開・OCR課金の前に判断を仰ぐ）

Phase 0 は GO。次に進むにあたり、課金とスコープに関わる分岐を確認したい
（詳細・推奨は別途メッセージで提示）。

1. **OCR 用の Claude API キー**（`ANTHROPIC_API_KEY`）の用意可否と、課金上限の目安。
2. **初期スコープ**: まず華頂要略の数ページで精度・コストを検証 → 共有 → 承認後に展開、で良いか。
   全 2,716 件は規模が大きいため、初期公開は一部（例: 貴重図書や代表的資料の小集合）に
   絞る案も併記する。
3. **OCR 解像度**: 標準は `L`（1200px, 安価）、判読困難ページのみ `O`（原寸, 高コスト）に
   フォールバック、という二段運用で良いか。

Phase 1（取得パイプライン）は API 課金を伴わないため、承認が得られれば華頂要略 1 点を
「取得→数ページOCR検証→最小フロント表示」まで縦に1本通すプロトタイプから着手する。
