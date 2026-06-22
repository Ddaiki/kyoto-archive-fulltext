/* 京都古典籍 全文検索 — 書架＋年表（藍鉄ナイト）
   Claude Design のリファレンス実装を、実データ web/data.json に接続したもの。
   data.json（カタログ全2,716件＋華頂要略の構造化見開き）を ARCHIVE 形へ変換して描画する。 */
const $ = s => document.querySelector(s);
const Y0 = 1100, Y1 = 1900;
let A = null;
let state = { q: "", era: null, building: null, record: null, open: new Set() };
let navList = [], navIdx = -1;

/* ---- 和暦→西暦（建立年代・年表プロット用の概算） ---- */
const ERA_START = {
  延暦:782,大同:806,弘仁:810,天長:824,承和:834,嘉祥:848,仁寿:851,天安:857,貞観:859,元慶:877,仁和:885,寛平:889,昌泰:898,
  延喜:901,延長:923,承平:931,天慶:938,天暦:947,天徳:957,応和:961,康保:964,安和:968,天禄:970,天延:973,貞元:976,天元:978,
  永観:983,寛和:985,永延:987,永祚:989,正暦:990,長徳:995,長保:999,寛弘:1004,長和:1013,寛仁:1017,治安:1021,万寿:1024,
  長元:1028,長久:1040,寛徳:1044,永承:1046,天喜:1053,康平:1058,治暦:1065,延久:1069,承保:1074,承暦:1077,永保:1081,応徳:1084,
  寛治:1087,嘉保:1095,永長:1097,承徳:1097,康和:1099,長治:1104,嘉承:1106,天仁:1108,天永:1110,永久:1113,元永:1118,保安:1120,
  天治:1124,大治:1126,天承:1131,長承:1132,保延:1135,永治:1141,康治:1142,天養:1144,久安:1145,仁平:1151,久寿:1154,保元:1156,
  平治:1159,永暦:1160,応保:1161,長寛:1163,永万:1165,仁安:1166,嘉応:1169,承安:1171,安元:1175,治承:1177,養和:1181,寿永:1182,
  元暦:1184,文治:1185,建久:1190,正治:1199,建仁:1201,元久:1204,建永:1206,承元:1207,建暦:1211,建保:1213,承久:1219,貞応:1222,
  元仁:1224,嘉禄:1225,安貞:1227,寛喜:1229,貞永:1232,天福:1233,文暦:1234,嘉禎:1235,暦仁:1238,延応:1239,仁治:1240,寛元:1243,
  宝治:1247,建長:1249,康元:1256,正嘉:1257,正元:1259,文応:1260,弘長:1261,文永:1264,建治:1275,弘安:1278,正応:1288,永仁:1293,
  正安:1299,乾元:1302,嘉元:1303,徳治:1306,延慶:1308,応長:1311,正和:1312,文保:1317,元応:1319,元亨:1321,正中:1324,嘉暦:1326,
  元徳:1329,元弘:1331,建武:1334,延元:1336,興国:1340,正平:1347,建徳:1370,文中:1372,天授:1375,弘和:1381,元中:1384,暦応:1338,
  康永:1342,貞和:1345,観応:1350,文和:1352,延文:1356,康安:1361,貞治:1362,応安:1368,永和:1375,康暦:1379,永徳:1381,至徳:1384,
  嘉慶:1387,康応:1389,明徳:1390,応永:1394,正長:1428,永享:1429,嘉吉:1441,文安:1444,宝徳:1449,享徳:1452,康正:1455,長禄:1457,
  寛正:1460,文正:1466,応仁:1467,文明:1469,長享:1487,延徳:1489,明応:1492,文亀:1501,永正:1504,大永:1521,享禄:1528,天文:1532,
  弘治:1555,永禄:1558,元亀:1570,天正:1573,文禄:1592,慶長:1596,元和:1615,寛永:1624,正保:1644,慶安:1648,承応:1652,明暦:1655,
  万治:1658,寛文:1661,延宝:1673,天和:1681,貞享:1684,元禄:1688,宝永:1704,正徳:1711,享保:1716,元文:1736,寛保:1741,延享:1744,
  寛延:1748,宝暦:1751,明和:1764,安永:1772,天明:1781,寛政:1789,享和:1801,文化:1804,文政:1818,天保:1830,弘化:1844,嘉永:1848,
  安政:1854,万延:1860,文久:1861,元治:1864,慶応:1865,明治:1868,
};
const KNUM = { 元:1,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };
function kanjiYear(s) {
  if (/^\d+$/.test(s)) return +s;
  if (s === "元") return 1;
  let n = 0;
  if (s.includes("十")) { const [a, b] = s.split("十"); n = (a ? (KNUM[a] || 1) : 1) * 10 + (b ? (KNUM[b] || 0) : 0); }
  else { for (const c of s) n = n * 10 + (KNUM[c] || 0); }
  return n || null;
}
function waToSeireki(yango) {
  const m = (yango || "").match(/([一-龠]{2,4})\s*([元〇0-9一二三四五六七八九十]+)\s*年/);
  if (!m) return null;
  const st = ERA_START[m[1]], yr = kanjiYear(m[2]);
  return (st && yr) ? st + yr - 1 : null;
}
function parseYearStr(s) {
  if (!s) return null;
  const g = s.match(/(1[1-8]\d{2})/); if (g) return +g[1];   // 西暦
  return waToSeireki(s);                                      // 和暦
}

