"""パッケージ初期化。プロジェクト直下の .env を環境変数に読み込む。

これにより `anthropic.Anthropic()`（ANTHROPIC_API_KEY を参照）や
取得クライアントの SCRAPER_CONTACT_EMAIL が .env から解決される。
既存の環境変数は上書きしない（override=False）。
"""
from __future__ import annotations

try:
    from dotenv import load_dotenv

    load_dotenv(override=False)
except ImportError:  # python-dotenv 未導入でも他機能は動く
    pass
