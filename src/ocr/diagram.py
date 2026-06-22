"""指図（平面図）の高精細ラベル抽出。

Claude vision は画像を長辺1568pxに自動縮小するため、原寸3500pxの指図に小さく書かれた
注記（門名・堂名・室名・寸法）は潰れて読めない。そこで原寸(O)を重なり付きタイルに分割し、
各タイルを実質フル解像度で読み取り、ラベル・固有表現を統合してページのOCR結果に上書きする。

これにより「平面図中の塀重門の記載箇所を探す」等のピンポイント検索を可能にする。
"""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import anthropic
from PIL import Image

from ..fetch import images
from . import transcribe as T

TILE_PROMPT = (
    "これは日本の古典籍の寺院指図（平面図）の一部を切り出した画像です。"
    "図中に手書きで書き込まれた注記の文字（門名・堂名・室名・建物名・寸法・方位など）を"
    "丁寧に読み取り、語ごとに配列で返してください。くずし字・旧字体は現代通行字体に開きます。"
    "判読不能文字は □。線・記号・本文外要素は無視。文字が無ければ空配列。"
    "門の名称は種類（四脚門・唐門・棟門・薬医門・塀重門・中門・総門・山門・築地塀など）を"
    "踏まえて慎重に判読してください。"
)
TILE_SCHEMA = {
    "type": "object",
    "properties": {
        "labels": {"type": "array", "items": {"type": "string"}},
        "buildings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["labels", "buildings"],
    "additionalProperties": False,
}


def _tiles(img: Image.Image, cols: int, rows: int, overlap: float = 0.12):
    W, H = img.size
    tw, th = W / cols, H / rows
    ox, oy = tw * overlap, th * overlap
    for r in range(rows):
        for c in range(cols):
            box = (max(0, int(c * tw - ox)), max(0, int(r * th - oy)),
                   min(W, int((c + 1) * tw + ox)), min(H, int((r + 1) * th + oy)))
            yield img.crop(box)


def _tile_part(tile: Image.Image) -> dict:
    buf = io.BytesIO()
    tile.convert("RGB").save(buf, format="JPEG", quality=90)
    return {"type": "base64", "media_type": "image/jpeg",
            "data": base64.standard_b64encode(buf.getvalue()).decode("ascii")}


def enhance(media_pkey: str, *, catalog_pkey: str = "0000000402",
            cols: int = 3, rows: int = 2, model: str = T.DEFAULT_MODEL) -> dict:
    """指図ページをタイル分割して注記を高精細抽出し、OCRキャッシュに統合する。"""
    ocr_path = T.OCR_DIR / f"{media_pkey}.json"
    if not ocr_path.exists():
        T.transcribe(media_pkey, catalog_pkey=catalog_pkey)
    rec = json.loads(ocr_path.read_text(encoding="utf-8"))

    o_path = images.download(media_pkey, "O", catalog_pkey=catalog_pkey)
    img = Image.open(o_path)
    client = anthropic.Anthropic()

    labels: list[str] = list(rec.get("labels", []))
    buildings: list[str] = list(rec.get("entities", {}).get("建造物", []))
    cost = 0.0
    for tile in _tiles(img, cols, rows):
        resp = client.messages.create(
            model=model, max_tokens=1500,
            system=[{"type": "text", "text": TILE_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": [
                {"type": "image", "source": _tile_part(tile)},
                {"type": "text", "text": "この切片の注記文字を抽出してください。"}]}],
            output_config={"format": {"type": "json_schema", "schema": TILE_SCHEMA}},
        )
        text = next((b.text for b in resp.content if b.type == "text"), "{}")
        try:
            d = json.loads(text)
        except json.JSONDecodeError:
            d = {"labels": [], "buildings": []}
        labels += d.get("labels", [])
        buildings += d.get("buildings", [])
        cost += T._cost(model, resp.usage.input_tokens, resp.usage.output_tokens)

    rec["labels"] = _dedup(labels)
    rec.setdefault("entities", {}).setdefault("建造物", [])
    rec["entities"]["建造物"] = _dedup(buildings)
    rec["tiled"] = True
    rec["tile_cost_usd"] = round(cost, 5)
    rec["cost_usd"] = round(rec.get("cost_usd", 0) + cost, 5)
    ocr_path.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return rec


def _dedup(xs: list[str]) -> list[str]:
    seen, out = set(), []
    for x in xs:
        x = (x or "").strip()
        if x and x not in seen:
            seen.add(x); out.append(x)
    return out


if __name__ == "__main__":
    import sys
    mp = sys.argv[1] if len(sys.argv) > 1 else "0000093506"
    rec = enhance(mp)
    print(f"{mp}: tiled labels={len(rec['labels'])}  tile_cost=${rec['tile_cost_usd']}")
    print("labels:", rec["labels"])
