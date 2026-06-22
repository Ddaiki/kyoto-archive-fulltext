# Phase 4 — デプロイ先 選定

**確定: GitHub Pages（静的）＋ クライアントサイド全文検索。**
公開URL: <https://ddaiki.github.io/kyoto-archive-fulltext/>
デプロイ: `.github/workflows/pages.yml` が `web/` を push 時に自動公開（CI/CD手離れ良）。

## 選定理由: GitHub Pages（静的）＋ クライアントサイド全文検索

理由（データが静的に固められる前提が成り立つため）:

- 出力は `(pkey, 巻, ページ番号, 画像URL, 翻刻テキスト, 信頼度)` ＋ メタデータの
  静的データ。更新頻度は低く、ビルド時に確定できる。
- 画像は提供元の `rest/media` を直リンク参照（再ホストせず帯域・著作権負荷を回避）。
  → 配布物は JSON/SQLite と HTML/JS/CSS のみで軽量。
- CI/CD・運用が最も手離れ良い（GitHub Actions でビルド→Pages 公開）。

### 検索方式の候補（規模で選択）

1. **静的JSON ＋ クライアント検索ライブラリ**（小〜中規模・最も単純）。
2. **sql.js で SQLite(FTS5) をブラウザ実行**（既存 `tobacco-price-database` と同系統、
   n-gramトークナイザで日本語全文検索）。データ量が増えても分割ロードで対応。

データ量が一定を超える、または動的更新が必要になった場合の代替:
- **Supabase（Postgres全文検索）＋ 静的フロント**、もしくは既存 **PythonAnywhere**。

## 確定タイミング

Phase 1〜3 で実データ量（翻刻テキスト総量・索引サイズ）が見えた段階で本ファイルを更新し、
最終選定理由を確定する。
