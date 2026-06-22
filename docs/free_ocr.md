# 追加課金なしの翻刻（くずし字OCR）方法の調査

制約: **これ以上 Claude API に課金しない**。既存の Claude 翻刻（華頂 先頭400見開き＋指図タイル、
構造化メタ付き）は活かしつつ、**新規ページの翻刻は無料/ローカル手段**で行う方針を探る。

## 結論（推奨）: NDL古典籍OCR-Lite（ndlkotenocr-lite）

国立国会図書館（NDLラボ）が公開するくずし字OCR。**完全無料・ローカル実行**で本プロジェクトに
最も適合する。

- リポジトリ: <https://github.com/ndl-lab/ndlkotenocr-lite>
- ライセンス: **CC BY 4.0**（出典表示すれば自由に利用可。サイトにクレジット明記が必要）
- 動作環境: **CPUのみで可**（GPU不要）。Windows10 / Intel Mac(macOS Sequoia) / Linux(Ubuntu22.04)。
  ※本機は Apple Silicon(arm64)。onnxruntime は arm64 macOS 対応のため実機検証中（結果は末尾）。
- 実行: Python 3.10+、`pip install -r requirements.txt` → `python3 ocr.py --sourcedir <画像dir> --output <出力dir>`
- 入力: JPG/PNG/TIFF/JP2/BMP（本プロジェクトの `data/images/L|O/*.jpg` をそのまま投入可）
- 出力: テキスト（＋オプションで版面のバウンディングボックス可視化）
- 精度: フル版 NDL古典籍OCR v3 比で約2%低い程度（実用水準）

### パイプラインへの組み込み方針
1. `data/images/L/` のページ画像を ndlkotenocr-lite に投入し、ページ単位の翻刻テキストを得る。
2. `src/ocr/free_ocr.py`（アダプタ）で、Claude版 OCR JSON と**同じ形**（`transcription` を埋め、
   `page_type`/`entities` 等は空）に整形して `data/ocr/<media_pkey>.json` に保存。
3. `build_web` がそのまま取り込み、**無料OCRページは全文検索の対象**になる（課金ゼロ）。

### トレードオフ（重要）
- ndlkotenocr-lite は**本文テキスト抽出のみ**。Claude が付与していた
  **ページ種別分類・固有表現（建造物/人名/地名/年号）・要約・和暦西暦** は付かない。
  → 無料OCRページは「全文検索は効くが、図面フィルタや建造物/年号ファセットには載らない」。
- 図面（指図）の小注記は、テキストOCRでは本プロジェクトのタイル方式ほど取れない可能性。
- つまり **無料OCRで“面”を安く広げ**、構造化が要る重要資料だけ将来 Claude を限定適用、の二層運用が現実的。

## 代替案（自動バッチには不向き）
- **CODH KuroNet / RURIモデル**（<https://mp.ex.nii.ac.jp/kuronet/>）: 無料Webサービスだが
  **ログイン必須・IIIF画像前提・公開APIの記載なし** → 数千枚の自動処理には不向き。
- **miwo（みを）アプリ**: スマホ向けの無料くずし字認識。手動用途。
- **Google Cloud Vision / Tesseract**: くずし字版面にほぼ無力（Phase0で確認済み）。

## 出典・ライセンス上の注意
- ndlkotenocr-lite 利用時は **CC BY 4.0** に従い、サイトに「翻刻: NDL古典籍OCR-Lite（国立国会図書館）」
  等のクレジットを追加する。

## 実機検証ログ（2026-06-22, Apple Silicon arm64 / macOS）

**結果: 動作OK・実用水準。** arm64 でも onnxruntime で問題なく動作した。

- セットアップ: `git clone` 後、venv に `onnxruntime pillow numpy lxml networkx pyparsing
  ordered-set protobuf pyyaml tqdm reportlab pypdfium2 dill` を入れるだけ（flet=GUIは不要）。
  同梱ONNXモデル（検出 rtmdet-s 38MB＋認識 parseq 40MB）で追加DLなし。
- 速度: **1見開き約13.5秒（CPU, 1コア主体）**。並列プロセス化でコア数分高速化可能。
- 出力: `.txt`（本文）/`.json`/`.xml`/`_tei.xml`（版面・読み順・座標つき）。
- 精度比較（華頂目次 0000093233）: NDLは「良寿法印／真性大僧正／第十一慈実大僧正」等を取得し、
  Claude版と同等〜一部良好。両者とも軽微な誤読あり（校正前）。

### 本プロジェクトでの採用
- `src/ocr/free_ocr.py` を追加（ndlkotenocr-lite を subprocess 呼び出し→Claudeと同形のJSONに整形、
  `source="ndlkotenocr-lite"`, `cost_usd=0`）。`python -m src.ocr.free_ocr <pkey> <start> <count> [workers]`。
- 構造化メタ（ページ種別/固有表現/要約）は付かない＝**全文検索は効くが図面/建造物/年号ファセットには非載**。
  サイトでは頁に「NDL翻刻」バッジを表示し、Claude構造化頁（「AI構造化」）と区別。
- 出典表示（CC BY 4.0）: フッターに NDL古典籍OCR-Lite へのクレジット・リンクを追加済み。
- 運用方針: **無料OCRで“面”を安く広げ**、構造化が要る重要資料のみ将来 Claude を限定適用する二層運用。