/* ============ データ変換: data.json → ARCHIVE ============ */
function buildArchive(D) {
  const recById = {};
  const records = D.records.map(r => {
    const s = parseYearStr(r.year);
    const rr = {
      id: r.pkey, title: r.title || "(無題)", yomi: r.yomi || "", kubun: r.category || "",
      author: r.author || "", ndc: r.classification || "", call: r.call_number || "",
      images: r.media_total || (r.pages ? r.pages.length : 0) || 0,
      year: { w: r.year || "", s }, blurb: r.blurb || "", _hasPages: !!(r.pages && r.pages.length),
    };
    recById[r.id = rr.id] = rr; return rr;
  });

  const pages = [];
  D.records.forEach(r => {
    if (!r.pages) return;
    r.pages.forEach(p => {
      if (!(p.text || (p.labels && p.labels.length))) return;
      const e = p.entities || {}, ents = [];
      (p.labels || []).forEach(t => ents.push({ t, kind: "注記" }));
      (e.建造物 || []).forEach(t => ents.push({ t, kind: "建造物" }));
      (e.地名 || []).forEach(t => ents.push({ t, kind: "地名" }));
      (e.人名 || []).forEach(t => ents.push({ t, kind: "人名" }));
      (e.年号 || []).forEach(t => ents.push({ t, kind: "年号" }));
      const y0 = (e.年号 || [])[0]; let py = null;
      if (y0) { const s = waToSeireki(y0); if (s) py = { w: y0, s }; }
      pages.push({
        id: p.media_pkey, pkey: p.media_pkey, thumb: p.thumb, large: p.image,
        glyph: (r.title || "頁")[0], record: r.pkey, ptype: p.page_type || "本文",
        conf: p.confidence != null ? Math.round(p.confidence * 100) : 0,
        src: p.source === "ndlkotenocr-lite" ? "NDL翻刻" : "AI構造化",
        sum: p.summary || (p.text || "").slice(0, 48), text: p.text || "", ents, year: py,
      });
    });
  });

  // 棚（テーマ別キュレーション）
  const ids = arr => arr.map(p => p.id);
  const has = (p, kw) => p.ents.some(e => (e.kind === "建造物" || e.kind === "注記") && e.t.includes(kw));
  const shelfDefs = [
    ["plans", "境内をめぐる — 寺院の指図", pages.filter(p => p.ptype === "平面図_指図")],
    ["gates", "門をたどる — 塀重門・唐門ほか", pages.filter(p => has(p, "門"))],
    ["ezu", "絵で見る — 絵図・口絵", pages.filter(p => ["絵図", "口絵"].includes(p.ptype))],
    ["kei", "系図と目録をたどる", pages.filter(p => ["系図", "目次", "序跋"].includes(p.ptype))],
    ["honbun", "本文を読む（AI構造化）", pages.filter(p => p.ptype === "本文" && p.src === "AI構造化")],
    ["ndl", "無料OCRで広げた頁（NDL翻刻）", pages.filter(p => p.src === "NDL翻刻")],
  ];
  const shelves = shelfDefs.filter(([, , ps]) => ps.length).map(([id, title, ps]) => ({ id, title, pageIds: ids(ps) }));

  // 建造物タグ（頻度上位）
  const bcount = {};
  pages.forEach(p => p.ents.forEach(e => { if (e.kind === "建造物" || e.kind === "注記") bcount[e.t] = (bcount[e.t] || 0) + 1; }));
  const buildings = Object.entries(bcount).filter(([t]) => t.length >= 2 && !t.includes("□"))
    .sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t]) => t);

  // 年表ドット（西暦が取れる資料）
  const years = records.filter(r => r.year.s && r.year.s >= Y0 && r.year.s <= Y1)
    .map(r => ({ id: r.id, title: r.title, s: r.year.s, w: r.year.w })).sort((a, b) => a.s - b.s);

  return {
    records, pages, shelves, years, buildings,
    facets: D.facets, source: D.source, source_url: D.source_url, catalog_total: D.catalog_total,
    rec: id => recById[id], pagesOf: rid => pages.filter(p => p.record === rid),
  };
}

