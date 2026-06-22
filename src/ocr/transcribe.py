"""くずし字ページ画像を Claude vision で翻刻し、研究用の構造化メタデータも抽出する。

本文だけでなく寺院の指図（平面図）・絵図・系図にも対応し、ページ種別の分類、
図面の注記ラベル、固有表現（建造物・人名・地名・年号）、要約・キーワードを返す。
これにより「平面図だけ抽出」「特定の門の記載箇所を探す」「建立年代を辿る」等の
多角的な検索を可能にする。

- 既定モデル: claude-sonnet-4-6
- 既定解像度: L。判読困難／図面で注記が小さい場合は O（原寸→モデルには1568px）に昇格。
- 結果は data/ocr/<media_pkey>.json にキャッシュし、再実行で再課金しない。
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

import anthropic

from ..fetch import images, record

OCR_DIR = Path("data/ocr")
DEFAULT_MODEL = "claude-sonnet-4-6"
SCHEMA_VERSION = 2  # スキーマ変更時にインクリメント（古いキャッシュを再処理する判定に使用）

# 料金（$/1M tok, 2026-06）
PRICING = {
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-opus-4-8": (5.0, 25.0),
}

PAGE_TYPES = [
    "本文", "目次", "序跋", "平面図_指図", "絵図", "系図", "表",
    "表紙", "奥付", "見返し", "白紙", "その他",
]
DIAGRAM_TYPES = {"平面図_指図", "絵図", "系図", "表"}

SYSTEM_PROMPT = (
    "あなたは日本の古典籍（和装本）の専門家で、くずし字・変体仮名・旧字体の翻刻と、"
    "寺院の指図（平面図）・絵図・系図の読解に習熟しています。"
    "渡される画像は古典籍の見開き（右ページ→左ページ、各ページ縦書きで行は右から左）です。"
    "次を行い、指定 JSON で返してください。\n"
    "【ページ種別 page_type】次から最も適切なものを1つ: " + " / ".join(PAGE_TYPES) + "。"
    "建物の配置を線で描いた図は『平面図_指図』。\n"
    "【翻刻 transcription】本文を現代通行字体に開いて翻刻（変体仮名→現代仮名字母、"
    "旧字体・異体字→通行字体、判読不能は □、行は改行、右ページと左ページの境に空行）。"
    "図面の場合は読み取れる注記文字を改行区切りで列挙。\n"
    "【注記ラベル labels】図面・絵図に書き込まれた語（門名・堂名・室名・寸法・方位など）を"
    "個別に配列で（本文ページでは空配列）。例: 塀重門, 四脚唐門, 玄関, 二間半。\n"
    "【固有表現 entities】建造物（門・堂・院・殿・室など施設名）, 人名, 地名, "
    "年号（『元和九年』のように元号＋年で。可能なら（西暦）を補う）を種別ごとに配列で。\n"
    "【要約 summary】このページの内容を日本語1文で。\n"
    "【キーワード keywords】検索に有用な語を数個。\n"
    "本文外要素（カラースケール・物差し・柱・蔵書印・ページ番号）は翻刻・抽出しない。"
    "白紙・表紙等は transcription を空に。推測で字を補わない。"
)

_ENT = {
    "type": "object",
    "properties": {
        "建造物": {"type": "array", "items": {"type": "string"}},
        "人名": {"type": "array", "items": {"type": "string"}},
        "地名": {"type": "array", "items": {"type": "string"}},
        "年号": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["建造物", "人名", "地名", "年号"],
    "additionalProperties": False,
}
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "page_type": {"type": "string", "enum": PAGE_TYPES},
        "transcription": {"type": "string"},
        "labels": {"type": "array", "items": {"type": "string"}},
        "entities": _ENT,
        "summary": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number"},
        "illegible_count": {"type": "integer"},
        "notes": {"type": "string"},
    },
    "required": ["page_type", "transcription", "labels", "entities", "summary",
                 "keywords", "confidence", "illegible_count", "notes"],
    "additionalProperties": False,
}


@dataclass
class OcrResult:
    media_pkey: str
    size: str
    model: str
    schema_version: int
    page_type: str
    transcription: str
    labels: list
    entities: dict
    summary: str
    keywords: list
    confidence: float
    illegible_count: int
    notes: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


def _image_part(path: Path) -> dict:
    """画像をマジックナンバーで判定して base64 画像ブロックを返す（O は PNG のことがある）。"""
    raw = path.read_bytes()
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        media_type = "image/png"
    elif raw[:3] == b"\xff\xd8\xff":
        media_type = "image/jpeg"
    elif raw[:4] in (b"GIF8",):
        media_type = "image/gif"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        media_type = "image/webp"
    else:
        media_type = "image/jpeg"
    return {"type": "base64", "media_type": media_type,
            "data": base64.standard_b64encode(raw).decode("ascii")}


def _cost(model: str, in_tok: int, out_tok: int) -> float:
    pin, pout = PRICING.get(model, PRICING[DEFAULT_MODEL])
    return in_tok * pin / 1e6 + out_tok * pout / 1e6


def _call(client: anthropic.Anthropic, img_path: Path, model: str,
          max_tokens: int = 6000) -> tuple[dict, int, int]:
    img_part = _image_part(img_path)
    last_err: Exception | None = None
    # 出力が max_tokens で途切れて JSON が壊れる場合に上限を上げて再試行。
    for mt in (max_tokens, 8000):
        resp = client.messages.create(
            model=model,
            max_tokens=mt,
            system=[{"type": "text", "text": SYSTEM_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": img_part},
                    {"type": "text", "text": "この見開きを上記方針で翻刻・分析してください。"},
                ],
            }],
            output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
        )
        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            return json.loads(text), resp.usage.input_tokens, resp.usage.output_tokens
        except json.JSONDecodeError as e:
            last_err = e
            if resp.stop_reason != "max_tokens":
                break  # 途切れ以外のJSON異常は再試行しても直らない
    raise RuntimeError(f"翻刻JSONの解析に失敗（stop_reason={resp.stop_reason}）") from last_err


def transcribe(media_pkey: str, *, catalog_pkey: str = "0000000402",
               model: str = DEFAULT_MODEL, escalate: bool = True,
               refresh: bool = False) -> OcrResult:
    OCR_DIR.mkdir(parents=True, exist_ok=True)
    out = OCR_DIR / f"{media_pkey}.json"
    if out.exists() and not refresh:
        cached = json.loads(out.read_text(encoding="utf-8"))
        if cached.get("schema_version") == SCHEMA_VERSION:
            return OcrResult(**cached)

    client = anthropic.Anthropic()
    size = "L"
    img = images.download(media_pkey, size, catalog_pkey=catalog_pkey)
    data, in_tok, out_tok = _call(client, img, model)
    cost = _cost(model, in_tok, out_tok)

    # エスカレーションは費用対効果の高いケースに限定。
    # 検証で本文/目次は O でも確信度が改善しなかったため、原則として図面（注記の
    # 読み取りに解像度が効く）と、極端に低確信のページのみ O へ昇格する。
    is_diagram = data["page_type"] in DIAGRAM_TYPES
    has_content = data["transcription"].strip() or data["labels"]
    needs_better = has_content and (
        (is_diagram and data["confidence"] < 0.90)
        or data["confidence"] < 0.45
        or data["illegible_count"] >= 20
    )
    if escalate and needs_better:
        size = "O"
        img_o = images.download(media_pkey, size, catalog_pkey=catalog_pkey)
        data, in_tok, out_tok = _call(client, img_o, model)
        cost += _cost(model, in_tok, out_tok)

    res = OcrResult(
        media_pkey=media_pkey, size=size, model=model, schema_version=SCHEMA_VERSION,
        page_type=data["page_type"], transcription=data["transcription"],
        labels=data["labels"], entities=data["entities"], summary=data["summary"],
        keywords=data["keywords"], confidence=float(data["confidence"]),
        illegible_count=int(data["illegible_count"]), notes=data["notes"],
        input_tokens=in_tok, output_tokens=out_tok, cost_usd=round(cost, 5),
    )
    out.write_text(json.dumps(asdict(res), ensure_ascii=False, indent=2), encoding="utf-8")
    return res


def _media_pkey_for_order(order: int, base: str = "0000093229") -> str:
    """媒体pkeyは連番（華頂要略は0000093229から）。order→媒体pkey。"""
    return f"{int(base) + order:010d}"


if __name__ == "__main__":
    import sys

    catalog = sys.argv[1] if len(sys.argv) > 1 else "0000000402"
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    refresh = "--refresh" in sys.argv

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY が未設定です。.env に設定してください。")

    total_cost = 0.0
    types: dict[str, int] = {}
    for order in range(start, start + n):
        mp = _media_pkey_for_order(order)
        r = transcribe(mp, catalog_pkey=catalog, refresh=refresh)
        total_cost += r.cost_usd
        types[r.page_type] = types.get(r.page_type, 0) + 1
        head = (r.transcription or " ".join(r.labels)).replace("\n", " ")[:46]
        ent = sum(len(v) for v in r.entities.values())
        print(f"[{order:>3}] {mp} {r.size} {r.page_type:<8} conf={r.confidence:.2f} "
              f"ent={ent} ${r.cost_usd:.4f}  {head}…")
    print(f"\n合計 ${total_cost:.4f} / {n}見開き  種別: {types}")
