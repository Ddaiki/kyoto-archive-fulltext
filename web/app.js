// 京都古典籍 全文検索 プロトタイプ
// カタログ絞り込み＋ページ単位の多角検索（ページ種別・建造物・年号・図面ギャラリー）
const DIAGRAM_TYPES = new Set(["平面図_指図", "絵図", "系図", "表"]);
const MAX_RENDER = 300;

let DATA = { records: [], facets: { category: {} }, transcribed_pkeys: [] };
let CORPUS = [];                 // 翻刻済みページの平坦化リスト（資料横断）
const state = {
  tab: "catalog",
  cats: new Set(),               // 区分
  onlyTx: false,
  types: new Set(),              // ページ種別
  onlyDiagram: false,
  building: null,                // 建造物（単一選択）
  year: null,                    // 年号（単一選択）
  view: "list",
  expanded: new Set(),           // カタログ：展開中の資料
};

const $ = (id) => document.getElementById(id);
const els = {};
["q", "count", "pgCount", "facets", "onlyTx", "typeFacets", "onlyDiagram",
 "buildingFacets", "yearFacets", "activeFilters", "catFilters", "pageFilters",
 "catResults", "pageResults", "lightbox", "lbImg", "lbClose"].forEach((k) => els[k] = $(k));

init();

async function init() {
  try { DATA = await (await fetch("data.json")).json(); }
  catch { els.catResults.innerHTML = `<p class="empty-msg">データを読み込めませんでした。</p>`; return; }

  buildCorpus();
  renderCatFacets();
  renderPageFacets();
  els.pgCount.textContent = CORPUS.length ? `(${CORPUS.length}見開き)` : "";

  els.q.addEventListener("input", debounce(renderActive, 140));
  els.onlyTx.addEventListener("change", () => { state.onlyTx = els.onlyTx.checked; renderCatalog(); });
  els.onlyDiagram.addEventListener("click", () => {
    state.onlyDiagram = !state.onlyDiagram;
    els.onlyDiagram.classList.toggle("on", state.onlyDiagram);
    renderPages();
  });
  for (const b of document.querySelectorAll(".tab"))
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  for (const b of document.querySelectorAll(".viewmode"))
    b.addEventListener("click", () => {
      state.view = b.dataset.view;
      document.querySelectorAll(".viewmode").forEach((x) => x.classList.toggle("on", x === b));
      renderPages();
    });
  els.lbClose.addEventListener("click", closeLightbox);
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  handleHash();
  window.addEventListener("hashchange", handleHash);
  renderActive();
}

// ---- データ整形 -------------------------------------------------
function buildCorpus() {
  CORPUS = [];
  for (const r of DATA.records) {
    if (!r.pages) continue;
    for (const p of r.pages) {
      if (!p.text && !(p.labels && p.labels.length) && !p.page_type) continue;
      CORPUS.push({ ...p, _rec: r });
    }
  }
}
function entVals(p, kind) { return (p.entities && p.entities[kind]) || []; }
function pageBlob(p) {
  const e = p.entities || {};
  return [p.text, (p.labels || []).join(" "), p.summary, (p.keywords || []).join(" "),
    (e.建造物 || []).join(" "), (e.人名 || []).join(" "), (e.地名 || []).join(" "),
    (e.年号 || []).join(" "), p._rec.title].join(" ").toLowerCase();
}

// ---- タブ -------------------------------------------------------
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const isCat = tab === "catalog";
  els.catFilters.classList.toggle("hidden", !isCat);
  els.pageFilters.classList.toggle("hidden", isCat);
  els.catResults.classList.toggle("hidden", !isCat);
  els.pageResults.classList.toggle("hidden", isCat);
  els.q.placeholder = isCat
    ? "本文・タイトル・建造物・人名・年号で検索（例: 塀重門 / 親王 / 元和 / 地図）"
    : "華頂要略の本文・注記・固有表現を検索（例: 塀重門 / 庫裡 / 元和）";
  renderActive();
}
function renderActive() { state.tab === "catalog" ? renderCatalog() : renderPages(); }