/* ============ 以降は Claude Design リファレンス実装（実データ接続） ============ */
function ptColor(pt) {
  if (pt === "平面図_指図" || pt === "絵図") return "var(--diagram)";
  if (pt === "口絵") return "var(--accent2)";
  if (pt === "本文") return "var(--accent)";
  return "var(--ent)";
}
const yearOf = p => (p.year && p.year.s) || ((A.rec(p.record) || {}).year || {}).s;

const THEMES = [
  { id: "night", jp: "藍鉄ナイト", en: "INDIGO NIGHT", dots: ["#0e1422", "#46c8f5", "#34e0c4"] },
  { id: "neon", jp: "群青ネオン", en: "ULTRAMARINE NEON", dots: ["#0a163a", "#19d3ff", "#ff5dd0"] },
  { id: "jade", jp: "墨翠", en: "SUMI JADE", dots: ["#13161a", "#34d39f", "#e0b341"] },
  { id: "chrome", jp: "白磁クローム", en: "PORCELAIN CHROME", dots: ["#eef1f6", "#3b5bdb", "#0ca678"] },
  { id: "sepia", jp: "生成りセピア（原案）", en: "PAPER SEPIA", dots: ["#f4f1e8", "#8a5a2b", "#2f6f6a"] },
];
function renderPalette() {
  const cur = document.documentElement.dataset.theme;
  $("#palOpts").innerHTML = THEMES.map(t => `<button class="pal ${t.id === cur ? "on" : ""}" data-t="${t.id}">
    <span class="sw">${t.dots.map(c => `<i style="background:${c}"></i>`).join("")}</span>
    <span class="pal-name">${t.jp}<span class="pal-en">${t.en}</span></span><span class="chk">✓</span></button>`).join("");
  $("#palOpts").querySelectorAll(".pal").forEach(b => b.onclick = () => setTheme(b.dataset.t));
}
function setTheme(id) { document.documentElement.dataset.theme = id; try { localStorage.setItem("ktx-theme", id); } catch (e) {} renderPalette(); }
(function () { let t = "night"; try { t = localStorage.getItem("ktx-theme") || "night"; } catch (e) {} document.documentElement.dataset.theme = t; })();
$("#palMin").onclick = () => { $("#palette").style.display = "none"; $("#palOpen").style.display = "inline-flex"; };
$("#palOpen").onclick = () => { $("#palette").style.display = "block"; $("#palOpen").style.display = "none"; };

