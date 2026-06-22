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
 "catResults", "pageResults", "lightbox", "lbImg", "lbClose",
 "lbPrev", "lbNext", "lbCap"].forEach((k) => els[k] = $(k));
let lbList = [], lbIdx = 0;

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
  els.lbPrev.addEventListener("click", (e) => { e.stopPropagation(); lbStep(-1); });
  els.lbNext.addEventListener("click", (e) => { e.stopPropagation(); lbStep(1); });
  els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (els.lightbox.classList.contains("hidden")) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") lbStep(-1);
    else if (e.key === "ArrowRight") lbStep(1);
  });

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
  // 年号（西暦に変換できるものは年代順、できないものは後ろに）
  const years = countBy((p) => entVals(p, "年号"))
    .map(([t, n]) => [t, n, waToSeireki(t)])
    .sort((a, b) => (a[2] || 99999) - (b[2] || 99999) || b[1] - a[1])
    .slice(0, 50);
  els.yearFacets.innerHTML = years.map(([t, n, sei]) =>
    `<button class="chip" data-y="${esc(t)}">${esc(t)}${sei ? `<span class="sei">${sei}</span>` : ""} <span>${n}</span></button>`).join("")
    || `<span class="muted-note">（OCR処理が進むと表示）</span>`;
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
  const sei = kind === "年号" ? waToSeireki(val) : null;
  const tail = sei ? `<span class="sei">${sei}</span>` : "";
  return `<button class="ent ${kind}" data-ent="${esc(val)}" data-kind="${k}">${esc(val)}${tail}</button>`;
}
function galleryCell(p) {
  const cap = p.labels && p.labels.length ? p.labels.slice(0, 3).join("・") : (p.summary || "").slice(0, 24);
  return `<figure class="gcell" data-media="${p.media_pkey}">
    <img loading="lazy" src="${p.thumb}" data-full="${p.image_full}" alt="第${p.order + 1}画像">
    <figcaption><span class="ptype ${DIAGRAM_TYPES.has(p.page_type) ? "diagram" : ""}">${esc(p.page_type || "")}</span> ${esc(cap)}</figcaption>
  </figure>`;
}
function wireImages(root) {
  const imgs = [...root.querySelectorAll("img[data-full]")];
  imgs.forEach((img, i) => img.addEventListener("click", () => {
    lbList = imgs.map((x) => ({ full: x.dataset.full, cap: x.alt || "" }));
    openLightbox(i);
  }));
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
// 和暦→西暦（主要元号の改元年=その元号の元年の西暦）。建立年代の手がかり用の概算。
const ERA_START = {
  延暦: 782, 大同: 806, 弘仁: 810, 天長: 824, 承和: 834, 嘉祥: 848, 仁寿: 851, 天安: 857,
  貞観: 859, 元慶: 877, 仁和: 885, 寛平: 889, 昌泰: 898, 延喜: 901, 延長: 923, 承平: 931,
  天慶: 938, 天暦: 947, 天徳: 957, 応和: 961, 康保: 964, 安和: 968, 天禄: 970, 天延: 973,
  貞元: 976, 天元: 978, 永観: 983, 寛和: 985, 永延: 987, 永祚: 989, 正暦: 990, 長徳: 995,
  長保: 999, 寛弘: 1004, 長和: 1013, 寛仁: 1017, 治安: 1021, 万寿: 1024, 長元: 1028,
  長久: 1040, 寛徳: 1044, 永承: 1046, 天喜: 1053, 康平: 1058, 治暦: 1065, 延久: 1069,
  承保: 1074, 承暦: 1077, 永保: 1081, 応徳: 1084, 寛治: 1087, 嘉保: 1095, 永長: 1097,
  承徳: 1097, 康和: 1099, 長治: 1104, 嘉承: 1106, 天仁: 1108, 天永: 1110, 永久: 1113,
  元永: 1118, 保安: 1120, 天治: 1124, 大治: 1126, 天承: 1131, 長承: 1132, 保延: 1135,
  永治: 1141, 康治: 1142, 天養: 1144, 久安: 1145, 仁平: 1151, 久寿: 1154, 保元: 1156,
  平治: 1159, 永暦: 1160, 応保: 1161, 長寛: 1163, 永万: 1165, 仁安: 1166, 嘉応: 1169,
  承安: 1171, 安元: 1175, 治承: 1177, 養和: 1181, 寿永: 1182, 元暦: 1184, 文治: 1185,
  建久: 1190, 正治: 1199, 建仁: 1201, 元久: 1204, 建永: 1206, 承元: 1207, 建暦: 1211,
  建保: 1213, 承久: 1219, 貞応: 1222, 元仁: 1224, 嘉禄: 1225, 安貞: 1227, 寛喜: 1229,
  貞永: 1232, 天福: 1233, 文暦: 1234, 嘉禎: 1235, 暦仁: 1238, 延応: 1239, 仁治: 1240,
  寛元: 1243, 宝治: 1247, 建長: 1249, 康元: 1256, 正嘉: 1257, 正元: 1259, 文応: 1260,
  弘長: 1261, 文永: 1264, 建治: 1275, 弘安: 1278, 正応: 1288, 永仁: 1293, 正安: 1299,
  乾元: 1302, 嘉元: 1303, 徳治: 1306, 延慶: 1308, 応長: 1311, 正和: 1312, 文保: 1317,
  元応: 1319, 元亨: 1321, 正中: 1324, 嘉暦: 1326, 元徳: 1329, 元弘: 1331, 建武: 1334,
  延元: 1336, 興国: 1340, 正平: 1347, 建徳: 1370, 文中: 1372, 天授: 1375, 弘和: 1381,
  元中: 1384, 暦応: 1338, 康永: 1342, 貞和: 1345, 観応: 1350, 文和: 1352, 延文: 1356,
  康安: 1361, 貞治: 1362, 応安: 1368, 永和: 1375, 康暦: 1379, 永徳: 1381, 至徳: 1384,
  嘉慶: 1387, 康応: 1389, 明徳: 1390, 応永: 1394, 正長: 1428, 永享: 1429, 嘉吉: 1441,
  文安: 1444, 宝徳: 1449, 享徳: 1452, 康正: 1455, 長禄: 1457, 寛正: 1460, 文正: 1466,
  応仁: 1467, 文明: 1469, 長享: 1487, 延徳: 1489, 明応: 1492, 文亀: 1501, 永正: 1504,
  大永: 1521, 享禄: 1528, 天文: 1532, 弘治: 1555, 永禄: 1558, 元亀: 1570, 天正: 1573,
  文禄: 1592, 慶長: 1596, 元和: 1615, 寛永: 1624, 正保: 1644, 慶安: 1648, 承応: 1652,
  明暦: 1655, 万治: 1658, 寛文: 1661, 延宝: 1673, 天和: 1681, 貞享: 1684, 元禄: 1688,
  宝永: 1704, 正徳: 1711, 享保: 1716, 元文: 1736, 寛保: 1741, 延享: 1744, 寛延: 1748,
  宝暦: 1751, 明和: 1764, 安永: 1772, 天明: 1781, 寛政: 1789, 享和: 1801, 文化: 1804,
  文政: 1818, 天保: 1830, 弘化: 1844, 嘉永: 1848, 安政: 1854, 万延: 1860, 文久: 1861,
  元治: 1864, 慶応: 1865, 明治: 1868,
};
const KNUM = { 元: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function kanjiYear(s) {
  if (/^\d+$/.test(s)) return +s;
  if (s === "元") return 1;
  let n = 0;
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    n = (a ? (KNUM[a] || 1) : 1) * 10 + (b ? (KNUM[b] || 0) : 0);
  } else { for (const c of s) n = n * 10 + (KNUM[c] || 0); }
  return n || null;
}
function waToSeireki(yango) {
  const m = (yango || "").match(/([一-龠]{2,4})\s*([元〇0-9一二三四五六七八九十]+)\s*年/);
  if (!m) return null;
  const start = ERA_START[m[1]];
  const yr = kanjiYear(m[2]);
  return (start && yr) ? start + yr - 1 : null;
}

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
function openLightbox(idx) {
  lbIdx = idx; showLb(); els.lightbox.classList.remove("hidden");
}
function showLb() {
  const item = lbList[lbIdx];
  if (!item) return;
  els.lbImg.src = item.full;
  els.lbCap.textContent = `${item.cap}　(${lbIdx + 1}/${lbList.length})`;
  const multi = lbList.length > 1;
  els.lbPrev.style.display = multi ? "" : "none";
  els.lbNext.style.display = multi ? "" : "none";
}
function lbStep(d) { if (!lbList.length) return; lbIdx = (lbIdx + d + lbList.length) % lbList.length; showLb(); }
function closeLightbox() { els.lightbox.classList.add("hidden"); els.lbImg.src = ""; }
function esc(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