// ---- カタログ ---------------------------------------------------
function renderCatFacets() {
  const cats = DATA.facets.category || {};
  els.facets.innerHTML = Object.entries(cats)
    .map(([n, c]) => `<button class="chip" data-cat="${esc(n)}">${esc(n)} <span>${c}</span></button>`).join("");
  for (const b of els.facets.querySelectorAll(".chip"))
    b.addEventListener("click", () => { toggleSet(state.cats, b.dataset.cat); b.classList.toggle("on"); renderCatalog(); });
}
function renderCatalog() {
  const terms = termsOf(els.q.value);
  const matched = [];
  for (const r of DATA.records) {
    if (state.cats.size && !state.cats.has(r.category)) continue;
    const hasPages = r.pages && r.pages.length;
    if (state.onlyTx && !hasPages) continue;
    const metaText = `${r.title} ${r.yomi} ${r.author} ${r.classification || ""}`;
    const metaHit = !terms.length || matchAll(metaText, terms);
    let pageHits = [];
    if (hasPages && terms.length) pageHits = r.pages.filter((p) => matchAll(pageBlobR(p, r), terms));
    if (!terms.length) { matched.push({ r, pageHits: [] }); continue; }
    if (metaHit || pageHits.length) matched.push({ r, pageHits });
  }
  matched.sort((a, b) => (b.pageHits.length > 0) - (a.pageHits.length > 0) || (!!b.r.pages) - (!!a.r.pages));
  const shown = matched.slice(0, MAX_RENDER);
  els.catResults.innerHTML = shown.map(({ r, pageHits }) => recordCard(r, terms, pageHits)).join("")
    || `<p class="empty-msg">該当する資料が見つかりませんでした。</p>`;
  if (matched.length > shown.length)
    els.catResults.insertAdjacentHTML("beforeend",
      `<p class="empty-msg">上位 ${shown.length} 件を表示（該当 ${matched.length.toLocaleString()} 件）。語を追加して絞り込んでください。</p>`);
  els.count.textContent = `${matched.length.toLocaleString()} 資料` + (terms.length ? " 該当" : ` / 全${DATA.catalog_total.toLocaleString()}`);
  wireCatCards();
}
function pageBlobR(p, r) {
  const e = p.entities || {};
  return [p.text, (p.labels || []).join(" "), p.summary, (e.建造物 || []).join(" "),
    (e.人名 || []).join(" "), (e.地名 || []).join(" "), (e.年号 || []).join(" ")].join(" ").toLowerCase();
}
function recordCard(r, terms, pageHits) {
  const hasPages = r.pages && r.pages.length;
  const isOpen = state.expanded.has(r.pkey) || pageHits.length > 0;
  const sub = [];
  if (r.author) sub.push(esc(r.author));
  if (r.classification) sub.push("分類 " + esc(r.classification));
  if (r.call_number) sub.push("請求 " + esc(r.call_number));
  if (r.media_total) sub.push(`全${r.media_total.toLocaleString()}画像`);
  let body = "";
  if (hasPages) {
    const withContent = r.pages.filter((p) => p.text || (p.labels && p.labels.length));
    const pages = (terms.length && pageHits.length) ? pageHits : withContent;
    const label = (terms.length && pageHits.length) ? `本文ヒット ${pageHits.length} 見開き`
      : `翻刻 ${withContent.length} 見開き（探索タブで詳細検索）`;
    body = `<button class="toggle-pages" data-pkey="${r.pkey}">${isOpen ? "▼" : "▶"} ${label}</button>
      <div class="pages ${isOpen ? "" : "hidden"}">${pages.slice(0, 30).map((p) => pageRow(p, terms, r)).join("")}</div>`;
  }
  return `<article class="rec">
    <div class="rec-head"><span class="badge">${esc(r.category)}</span>
      <h2 class="rec-title">${highlight(r.title, terms)}${r.yomi ? `<span class="yomi">${highlight(r.yomi, terms)}</span>` : ""}</h2></div>
    <div class="rec-sub">${sub.join("　/　")}<a class="src" href="${detailUrl(r.pkey)}" target="_blank" rel="noopener">原資料↗</a></div>
    ${body}</article>`;
}
function wireCatCards() {
  for (const b of els.catResults.querySelectorAll(".toggle-pages"))
    b.addEventListener("click", () => { toggleSet(state.expanded, b.dataset.pkey); renderCatalog(); });
  wireImages(els.catResults);
}