function buildTimeline() {
  const tl = $("#timeline");
  for (let c = 12; c <= 19; c++) {
    const yr = (c - 1) * 100, x = (yr + 50 - Y0) / (Y1 - Y0) * 100;
    const el = document.createElement("div"); el.className = "tl-cent"; el.style.left = x + "%";
    el.innerHTML = `<div class="tick"></div><div class="lab">${c}世紀</div>`;
    el.addEventListener("click", ev => { ev.stopPropagation(); const s = (c - 1) * 100, e = c * 100;
      state.era = (state.era && state.era[0] === s && state.era[1] === e) ? null : [s, e]; exitRecord(); sync(); });
    tl.appendChild(el);
  }
  A.years.forEach(y => {
    const x = (y.s - Y0) / (Y1 - Y0) * 100, rec = A.rec(y.id);
    const dot = document.createElement("div"); dot.className = "tl-dot " + (rec.kubun === "絵図・地図" ? "diff" : "");
    dot.style.left = x + "%"; dot.dataset.id = y.id;
    dot.addEventListener("click", ev => { ev.stopPropagation(); openRecord(y.id); });
    const flag = document.createElement("div"); flag.className = "tl-flag"; flag.style.left = x + "%";
    flag.textContent = `${y.title}・${y.s}`;
    tl.appendChild(dot); tl.appendChild(flag);
  });
  const px2year = cx => { const r = tl.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (cx - r.left) / r.width)); return Y0 + f * (Y1 - Y0); };
  const snap = y => Math.round(y / 10) * 10;
  let dragging = false, anchor = null, moved = false;
  tl.addEventListener("pointerdown", e => { if (e.target.closest(".tl-dot,.tl-cent")) return;
    dragging = true; moved = false; anchor = snap(px2year(e.clientX)); tl.setPointerCapture(e.pointerId); });
  tl.addEventListener("pointermove", e => { if (!dragging) return; moved = true;
    const cur = snap(px2year(e.clientX)); const s = Math.min(anchor, cur), en = Math.max(anchor, cur);
    if (en - s >= 10) { state.era = [s, en]; exitRecord(); sync(); } });
  tl.addEventListener("pointerup", e => { if (dragging && !moved) { state.era = null; exitRecord(); sync(); } dragging = false; });
  const chips = $("#tlchips");
  chips.innerHTML = `<button class="tlchip on" data-c="all">すべての年代</button>` +
    [12, 13, 14, 15, 16, 17, 18, 19].map(c => `<button class="tlchip" data-c="${c}">${c}世紀</button>`).join("");
  chips.querySelectorAll(".tlchip").forEach(b => b.onclick = () => {
    chips.querySelectorAll(".tlchip").forEach(x => x.classList.remove("on")); b.classList.add("on");
    state.era = b.dataset.c === "all" ? null : [(b.dataset.c - 1) * 100, b.dataset.c * 100]; exitRecord(); sync(); });
}
function sync() {
  const band = $("#tlband");
  if (state.era) { const [s, e] = state.era;
    band.style.left = (s - Y0) / (Y1 - Y0) * 100 + "%"; band.style.width = (e - s) / (Y1 - Y0) * 100 + "%"; band.style.display = "block";
    $("#tlclear").style.display = "inline"; $("#tlsub").textContent = `${s}–${e}年 を含む棚を表示`;
  } else { band.style.display = "none"; $("#tlclear").style.display = "none";
    $("#tlsub").textContent = "点をクリックで資料へ、世紀をクリック／帯をドラッグで年代を絞り込み"; }
  document.querySelectorAll(".tl-dot").forEach(d => { const y = (A.rec(d.dataset.id).year || {}).s;
    d.classList.toggle("on", state.era && y >= state.era[0] && y <= state.era[1]); });
  renderApplied(); renderShelves();
}
$("#tlclear").onclick = () => { state.era = null; document.querySelectorAll(".tlchip").forEach((x, i) => x.classList.toggle("on", i === 0)); sync(); };

function renderApplied() {
  const tags = [];
  if (state.era) tags.push(["era", `${state.era[0]}–${state.era[1]}年`]);
  if (state.building) tags.push(["building", `建造物: ${state.building}`]);
  if (state.q.trim()) tags.push(["q", `「${state.q.trim()}」`]);
  const host = $("#applied");
  host.innerHTML = (tags.length ? `<span class="al">絞り込み中:</span>` : "") +
    tags.map((t, i) => `<span class="atag" data-i="${i}">${t[1]}<span class="x">✕</span></span>`).join("");
  host.querySelectorAll(".atag").forEach((el, i) => el.onclick = () => { const k = tags[i][0];
    if (k === "q") { state.q = ""; $("#q").value = ""; } else if (k === "building") { state.building = null; }
    else if (k === "era") { state.era = null; document.querySelectorAll(".tlchip").forEach((x, j) => x.classList.toggle("on", j === 0)); }
    sync(); });
}

