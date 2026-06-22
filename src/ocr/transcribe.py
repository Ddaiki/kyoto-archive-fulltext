"""くずし字ページ画像を Claude vision で翻刻する。

- 既定モデル: claude-sonnet-4-6（精度が要る箇所のみ上位モデルを検討）
- 既定解像度: L。判読不能（□）が多い／信頼度が低いページは O（原寸）に自動エスカレート。
- 結果は data/ocr/<media_pkey>.json にキャッシュし、再実行で再課金しない。
- 処理ごとのトークン・概算費用を集計し戻り値に含める（docs/ocr_cost.md 用）。
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import anthropic

from ..fetch import images, record

OCR_DIR = Path("data/ocr")
DEFAULT_MODEL = "claude-sonnet-4-6"

# 料金（$/1M tok, 2026-06）。docs/ocr_cost.md と一致させること。
PRICING = {
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-opus-4-8": (5.0, 25.0),
}

SYSTEM_PROMPT = (
    "あなたは日本の古典籍（和装本）のくずし字・変体仮名・旧字体を専門とする翻刻者です。"
    "渡される画像は古典籍の見開き（右ページ→左ページの順、各ページは縦書きで行は右から左）"
    "です。次の方針で本文を翻刻してください。\n"
    "1. くずし字・行草体を現代通行の字体（新字体）に開いて翻刻する。\n"
    "2. 変体仮名は現代仮名の字母（あ・い・う…）に直す。\n"
    "3. 旧字体・異体字は通行字体に直す。\n"
    "4. 判読不能の文字は □ で示す。推測で補わない。\n"
    "5. 行（列）の区切りは改行で表す。右ページと左ページの境目には空行を入れる。\n"
    "6. ページ番号・柱・蔵書印・カラースケール・物差し等の本文外要素は翻刻しない。\n"
    "7. 本文が無い（白紙・表紙・見返し等）の場合は transcription を空文字にする。"
)

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "transcription": {"type": "string", "description": "翻刻本文（改行区切り）"},
        "confidence": {"type": "number", "description": "全体の確信度 0.0–1.0"},
        "illegible_count": {"type": "integer", "description": "□ で示した判読不能文字の数"},
        "notes": {"type": "string", "description": "翻刻上の注記・疑問点（無ければ空文字）"},
    },
    "required": ["transcription", "confidence", "illegible_count", "notes"],
    "additionalProperties": False,
}


@dataclass
class OcrResult:
    media_pkey: str
    size: str
    model: str
    transcription: str
    confidence: float
    illegible_count: int
    notes: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


def _b64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode("ascii")


def _cost(model: str, in_tok: int, out_tok: int) -> float:
    pin, pout = PRICING.get(model, PRICING[DEFAULT_MODEL])
    return in_tok * pin / 1e6 + out_tok * pout / 1e6


def _call(client: anthropic.Anthropic, img_path: Path, model: str) -> tuple[dict, int, int]:
    resp = client.messages.create(
        model=model,
        max_tokens=4000,
        system=[{"type": "text", "text": SYSTEM_PROMPT,
                 "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": "image/jpeg", "data": _b64(img_path)}},
                {"type": "text", "text": "この見開きを上記方針で翻刻してください。"},
            ],
        }],
        output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    )
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text), resp.usage.input_tokens, resp.usage.output_tokens


def transcribe(media_pkey: str, *, catalog_pkey: str = "0000000402",
               model: str = DEFAULT_MODEL, escalate: bool = True,
               refresh: bool = False) -> OcrResult:
    """1ページ（見開き）を翻刻。L で実行し、判読困難なら O に自動エスカレート。"""
    OCR_DIR.mkdir(parents=True, exist_ok=True)
    out = OCR_DIR / f"{media_pkey}.json"
    if out.exists() and not refresh:
        return OcrResult(**json.loads(out.read_text(encoding="utf-8")))

    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY を環境/ .env から解決

    size = "L"
    img = images.download(media_pkey, size, catalog_pkey=catalog_pkey)
    data, in_tok, out_tok = _call(client, img, model)
    cost = _cost(model, in_tok, out_tok)

    # エスカレーション条件: 真に判読困難なページに限定（L単独を既定とし費用倍化を避ける）。
    # 検証（docs/ocr_cost.md）で確信度0.7台でもLで十分翻刻できたため、しきい値を厳しめに。
    needs_better = (
        data["transcription"].strip()
        and (data["confidence"] < 0.60 or data["illegible_count"] >= 15)
    )
    if escalate and needs_better:
        size = "O"
        img_o = images.download(media_pkey, size, catalog_pkey=catalog_pkey)
        data, in_tok, out_tok = _call(client, img_o, model)
        cost += _cost(model, in_tok, out_tok)

    res = OcrResult(
        media_pkey=media_pkey, size=size, model=model,
        transcription=data["transcription"], confidence=float(data["confidence"]),
        illegible_count=int(data["illegible_count"]), notes=data["notes"],
        input_tokens=in_tok, output_tokens=out_tok, cost_usd=round(cost, 5),
    )
    out.write_text(json.dumps(asdict(res), ensure_ascii=False, indent=2), encoding="utf-8")
    return res


if __name__ == "__main__":
    import sys

    catalog = sys.argv[1] if len(sys.argv) > 1 else "0000000402"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 4  # 表紙・見返しを避けて4枚目から

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY が未設定です。.env に設定してください。")

    rec = record.build_record(catalog, max_pages=1)
    targets = rec.pages[start:start + n]
    total_cost = 0.0
    for p in targets:
        r = transcribe(p.media_pkey, catalog_pkey=catalog)
        total_cost += r.cost_usd
        head = r.transcription.replace("\n", " / ")[:60]
        print(f"[{p.order}] media={r.media_pkey} size={r.size} "
              f"conf={r.confidence:.2f} □={r.illegible_count} "
              f"in={r.input_tokens} out={r.output_tokens} ${r.cost_usd:.4f}")
        print(f"      {head}…")
    print(f"\n合計概算費用: ${total_cost:.4f}（{len(targets)}見開き, model={DEFAULT_MODEL}）")