// ---- ページ探索 -------------------------------------------------
function countBy(fn) {
  const m = new Map();
  for (const p of CORPUS) for (const v of fn(p)) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function renderPageFacets() {
  // ページ種別
  const types = countBy((p) => [p.page_type]);
  els.typeFacets.innerHTML = types.map(([t, n]) =>
    `<button class="chip" data-type="${esc(t)}">${esc(t)} <span>${n}</span></button>`).join("");
  for (const b of els.typeFacets.querySelectorAll(".chip"))
    b.addEventListener("click", () => { toggleSet(state.types, b.dataset.type); b.classList.toggle("on"); renderPages(); });
  // 建造物（上位40）
  const builds = countBy((p) => entVals(p, "建造物")).slice(0, 40);
  els.buildingFacets.innerHTML = builds.map(([t, n]) =>
    `<button class="chip" data-b="${esc(t)}">${esc(t)} <span>${n}</span></button>`).join("") || `<span class="muted-note">（OCR処理が進むと表示）</span>`;
  for (const b of els.buildingFacets.querySelectorAll(".chip"))
    b.addEventListener("click", () => selectSingle("building", b.dataset.b, b, els.buildingFacets));
  // 年号（上位40）
  const years = countBy((p) => entVals(p, "年号")).slice(0, 40);
  els.yearFacets.innerHTML = years.map(([t, n]) =>
    `<button class="chip" data-y="${esc(t)}">${esc(t)} <span>${n}</span></button>`).join("") || `<span class="muted-note">（OCR処理が進むと表示）</span>`;
  for (const b of els.yearFacets.querySelectorAll(".chip"))
    b.addEventListener("click", () => selectSingle("year", b.dataset.y, b, els.yearFacets));
}
function selectSingle(key, val, btn, container) {
  state[key] = state[key] === val ? null : val;
  container.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === btn && state[key] === val));
  renderPages();
}
function renderPages() {
  const terms = termsOf(els.q.value);
  let rows = CORPUS.filter((p) => {
    if (state.types.size && !state.types.has(p.page_type)) return false;
    if (state.onlyDiagram && !DIAGRAM_TYPES.has(p.page_type)) return false;
    if (state.building && !entVals(p, "建造物").includes(state.building)) return false;
    if (state.year && !entVals(p, "年号").includes(state.year)) return false;
    if (terms.length && !matchAll(pageBlob(p), terms)) return false;
    return true;
  });
  rows.sort((a, b) => a.order - b.order);

  els.activeFilters.innerHTML = activeFilterChips();
  for (const x of els.activeFilters.querySelectorAll("[data-clear]"))
    x.addEventListener("click", () => clearFilter(x.dataset.clear));

  const shown = rows.slice(0, MAX_RENDER);
  if (state.view === "gallery") {
    els.pageResults.innerHTML = `<div class="gallery">${shown.map(galleryCell).join("")}</div>`
      || `<p class="empty-msg">該当なし。</p>`;
  } else {
    els.pageResults.innerHTML = shown.map((p) => pageRow(p, terms, p._rec, true)).join("")
      || `<p class="empty-msg">該当する見開きが見つかりませんでした。フィルタや語を調整してください。</p>`;
  }
  if (rows.length > shown.length)
    els.pageResults.insertAdjacentHTML("beforeend", `<p class="empty-msg">上位 ${shown.length} / ${rows.length} 見開きを表示。</p>`);
  els.count.textContent = `${rows.length.toLocaleString()} 見開き` + (terms.length || filtersActive() ? " 該当" : ` / 全${CORPUS.length}`);
  wireImages(els.pageResults);
}
function filtersActive() { return state.types.size || state.onlyDiagram || state.building || state.year; }
function activeFilterChips() {
  const c = [];
  if (state.onlyDiagram) c.push(fchip("図面のみ", "diagram"));
  for (const t of state.types) c.push(fchip("種別:" + t, "type:" + t));
  if (state.building) c.push(fchip("建造物:" + state.building, "building"));
  if (state.year) c.push(fchip("年号:" + state.year, "year"));
  return c.join("");
}
function fchip(label, key) { return `<span class="afilter" data-clear="${esc(key)}">${esc(label)} ✕</span>`; }
function clearFilter(key) {
  if (key === "diagram") { state.onlyDiagram = false; els.onlyDiagram.classList.remove("on"); }
  else if (key === "building") { state.building = null; }
  else if (key === "year") { state.year = null; }
  else if (key.startsWith("type:")) state.types.delete(key.slice(5));
  syncFacetActive();
  renderPages();
}
function syncFacetActive() {
  els.typeFacets.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", state.types.has(c.dataset.type)));
  els.buildingFacets.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", state.building === c.dataset.b));
  els.yearFacets.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", state.year === c.dataset.y));
}