function pageMatch(p) {
  const q = state.q.trim();
  if (q && !(p.text.includes(q) || p.sum.includes(q) || p.ents.some(e => e.t.includes(q)) || (A.rec(p.record) || {}).title.includes(q))) return false;
  if (state.building && !(p.ents.some(e => e.t.includes(state.building)) || p.text.includes(state.building))) return false;
  if (state.era) { const y = yearOf(p); if (!(y >= state.era[0] && y <= state.era[1])) return false; }
  return true;
}
function card(p) {
  return `<figure class="bcard" data-id="${p.id}" tabindex="0">
    <div class="imgwrap" data-glyph="${esc(p.glyph)}"><img src="${p.thumb}" loading="lazy" alt="" onerror="this.classList.add('failed')"></div>
    <figcaption class="bc-body">
      <span class="bc-type" style="background:${ptColor(p.ptype)}">${esc(p.ptype)}</span>
      <div class="bc-sum">${esc(p.sum)}</div>
      <div class="bc-meta"><span>${esc((A.rec(p.record) || {}).title)}</span>${p.year ? `<span class="yr">${p.year.s}</span>` : ""}</div>
    </figcaption></figure>`;
}
function renderShelves() {
  if (state.record) return;
  const host = $("#shelves"); host.style.display = ""; $("#recview").classList.remove("show"); host.innerHTML = "";
  let anyHit = false;
  A.shelves.forEach(sh => {
    const pages = sh.pageIds.map(id => A.pages.find(p => p.id === id)).filter(Boolean).filter(pageMatch);
    if (pages.length) anyHit = true;
    const isOpen = state.open.has(sh.id);
    const div = document.createElement("section"); div.className = "shelf" + (pages.length === 0 ? " dim" : "") + (isOpen ? " open" : "");
    div.innerHTML = `<div class="shelf-h"><b>${esc(sh.title)}</b><span class="n">${pages.length} 点</span>
        ${pages.length > 3 ? `<button class="more" data-sh="${sh.id}">${isOpen ? "折りたたむ ▲" : "すべて見る ›"}</button>` : ""}</div>
      <div class="rail">${pages.map(card).join("") || `<div class="endcap" style="cursor:default">該当なし</div>`}
        ${pages.length && !isOpen ? `<div class="endcap" data-sh="${sh.id}">この棚を<br>すべて見る ›</div>` : ""}</div>`;
    host.appendChild(div);
  });
  host.querySelectorAll(".bcard").forEach(c => { c.onclick = () => openPageInShelves(c.dataset.id);
    c.onkeydown = e => { if (e.key === "Enter") openPageInShelves(c.dataset.id); }; });
  host.querySelectorAll("[data-sh]").forEach(b => b.onclick = () => { const id = b.dataset.sh;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id); renderShelves(); });
  if (!anyHit) { const e = document.createElement("div"); e.className = "empty";
    e.innerHTML = "該当する見開きがありません。絞り込みを解除してください。"; host.appendChild(e); }
}
function visiblePages() {
  const seen = new Set(), list = [];
  A.shelves.forEach(sh => sh.pageIds.forEach(id => { const p = A.pages.find(x => x.id === id);
    if (p && pageMatch(p) && !seen.has(id)) { seen.add(id); list.push(p); } }));
  return list;
}
function openPageInShelves(id) { navList = visiblePages(); navIdx = navList.findIndex(p => p.id === id); openModal(id); }

