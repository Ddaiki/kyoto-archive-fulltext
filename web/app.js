// 京都古典籍 全文検索 プロトタイプ — クライアントサイド検索
let DATA = { records: [] };

const els = {
  q: document.getElementById("q"),
  results: document.getElementById("results"),
  count: document.getElementById("count"),
  srcLink: document.getElementById("srcLink"),
  lightbox: document.getElementById("lightbox"),
  lbImg: document.getElementById("lbImg"),
  lbClose: document.getElementById("lbClose"),
};

init();

async function init() {
  try {
    const res = await fetch("data.json");
    DATA = await res.json();
  } catch (e) {
    els.results.innerHTML = `<p>データを読み込めませんでした（data.json 未生成）。</p>`;
    return;
  }
  if (DATA.records[0]) {
    els.srcLink.href =
      `https://www.archives.kyoto.jp/websearchpe/detail?cls=152_old_books_catalog&pkey=${DATA.records[0].pkey}`;
  }
  els.q.addEventListener("input", debounce(render, 120));
  els.lbClose.addEventListener("click", closeLightbox);
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
  render();
}

function render() {
  const q = els.q.value.trim();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  let shownPages = 0;
  const html = [];

  for (const rec of DATA.records) {
    const metaHit = terms.length && matchAll(`${rec.title} ${rec.title_yomi} ${rec.author}`, terms);
    const pages = rec.pages.filter((p) => {
      if (!terms.length) return true;
      return metaHit || matchAll(p.text, terms);
    });
    if (!pages.length) continue;

    html.push(`<section class="record">
      <div class="record-head">
        <h2>${esc(rec.title)}</h2>
        <div class="meta">${esc(rec.author)}　区分: ${esc(rec.category)}　分類: ${esc(rec.classification)}
          　請求記号: ${esc(rec.call_number)}　全${rec.media_total.toLocaleString()}画像</div>
      </div>`);

    for (const p of pages) {
      shownPages++;
      const hasText = p.text && p.text.trim();
      const body = hasText
        ? `<p class="text">${highlight(p.text, terms)}</p>`
        : `<p class="text empty">（翻刻準備中）</p>`;
      const conf = (p.confidence != null)
        ? `<div class="conf">自動翻刻 確信度 ${(p.confidence * 100).toFixed(0)}%</div>` : "";
      html.push(`<article class="page">
        <img loading="lazy" src="${p.thumb}" data-full="${p.image_full}" alt="第${p.order + 1}画像">
        <div class="body">
          <div class="label">第 ${p.order + 1} 画像 / media ${p.media_pkey}</div>
          ${body}${conf}
        </div>
      </article>`);
    }
    html.push(`</section>`);
  }

  els.results.innerHTML = html.join("") || `<p>該当する本文が見つかりませんでした。</p>`;
  els.count.textContent = terms.length ? `${shownPages} ページ該当` : `${shownPages} ページ`;
  for (const img of els.results.querySelectorAll(".page img")) {
    img.addEventListener("click", () => openLightbox(img.dataset.full));
  }
}

function matchAll(text, terms) {
  const t = (text || "").toLowerCase();
  return terms.every((w) => t.includes(w.toLowerCase()));
}
function highlight(text, terms) {
  let html = esc(text);
  for (const w of terms) {
    if (!w) continue;
    html = html.replace(new RegExp(escapeRe(esc(w)), "gi"), (m) => `<mark>${m}</mark>`);
  }
  return html;
}
function openLightbox(url) { els.lbImg.src = url; els.lightbox.classList.remove("hidden"); }
function closeLightbox() { els.lightbox.classList.add("hidden"); els.lbImg.src = ""; }

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