// ---- 部品 -------------------------------------------------------
function pageRow(p, terms, r, full = false) {
  const t = p.page_type ? `<span class="ptype ${DIAGRAM_TYPES.has(p.page_type) ? "diagram" : ""}">${esc(p.page_type)}</span>` : "";
  const hasText = p.text && p.text.trim();
  const text = hasText ? `<p class="text">${highlight(p.text, terms)}</p>`
    : (p.labels && p.labels.length ? "" : `<p class="text empty">（翻刻準備中）</p>`);
  const labels = (p.labels && p.labels.length)
    ? `<div class="chips-line">注記: ${p.labels.map((l) => entChip(l, "building")).join("")}</div>` : "";
  const ents = entityLines(p);
  const summary = full && p.summary ? `<p class="summary">${highlight(p.summary, terms)}</p>` : "";
  const conf = p.confidence != null ? `<span class="conf">確信度 ${(p.confidence * 100).toFixed(0)}%</span>` : "";
  return `<div class="page" data-media="${p.media_pkey}">
    <img loading="lazy" src="${p.thumb}" data-full="${p.image_full}" alt="第${p.order + 1}画像">
    <div class="pbody">
      <div class="plabel">第 ${p.order + 1} 画像 ${t} ${conf}
        <a class="src" href="${mediaUrl(r.pkey, p.media_pkey)}" target="_blank" rel="noopener">原資料↗</a></div>
      ${summary}${labels}${ents}${text}
    </div></div>`;
}
function entityLines(p) {
  const e = p.entities || {};
  const parts = [];
  const row = (kind, label) => {
    const vs = e[kind] || [];
    if (vs.length) parts.push(`<div class="chips-line">${label}: ${vs.map((v) => entChip(v, kind)).join("")}</div>`);
  };
  row("建造物", "建造物"); row("年号", "年号"); row("人名", "人名"); row("地名", "地名");
  return parts.join("");
}
function entChip(val, kind) {
  const k = kind === "年号" ? "year" : "building";
  return `<button class="ent ${kind}" data-ent="${esc(val)}" data-kind="${k}">${esc(val)}</button>`;
}
function galleryCell(p) {
  const cap = p.labels && p.labels.length ? p.labels.slice(0, 3).join("・") : (p.summary || "").slice(0, 24);
  return `<figure class="gcell" data-media="${p.media_pkey}">
    <img loading="lazy" src="${p.thumb}" data-full="${p.image_full}" alt="第${p.order + 1}画像">
    <figcaption><span class="ptype ${DIAGRAM_TYPES.has(p.page_type) ? "diagram" : ""}">${esc(p.page_type || "")}</span> ${esc(cap)}</figcaption>
  </figure>`;
}
function wireImages(root) {
  for (const img of root.querySelectorAll("img[data-full]"))
    img.addEventListener("click", () => openLightbox(img.dataset.full));
  for (const b of root.querySelectorAll(".ent[data-ent]"))
    b.addEventListener("click", () => {
      if (state.tab !== "pages") switchTab("pages");
      const kind = b.dataset.kind;
      state[kind] = b.dataset.ent;
      syncFacetActive(); renderPages();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
}

// ---- ディープリンク（#p=media_pkey） -----------------------------
function handleHash() {
  const m = location.hash.match(/p=(\d{10})/);
  if (!m) return;
  switchTab("pages");
  requestAnimationFrame(() => {
    const el = els.pageResults.querySelector(`[data-media="${m[1]}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); }
  });
}

// ---- ユーティリティ ---------------------------------------------
function detailUrl(pkey) { return `https://www.archives.kyoto.jp/websearchpe/detail?cls=152_old_books_catalog&pkey=${pkey}`; }
function mediaUrl(pkey, media) { return `https://www.archives.kyoto.jp/websearchpe/mediaDetail?cls=152_old_books_catalog&pkey=${pkey}&lCls=150_media_old_books&lPkey=${media}&detaillnkIdx=1`; }
function termsOf(q) { q = q.trim(); return q ? q.split(/\s+/).filter(Boolean) : []; }
function matchAll(text, terms) { const t = (text || "").toLowerCase(); return terms.every((w) => t.includes(w.toLowerCase())); }
function highlight(text, terms) {
  let html = esc(text);
  for (const w of terms) { if (w) html = html.replace(new RegExp(escapeRe(esc(w)), "gi"), (m) => `<mark>${m}</mark>`); }
  return html;
}
function toggleSet(s, v) { s.has(v) ? s.delete(v) : s.add(v); }
function openLightbox(url) { els.lbImg.src = url; els.lightbox.classList.remove("hidden"); }
function closeLightbox() { els.lightbox.classList.add("hidden"); els.lbImg.src = ""; }
function esc(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