function openRecord(rid) {
  state.record = rid; $("#shelves").style.display = "none"; $("#applied").innerHTML = "";
  const rec = A.rec(rid), pages = A.pagesOf(rid);
  const imgLine = rec.images ? `　/　全${rec.images.toLocaleString()}画像` : "";
  const yLine = rec.year.s ? `　/　刊年 ${rec.year.w || ""}（${rec.year.s}）` : (rec.year.w ? `　/　刊年 ${rec.year.w}` : "");
  const rv = $("#recview"); rv.classList.add("show");
  rv.innerHTML = `<button class="rv-back" id="rvBack">‹ 書架へ戻る</button>
    <div class="rv-head">
      <div class="rv-cover imgwrap" data-glyph="${esc((pages[0] || {}).glyph || rec.title[0])}"><img src="${(pages[0] || {}).thumb || ""}" alt="" onerror="this.classList.add('failed')"></div>
      <div><span class="rv-badge" style="background:var(--accent)">${esc(rec.kubun)}</span>
        <h2>${esc(rec.title)}${rec.yomi ? `<span class="rv-yomi">${esc(rec.yomi)}</span>` : ""}</h2>
        <div class="rv-meta">${esc(rec.author)}${rec.ndc ? `　/　NDC ${esc(rec.ndc)}` : ""}${rec.call ? `　/　請求 ${esc(rec.call)}` : ""}${yLine}${imgLine}</div>
        ${rec.blurb ? `<p class="rv-blurb">${esc(rec.blurb)}</p>` : ""}
        <a class="dlink" href="${detailUrl(rid)}" target="_blank" rel="noopener">原資料を歴彩館で開く ↗</a></div>
    </div>
    ${pages.length ? `<div class="sect-h" style="padding:0 0 .4rem">構造化済みの見開き ${pages.length} 点</div>
      <div class="rv-grid">${pages.map(card).join("")}</div>`
      : `<div class="empty" style="text-align:left;padding:1rem 0">この資料はまだ翻刻していません（カタログ情報のみ）。本文は「原資料を歴彩館で開く」からご覧いただけます。</div>`}`;
  rv.querySelector("#rvBack").onclick = exitRecord;
  rv.querySelectorAll(".bcard").forEach(c => c.onclick = () => { navList = pages; navIdx = pages.findIndex(p => p.id === c.dataset.id); openModal(c.dataset.id); });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function exitRecord() { if (!state.record) return; state.record = null; $("#recview").classList.remove("show"); $("#shelves").style.display = ""; }

function detailHTML(p) {
  const rec = A.rec(p.record) || {};
  const ents = p.ents.map(e => { const sei = e.kind === "年号" ? waToSeireki(e.t) : null;
    return `<span class="ent ${e.kind}" data-t="${esc(e.t)}" data-k="${e.kind}">${esc(e.t)}${sei ? `<span class="sei">${sei}</span>` : ""}</span>`; }).join("");
  const ry = (rec.year || {}); const yr = p.year ? `<span>${esc(p.year.w)}・${p.year.s}</span>` : (ry.s ? `<span>${esc(ry.w)}・${ry.s}</span>` : "");
  const pos = navList.length ? `<span class="dpos">${navIdx + 1} / ${navList.length}</span>` : "";
  return `<button class="dclose" id="dclose">×</button>
    <div class="dimg"><div class="imgwrap" data-glyph="${esc(p.glyph)}"><img src="${p.large}" alt="" onerror="this.classList.add('failed')"></div>
      <div class="dnav"><button id="dprev" title="前（←）">‹</button><button id="dnext" title="次（→）">›</button></div>${pos}</div>
    <div class="dbody">
      <div class="dmeta"><span class="ptype" style="background:${ptColor(p.ptype)}">${esc(p.ptype)}</span>
        <span class="src">${esc(p.src)}</span>${yr}${p.conf ? `<span>確信度 ${p.conf}%</span>` : ""}</div>
      <h2 class="dtitle">${esc(p.sum.split("。")[0])}</h2>
      <p class="dsum">${esc(p.sum)}</p>
      ${ents ? `<div class="sect-h">注記・固有表現（クリックで絞り込み）</div><div class="ents">${ents}</div>` : ""}
      <div class="sect-h">翻刻テキスト</div><div class="dtext">${highlight(p.text)}</div>
      <div class="recline" id="dRec"><div><div class="rt serif">${esc(rec.title)}</div>
        <div class="rs">${esc(rec.kubun)}${rec.ndc ? `・NDC ${esc(rec.ndc)}` : ""}${rec.images ? `・全${rec.images.toLocaleString()}画像` : ""}</div></div>
        <span class="go">この資料を見る ›</span></div>
      <a class="dlink" href="${mediaUrl(p.record, p.pkey)}" target="_blank" rel="noopener">原資料を高精細で開く ↗</a></div>`;
}
function openModal(id) {
  const p = A.pages.find(x => x.id === id); if (!p) return;
  $("#dcard").innerHTML = detailHTML(p); $("#modal").classList.add("show");
  $("#dclose").onclick = closeModal;
  $("#dprev").onclick = () => step(-1); $("#dnext").onclick = () => step(1);
  $("#dRec").onclick = () => { closeModal(); openRecord(p.record); };
  $("#dcard").querySelectorAll(".ent").forEach(el => el.onclick = () => {
    const k = el.dataset.k; if (k === "建造物" || k === "地名" || k === "注記") {
      state.building = el.dataset.t; state.q = ""; $("#q").value = ""; closeModal(); exitRecord(); sync(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
}
function step(d) { if (!navList.length) return; navIdx = (navIdx + d + navList.length) % navList.length; openModal(navList[navIdx].id); }
function closeModal() { $("#modal").classList.remove("show"); }
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
document.addEventListener("keydown", e => {
  if ($("#modal").classList.contains("show")) { if (e.key === "Escape") closeModal(); if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); return; }
  if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
});

function buildSuggest(q) {
  q = q.trim(); const groups = [];
  if (q) groups.push({ h: "全文・翻刻を検索", items: [{ label: `本文に「${q}」を含む見開き`, tag: "全文", col: "var(--accent)", act: () => { state.q = q; state.building = null; } }] });
  const bld = A.buildings.filter(b => !q || b.includes(q)).slice(0, 6)
    .map(b => ({ label: b, tag: "建造物", col: "var(--diagram)", act: () => { state.building = b; state.q = ""; } }));
  const recs = A.records.filter(r => r.title && (!q || r.title.includes(q) || r.yomi.includes(q))).slice(0, 5)
    .map(r => ({ label: r.title, tag: r.kubun, col: "var(--accent2)", n: r.images ? `${r.images.toLocaleString()}画像` : "", act: () => { openRecord(r.id); return "record"; } }));
  const yrs = A.years.filter(y => !q || y.w.includes(q) || String(y.s).includes(q)).slice(0, 4)
    .map(y => ({ label: `${y.w}・${y.title}`, tag: String(y.s), col: "var(--ent)", act: () => { const s = Math.floor(y.s / 100) * 100; state.era = [s, s + 100]; } }));
  if (bld.length) groups.push({ h: "建造物", items: bld });
  if (recs.length) groups.push({ h: "資料", items: recs });
  if (yrs.length) groups.push({ h: "年代", items: yrs });
  return groups;
}
function renderSuggest(q) {
  const groups = buildSuggest(q), sug = $("#suggest");
  sug.innerHTML = groups.map(g => `<div class="sg-h">${esc(g.h)}</div>` + g.items.map(it =>
    `<div class="sg-i"><span class="tag" style="background:${it.col}">${esc(it.tag)}</span>${esc(it.label)}${it.n ? `<span class="n">${it.n}</span>` : ""}</div>`).join("")).join("");
  const flat = groups.flatMap(g => g.items);
  sug.querySelectorAll(".sg-i").forEach((el, i) => el.onclick = () => { const r = flat[i].act(); sug.classList.remove("show");
    $("#q").value = state.q; if (r !== "record") { exitRecord(); sync(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
  sug.classList.add("show");
}

function detailUrl(pkey) { return `https://www.archives.kyoto.jp/websearchpe/detail?cls=152_old_books_catalog&pkey=${pkey}`; }
function mediaUrl(rec, media) { return `https://www.archives.kyoto.jp/websearchpe/mediaDetail?cls=152_old_books_catalog&pkey=${rec}&lCls=150_media_old_books&lPkey=${media}&detaillnkIdx=1`; }
function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function highlight(text) { const q = state.q.trim(); let h = esc(text);
  if (q) h = h.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), m => `<mark>${m}</mark>`); return h; }

/* ============ 起動 ============ */
function wireSearch() {
  const qEl = $("#q"), sEl = $("#search");
  qEl.addEventListener("focus", () => renderSuggest(qEl.value));
  qEl.addEventListener("input", () => { state.q = qEl.value; renderSuggest(qEl.value); if (!state.record) sync(); });
  qEl.addEventListener("keydown", e => { if (e.key === "Enter") { state.q = qEl.value; state.building = null; exitRecord(); $("#suggest").classList.remove("show"); sync(); }
    if (e.key === "Escape") $("#suggest").classList.remove("show"); });
  document.addEventListener("click", e => { if (!sEl.contains(e.target)) $("#suggest").classList.remove("show"); });
}
function renderFooter() {
  $("#ftr").innerHTML = `出典: ©京都府立京都学・歴彩館 歴史資料アーカイブ（公開）。画像は提供元サーバを参照。
    翻刻は「AI構造化」＝Claude vision、「NDL翻刻」＝<a href="https://github.com/ndl-lab/ndlkotenocr-lite" target="_blank" rel="noopener">NDL古典籍OCR-Lite（CC BY 4.0）</a>（いずれも校正前）。`;
}
async function boot() {
  renderPalette(); wireSearch(); renderFooter();
  try {
    const D = await (await fetch("data.json")).json();
    A = buildArchive(D);
  } catch (e) {
    $("#shelves").innerHTML = `<div class="empty">データを読み込めませんでした。</div>`; return;
  }
  buildTimeline(); sync();
}
boot();
