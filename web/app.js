// 京都古典籍 全文検索 プロトタイプ — カタログ絞り込み＋翻刻全文検索（クライアントサイド）
let DATA = { records: [], facets: { category: {} } };
const selectedCats = new Set();
const expanded = new Set();        // 展開中の資料pkey
const MAX_RENDER = 300;            // 一度に描画する資料数の上限

const els = {
  q: document.getElementById("q"),
  results: document.getElementById("results"),
  count: document.getElementById("count"),
  facets: document.getElementById("facets"),
  onlyTx: document.getElementById("onlyTx"),
  lightbox: document.getElementById("lightbox"),
  lbImg: document.getElementById("lbImg"),
  lbClose: document.getElementById("lbClose"),
};

init();

async function init() {
  try {
    DATA = await (await fetch("data.json")).json();
  } catch {
    els.results.innerHTML = `<p>データを読み込めませんでした（data.json 未生成）。</p>`;
    return;
  }
  renderFacets();
  els.q.addEventListener("input", debounce(render, 140));
  els.onlyTx.addEventListener("change", render);
  els.lbClose.addEventListener("click", closeLightbox);
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
  render();
}

function renderFacets() {
  const cats = DATA.facets.category || {};
  els.facets.innerHTML = Object.entries(cats)
    .map(([name, n]) => `<button class="chip" data-cat="${esc(name)}">${esc(name)} <span>${n}</span></button>`)
    .join("");
  for (const b of els.facets.querySelectorAll(".chip")) {
    b.addEventListener("click", () => {
      const c = b.dataset.cat;
      if (selectedCats.has(c)) { selectedCats.delete(c); b.classList.remove("on"); }
      else { selectedCats.add(c); b.classList.add("on"); }
      render();
    });
  }
}

function render() {
  const q = els.q.value.trim();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const onlyTx = els.onlyTx.checked;

  const matched = [];
  for (const r of DATA.records) {
    if (selectedCats.size && !selectedCats.has(r.category)) continue;
    const hasPages = r.pages && r.pages.length;
    if (onlyTx && !hasPages) continue;

    const metaText = `${r.title} ${r.yomi} ${r.author} ${r.classification || ""}`;
    const metaHit = !terms.length || matchAll(metaText, terms);
    let pageHits = [];
    if (hasPages && terms.length) pageHits = r.pages.filter((p) => matchAll(p.text, terms));

    if (!terms.length) { matched.push({ r, pageHits: [] }); continue; }
    if (metaHit || pageHits.length) matched.push({ r, pageHits });
  }

  // 翻刻あり・本文ヒットを上位に
  matched.sort((a, b) =>
    (b.pageHits.length > 0) - (a.pageHits.length > 0) ||
    (!!b.r.pages) - (!!a.r.pages));

  const shown = matched.slice(0, MAX_RENDER);
  els.results.innerHTML = shown.map(({ r, pageHits }) => recordCard(r, terms, pageHits)).join("")
    || `<p class="empty-msg">該当する資料が見つかりませんでした。</p>`;
  if (matched.length > shown.length) {
    els.results.insertAdjacentHTML("beforeend",
      `<p class="empty-msg">上位 ${shown.length} 件を表示（該当 ${matched.length.toLocaleString()} 件）。語を追加して絞り込んでください。</p>`);
  }
  els.count.textContent =
    `${matched.length.toLocaleString()} 資料` + (terms.length ? " 該当" : ` / 全${DATA.catalog_total.toLocaleString()}`);

  wireCards();
}

function recordCard(r, terms, pageHits) {
  const hasPages = r.pages && r.pages.length;
  const isOpen = expanded.has(r.pkey) || pageHits.length > 0;
  const detailUrl = `https://www.archives.kyoto.jp/websearchpe/detail?cls=152_old_books_catalog&pkey=${r.pkey}`;

  const sub = [];
  if (r.author) sub.push(esc(r.author));
  if (r.classification) sub.push("分類 " + esc(r.classification));
  if (r.call_number) sub.push("請求 " + esc(r.call_number));
  if (r.media_total) sub.push(`全${r.media_total.toLocaleString()}画像`);
  if (r.year) sub.push(esc(r.year));

  let body = "";
  if (hasPages) {
    const pages = (terms.length && pageHits.length) ? pageHits : r.pages;
    const label = (terms.length && pageHits.length)
      ? `本文ヒット ${pageHits.length} 見開き` : `翻刻 ${r.pages.length} 見開き`;
    body = `
      <button class="toggle-pages" data-pkey="${r.pkey}">${isOpen ? "▼" : "▶"} ${label}</button>
      <div class="pages ${isOpen ? "" : "hidden"}">
        ${pages.map((p) => pageRow(p, terms)).join("")}
      </div>`;
  }

  return `<article class="rec">
    <div class="rec-head">
      <span class="badge">${esc(r.category)}</span>
      <h2 class="rec-title">${highlight(r.title, terms)}
        ${r.yomi ? `<span class="yomi">${highlight(r.yomi, terms)}</span>` : ""}</h2>
    </div>
    <div class="rec-sub">${sub.join("　/　")}
      <a class="src" href="${detailUrl}" target="_blank" rel="noopener">原資料↗</a></div>
    ${body}
  </article>`;
}

function pageRow(p, terms) {
  const hasText = p.text && p.text.trim();
  const text = hasText ? `<p class="text">${highlight(p.text, terms)}</p>`
    : `<p class="text empty">（翻刻準備中）</p>`;
  const conf = p.confidence != null
    ? `<div class="conf">自動翻刻 確信度 ${(p.confidence * 100).toFixed(0)}%</div>` : "";
  return `<div class="page">
    <img loading="lazy" src="${p.thumb}" data-full="${p.image_full}" alt="第${p.order + 1}画像">
    <div class="pbody"><div class="plabel">第 ${p.order + 1} 画像</div>${text}${conf}</div>
  </div>`;
}

function wireCards() {
  for (const b of els.results.querySelectorAll(".toggle-pages")) {
    b.addEventListener("click", () => {
      const pk = b.dataset.pkey;
      if (expanded.has(pk)) expanded.delete(pk); else expanded.add(pk);
      render();
    });
  }
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
