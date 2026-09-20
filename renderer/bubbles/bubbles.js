import { toast } from '../core/log.js';
import { gState, tState } from '../core/state.js';

// =====================================================================
// «Хмаринки» Re:CoM. Розмір діалогового вікна гра бере з макета у .ctdl
// (0x30 байтів на репліку: X/Y/W/H у px PS2 на екрані 512×416) і НЕ підганяє
// під текст — довший український рядок вилазить за край. Тут для кожної
// репліки видно EN/UK, ширину тексту проти ширини хмаринки, пропозицію
// («Підібрати») і ручні X/Y/W/H (числа або drag у preview). Правки лежать у
// PROGRESS/_bubbles.json і застосовуються при «Зібрати ВСІ» / патчі.
// =====================================================================
const el = (id) => document.getElementById(id);
const t = (k, v) => (window.i18n ? window.i18n.t(k, v) : k);
const ui = {};
const CHUNK = 150;

export const bState = {
  files: [],              // [{ rel, items: [...] }] зі скану
  overrides: {},          // { rel: { id: {x,y,w,h} } }
  saved: '{}',            // JSON overrides на момент збереження (для dirty)
  filter: 'over',         // over | translated | changed | all | unused
  search: '',
  world: '',              // тека верхнього рівня (WORLD01…) або '' — усі
  sort: 'file',           // file | fit | size
  zoom: 0,                // 0 — авто (вписати у панель), інакше px екрана на 1 px PS2
  rows: [],               // плаский відфільтрований список { f, it }
  rendered: 0,
  sel: null,              // { f, it }
  unitPx: 2 / 3, minPad: 24, screen: { w: 512, h: 416 },
  fonts: {},              // name → { binlPath, pngPath, atlas, profile, widths, map, line }
  glyphCache: new Map(),  // text|font → lines
  busy: false
};

const keyOf = (f, it) => f.rel + '\u0001' + it.id;
const ovOf = (f, it) => (bState.overrides[f.rel] || {})[it.id] || null;
const geomOf = (f, it) => Object.assign({ x: it.x, y: it.y, w: it.w, h: it.h }, ovOf(f, it) || {});
const maxW = (ws) => (ws && ws.length ? Math.max(...ws) : 0);
// X, який реально використає гра: стиль 1 — X=32, 2 — по центру, 3 — X=480−W, 0 — з макета
const effectiveX = (style, x, w) => { const a = style & 0xFF; return a === 1 ? 32 : a === 2 ? 256 - (w >> 1) : a === 3 ? 480 - w : x; };
// запас хмаринки проти найдовшого рядка (px PS2) для поточної геометрії
function fitOf(f, it) {
  if (!it.ukW) return null;
  return geomOf(f, it).w - maxW(it.ukW) * bState.unitPx;
}
const isOver = (f, it) => { if (it.usable === false) return false; const v = fitOf(f, it); return v != null && v < bState.minPad; };
const isDirty = () => JSON.stringify(bState.overrides) !== bState.saved;

function setOverrideOne(f, it, g) {
  if (!bState.overrides[f.rel]) bState.overrides[f.rel] = {};
  if (g) bState.overrides[f.rel][it.id] = { x: g.x | 0, y: g.y | 0, w: g.w | 0, h: g.h | 0 };
  else delete bState.overrides[f.rel][it.id];
  if (!Object.keys(bState.overrides[f.rel]).length) delete bState.overrides[f.rel];
}
// Той самий діалог лежить копіями у кількох кімнатах (WORLD02/2000…2007/UK_CTag00.ctdl):
// у списку — один рядок, правка йде в усі копії.
function setOverride(f, it, g) {
  for (const tw of it.twins || [{ f, it }]) setOverrideOne(tw.f, tw.it, g);
}
function twinKey(f, it) {
  return f.rel.split('/').pop() + '\u0002' + it.id + '\u0002' + it.x + ',' + it.y + ',' + it.w + ',' + it.h + ',' + it.style + ',' + it.tail + '\u0002' + it.pages.map(pg => pg.en).join('\u0003');
}
function groupTwins() {
  const groups = new Map();
  for (const f of bState.files) for (const it of f.items) {
    const k = twinKey(f, it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ f, it });
  }
  for (const tw of groups.values()) for (const { it } of tw) { it.twins = tw; it.primary = tw[0].it === it; }
}

// ---- список ----
function rebuildRows() {
  const q = bState.search.trim().toLowerCase();
  const rows = [];
  for (const f of bState.files) {
    const relL = f.rel.toLowerCase();
    if (bState.world && worldOf(f.rel) !== bState.world) continue;
    for (const it of f.items) {
      if (it.primary === false) continue;                       // копії — в одному рядку
      if (bState.filter === 'over' && !isOver(f, it)) continue;
      if (bState.filter === 'translated' && !it.pages.some(pg => pg.uk)) continue;
      if (bState.filter === 'changed' && !ovOf(f, it)) continue;
      if (bState.filter === 'unused' && it.usable !== false) continue;
      if (bState.filter !== 'unused' && bState.filter !== 'all' && it.usable === false) continue;
      if (q && !(relL.includes(q) || it.pages.some(pg => pg.en.toLowerCase().includes(q) || (pg.uk && pg.uk.toLowerCase().includes(q))))) continue;
      rows.push({ f, it });
    }
  }
  if (bState.sort === 'fit') rows.sort((a, b) => { const fa = fitOf(a.f, a.it), fb = fitOf(b.f, b.it); return (fa == null ? 1e9 : fa) - (fb == null ? 1e9 : fb); });
  else if (bState.sort === 'size') rows.sort((a, b) => (b.it.w * b.it.h) - (a.it.w * a.it.h));
  bState.rows = rows;
  bState.rendered = 0;
  ui.list.innerHTML = '';
  if (ui.count) ui.count.textContent = bState.files.length ? '(' + rows.length + ')' : '';
  if (!rows.length) { ui.list.innerHTML = '<div class="t-empty"><p>' + t(bState.files.length ? 'bbNoRows' : 'bbEmpty') + '</p></div>'; }
  else appendChunk();
  refreshStatus();
}
// іконки типів вікон — з єдиного SVG-набору в index.html (без emoji)
const TYPE_ICON = { bubble: 'i-bubble', shout: 'i-burst', system: 'i-box', frame: 'i-box', plain: 'i-text', none: 'i-text' };
function typeIconHtml(it) {
  const warn = it.usable === false;
  const id = warn ? 'i-warn' : (TYPE_ICON[wndTypeOf(it.style)] || 'i-text');
  return '<svg class="ico bb-type' + (warn ? ' warn' : '') + '" aria-hidden="true"><title>' + esc(warn ? t('bbUnusedTitle') : t('bbType_' + wndTypeOf(it.style))) + '</title><use href="#' + id + '"/></svg>';
}
// запас у px: зелений — влазить із запасом, жовтий — впритул, червоний — не влазить
function badgeHtml(fit) {
  if (fit == null) return '';
  const cls = fit < 0 ? 'neg' : (fit < bState.minPad ? 'warn' : 'pos');
  return '<span class="bb-badge ' + cls + '" title="' + esc(t('bbFitTitle')) + '">' + (fit >= 0 ? '+' : '') + Math.round(fit) + '</span>';
}
function linesOf(it) { const ws = it.ukW || it.enW; return ws && ws.length ? ws.length : (it.uk || it.en || '').split('\n').length; }
function linesText(n) {
  const m10 = n % 10, m100 = n % 100;
  const k = (m10 === 1 && m100 !== 11) ? 'bbLines1' : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) ? 'bbLines2' : 'bbLines5';
  return t(k, { n });
}
function worldOf(rel) { return shortRel(rel).split('/')[0]; }
function rowEl(r, idx) {
  const { f, it } = r;
  const d = document.createElement('div');
  d.className = 'bb-row' + (isOver(f, it) ? ' over' : '') + (ovOf(f, it) ? ' changed' : '') + (bState.sel && bState.sel.it === it ? ' active' : '');
  d.dataset.key = keyOf(f, it);
  const g = geomOf(f, it);
  const fit = fitOf(f, it);
  const need = it.ukW ? Math.ceil(maxW(it.ukW) * bState.unitPx) : null;
  d.innerHTML =
    '<div class="bb-idx">' + String((idx == null ? bState.rows.indexOf(r) : idx) + 1).padStart(2, '0') + '</div>' +
    '<div class="bb-main"><div class="bb-row-head">' + typeIconHtml(it) +
    '<span class="bb-file" title="' + esc(f.rel) + '">' + esc(shortRel(f.rel)) + '</span><span class="bb-id">#' + it.id + '</span>' +
    (it.twins && it.twins.length > 1 ? '<span class="bb-twins" title="' + esc(it.twins.map(tw => tw.f.rel).join('\n')) + '">×' + it.twins.length + '</span>' : '') +
    '<span class="bb-meta"><span class="bb-geom" title="' + esc(t('bbGeomTitle')) + '">' + g.w + '×' + g.h + '</span>' +
    (need != null ? '<span class="bb-need">' + t('bbNeed') + ' ' + need + '</span>' : '') +
    '<span class="bb-lines">' + esc(linesText(linesOf(it))) + '</span>' + badgeHtml(fit) + '</span>' +
    '<button class="bb-more kh-btn kh-btn-icon kh-btn-ghost" type="button" title="' + esc(t('bbRowMenu')) + '" aria-label="Menu"><svg class="ico" aria-hidden="true"><use href="#i-more"/></svg></button>' +
    '</div>' +
    it.pages.map((pg, pi) => '<div class="bb-page' + (bState.sel && bState.sel.it === it && bState.sel.page === pi ? ' active' : '') + '" data-page="' + pi + '"><div class="bb-en">' + esc(pg.en) + '</div>' +
      (pg.uk ? '<div class="bb-uk">' + esc(pg.uk) + '</div>' : '<div class="bb-uk dim">' + t('bbNoUk') + '</div>') + '</div>').join('') +
    '</div>';
  d.addEventListener('click', (e) => {
    const moreBtn = e.target.closest('.bb-more');
    if (moreBtn) { e.stopPropagation(); select(Object.assign({}, r, { page: bState.sel && bState.sel.it === it ? bState.sel.page : null })); openRowMenu(moreBtn, r); return; }
    const pgEl = e.target.closest('.bb-page');
    const page = pgEl ? parseInt(pgEl.dataset.page, 10) : null;
    d.querySelectorAll('.bb-page.active').forEach(x => x.classList.remove('active'));
    if (pgEl) pgEl.classList.add('active');
    select(Object.assign({}, r, { page: it.pages.length > 1 ? page : null }));
  });
  return d;
}
function appendChunk() {
  const frag = document.createDocumentFragment();
  const end = Math.min(bState.rows.length, bState.rendered + CHUNK);
  for (let i = bState.rendered; i < end; i++) frag.appendChild(rowEl(bState.rows[i], i));
  bState.rendered = end;
  const more = ui.list.querySelector('.t-more'); if (more) more.remove();
  ui.list.appendChild(frag);
  if (bState.rendered < bState.rows.length) {
    const m = document.createElement('div'); m.className = 't-more'; m.textContent = t('gMoreRows', { n: bState.rows.length - bState.rendered });
    ui.list.appendChild(m);
  }
}
function refreshRow(r) {
  const old = ui.list.querySelector('[data-key="' + CSS.escape(keyOf(r.f, r.it)) + '"]');
  if (old) old.replaceWith(rowEl(r));
}
function shortRel(rel) { return rel.replace(/^remastered\//, '').replace(/\/[^/]+\.CTD\//, '/'); }

// меню «⋮» у рядку: ті самі дії, що й в inspector'і, без прокрутки до нього
let rowMenu = null;
function closeRowMenu() {
  if (!rowMenu) return;
  const btn = rowMenu._btn; if (btn) btn.classList.remove('open');
  rowMenu.remove(); rowMenu = null;
}
function openRowMenu(btn, r) {
  if (rowMenu && rowMenu._btn === btn) { closeRowMenu(); return; }
  closeRowMenu();
  const m = document.createElement('div');
  m.className = 'kh-menu bb-row-menu'; m.setAttribute('role', 'menu');
  const items = [
    { icon: 'i-fit', label: t('bbFitOne'), on: !!r.it.sug, fn: () => commitGeom(r, r.it.sug) },
    { icon: 'i-reset', label: t('bbResetOne'), on: !!ovOf(r.f, r.it), fn: () => commitGeom(r, { x: r.it.x, y: r.it.y, w: r.it.w, h: r.it.h }) },
    { icon: 'i-copy', label: t('bbCopyPath'), on: true, fn: () => copyText(r.f.rel + ' #' + r.it.id) }
  ];
  for (const item of items) {
    const b = document.createElement('button');
    b.className = 'kh-menu-item'; b.type = 'button'; b.disabled = !item.on;
    b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#' + item.icon + '"/></svg><span>' + esc(item.label) + '</span>';
    b.addEventListener('click', () => { closeRowMenu(); item.fn(); });
    m.appendChild(b);
  }
  const rect = btn.getBoundingClientRect();
  m.style.top = Math.round(rect.bottom + 4) + 'px';
  m.style.right = Math.round(window.innerWidth - rect.right) + 'px';
  m._btn = btn; btn.classList.add('open');
  document.body.appendChild(m); rowMenu = m;
}
document.addEventListener('mousedown', (e) => { if (rowMenu && !rowMenu.contains(e.target) && !(rowMenu._btn && rowMenu._btn.contains(e.target))) closeRowMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRowMenu(); });
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t('bbCopied'), 'success', 2000); }
  catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function refreshStatus() {
  let total = 0, over = 0, changed = 0, translated = 0;
  for (const f of bState.files) for (const it of f.items) { if (it.primary === false) continue; total++; if (it.uk) translated++; if (isOver(f, it)) over++; if (ovOf(f, it)) changed++; }
  const dirty = isDirty();
  ui.status.textContent = bState.files.length ? t('bbStatus', { files: bState.files.length, total, translated, over, changed }) : '';
  if (ui.state) ui.state.textContent = t(bState.busy ? 'bbStateScanning' : !bState.files.length ? 'bbStateIdle' : dirty ? 'bbStateDirty' : 'bbStateReady');
  if (ui.dot) ui.dot.className = 'bb-status-dot ' + (bState.busy ? 'busy' : !bState.files.length ? 'idle' : dirty ? 'dirty' : 'ok');
  ui.info.textContent = bState.files.length ? t('bbShown', { n: bState.rows.length }) : '';
  ui.save.disabled = !isDirty();
  ui.fitAll.disabled = !bState.files.length;
  ui.resetAll.disabled = !Object.keys(bState.overrides).length;
}

// ---- вибір + інспектор ----
function select(r) {
  const prev = ui.list.querySelector('.bb-row.active'); if (prev) prev.classList.remove('active');
  if (bState.sel && bState.sel.it !== r.it) ui.list.querySelectorAll('.bb-page.active').forEach(x => x.classList.remove('active'));
  bState.sel = r;
  const cur = ui.list.querySelector('[data-key="' + CSS.escape(keyOf(r.f, r.it)) + '"]'); if (cur) cur.classList.add('active');
  fillInspector();
  schedulePreview();
}
function fillInspector() {
  const r = bState.sel;
  const on = !!r;
  for (const k of ['x', 'y', 'w', 'h']) ui[k].disabled = !on;
  ui.fitOne.disabled = !on || !(r && r.it.sug);
  ui.resetOne.disabled = !on || !(r && ovOf(r.f, r.it));
  if (ui.copyEn) ui.copyEn.disabled = !on;
  if (ui.copyUk) ui.copyUk.disabled = !on;
  if (!on) { ui.selInfo.innerHTML = chip(t('bbSelectHint'), 'dim'); ui.enText.textContent = ''; ui.ukText.textContent = ''; return; }
  const g = geomOf(r.f, r.it);
  for (const k of ['x', 'y', 'w', 'h']) ui[k].value = g[k];
  const it = r.it;
  const type = wndTypeOf(it.style), align = it.style & 0xFF;
  const chips = [];
  if (it.usable === false) chips.push(chip(t('bbUnusedShort'), 'warn', t('bbUnusedTitle'), 'i-warn'));
  chips.push(chip(shortRel(r.f.rel) + ' #' + it.id + (it.count > 1 ? '–' + (it.id + it.count - 1) : ''), 'mono', r.f.rel));
  if (it.twins && it.twins.length > 1) chips.push(chip('×' + it.twins.length, 'gold', t('bbTwins', { n: it.twins.length }) + '\n' + it.twins.map(tw => tw.f.rel).join('\n')));
  chips.push(chip(t('bbType_' + type) + (align ? ' · ' + t('bbAlign' + align) : ''), '', '', it.usable === false ? '' : (TYPE_ICON[type] || 'i-text')));
  chips.push(chip(t('bbTail') + ' ' + tailText(it)));
  chips.push(chip(t('bbOrig') + ' ' + it.x + ',' + it.y + ' · ' + it.w + '×' + it.h, ovOf(r.f, it) ? 'gold' : ''));
  chips.push(chip(t('bbLine') + ' ' + it.lh));
  if (it.sug) chips.push(chip(t('bbSuggest') + ' ' + it.sug.w + '×' + it.sug.h, 'gold', t('bbFitOneTitle'), 'i-fit'));
  ui.selInfo.innerHTML = chips.join('');
  ui.x.disabled = !!align;
  ui.enText.textContent = it.pages.map(pg => pg.en).join('\n⸻\n');
  ui.ukText.textContent = it.pages.map(pg => pg.uk || t('bbNoUk')).join('\n⸻\n');
}
function chip(text, cls, title, icon) {
  return '<span class="bb-chip' + (cls ? ' ' + cls : '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' +
    (icon ? '<svg class="ico" aria-hidden="true"><use href="#' + icon + '"/></svg>' : '') + esc(text) + '</span>';
}
function tailText(it) {
  if (!it.tail) return t('bbTailAuto');
  const ti = tailInfo(it.tail);
  return t(ti.edge === 'bottom' ? 'bbTailBottom' : 'bbTailTop') + (ti.dir < 0 ? '←' : '→') + (ti.look === 'dots' ? ' ○○' : (ti.look === 'spike' ? ' ⚡' : '')) + (it.tailOff ? ' ' + (it.tailOff > 0 ? '+' : '') + it.tailOff : '');
}
function applyInputs() {
  const r = bState.sel; if (!r) return;
  const g = {};
  for (const k of ['x', 'y', 'w', 'h']) { const v = parseInt(ui[k].value, 10); g[k] = Number.isFinite(v) ? Math.max(0, Math.min(k === 'x' || k === 'w' ? bState.screen.w : bState.screen.h, v)) : r.it[k]; }
  commitGeom(r, g);
}
function commitGeom(r, g) {
  const same = g.x === r.it.x && g.y === r.it.y && g.w === r.it.w && g.h === r.it.h;
  setOverride(r.f, r.it, same ? null : g);
  refreshRow(r); fillInspector(); refreshStatus(); schedulePreview();
}
function fitOne() {
  const r = bState.sel; if (!r || !r.it.sug) return;
  commitGeom(r, r.it.sug);
}
function resetOne() {
  const r = bState.sel; if (!r) return;
  commitGeom(r, { x: r.it.x, y: r.it.y, w: r.it.w, h: r.it.h });
}
function fitAll() {
  let n = 0;
  for (const f of bState.files) for (const it of f.items) {
    if (it.primary === false || !it.sug || !isOver(f, it)) continue;
    setOverride(f, it, it.sug); n++;
  }
  rebuildRows(); fillInspector(); schedulePreview();
  toast(t('toastBbFitAll', { n }), 'success', 5000);
}
function resetAll() {
  if (!window.confirm(t('bbResetAllConfirm'))) return;
  bState.overrides = {};
  rebuildRows(); fillInspector(); schedulePreview();
}

// ---- preview: екран PS2 512×416, хмаринка + текст з атласу ----
const PROFILES = { sysfont: { cell: 40, cols: 25, rows: 25 }, evtfont: { cell: 52, cols: 19, rows: 39 } };
function fontNameFor(lh) { return (lh === 18 || lh === 15 || lh === 16) ? 'sysfont' : 'evtfont'; }
async function ensureFont(name) {
  const f = bState.fonts[name];
  if (!f || f.atlas || f.loading || !f.pngPath) return f;
  f.loading = true;
  try {
    const r = await window.kh1.comkern.load({ binlPath: f.binlPath, pngPath: f.pngPath });
    if (r && r.ok) {
      f.widths = r.widths; f.map = r.map; f.line = r.line; f.count = r.count; f.profile = r.profile || PROFILES[name];
      if (r.pngDataUrl) {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = r.pngDataUrl; });
        f.atlas = img;
      }
    }
  } catch (_) {}
  f.loading = false;
  return f;
}
async function glyphsFor(text, name) {
  const k = name + '\u0001' + text;
  if (bState.glyphCache.has(k)) return bState.glyphCache.get(k);
  const r = await window.kh1.bubbles.glyphs({ text, font: name });
  const lines = r && r.ok ? r.lines : null;
  if (r && r.ok && bState.fonts[name]) bState.fonts[name].space = r.space;
  bState.glyphCache.set(k, lines);
  return lines;
}
function boxOf(prof, i) {
  const per = prof.cols * prof.rows;
  const blk = Math.floor(i / per), j = i % per;
  return { x: blk * 1024 + (j % prof.cols) * prof.cell, y: Math.floor(j / prof.cols) * prof.cell };
}

// watermark серця — той самий path, що й у #i-heart (viewBox 454×495)
let heartPath = null;
function drawBackdrop(ctx, cv, S) {
  const grad = ctx.createLinearGradient(0, 0, 0, cv.height);
  grad.addColorStop(0, '#0e1a2d'); grad.addColorStop(1, '#0a1526');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, cv.width, cv.height);
  // зорі — детерміновані, щоб не мерехтіли при перемальовуванні
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  for (let i = 0; i < 40; i++) { const a = (i * 9301 + 49297) % 233280 / 233280, b = (i * 49297 + 9301) % 233280 / 233280; ctx.fillRect(Math.round(a * cv.width), Math.round(b * cv.height), 1, 1); }
  if (!heartPath) { const el = document.querySelector('#i-heart path'); if (el) heartPath = new Path2D(el.getAttribute('d')); }
  if (heartPath) {
    const k = (cv.height * 0.62) / 495;
    ctx.save(); ctx.translate((cv.width - 454 * k) / 2, (cv.height - 495 * k) / 2); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(211,173,82,0.045)'; ctx.fill(heartPath); ctx.restore();
  }
  // сітка 32/64 px PS2 — ледь помітна
  for (let gx = 32; gx < bState.screen.w; gx += 32) { ctx.strokeStyle = gx % 64 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(Math.round(gx * S) + 0.5, 0); ctx.lineTo(Math.round(gx * S) + 0.5, cv.height); ctx.stroke(); }
  for (let gy = 32; gy < bState.screen.h; gy += 32) { ctx.strokeStyle = gy % 64 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(0, Math.round(gy * S) + 0.5); ctx.lineTo(cv.width, Math.round(gy * S) + 0.5); ctx.stroke(); }
}
function drawSelection(ctx, cv, g, S) {
  // напрямні через центр хмаринки + рамка виділення з чотирма кутами (усі тягнуться)
  const cx = Math.round((g.x + g.w / 2) * S) + 0.5, cy = Math.round((g.y + g.h / 2) * S) + 0.5;
  ctx.save();
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(211,173,82,0.28)';
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, cv.height); ctx.moveTo(0, cy); ctx.lineTo(cv.width, cy); ctx.stroke();
  ctx.setLineDash([]);
  const pad = 4;
  const x0 = Math.round(g.x * S) - pad + 0.5, y0 = Math.round(g.y * S) - pad + 0.5, x1 = Math.round((g.x + g.w) * S) + pad + 0.5, y1 = Math.round((g.y + g.h) * S) + pad + 0.5;
  ctx.strokeStyle = 'rgba(211,173,82,0.85)'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  for (const [hx, hy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    ctx.fillStyle = '#d3ad52'; ctx.fillRect(hx - 3.5, hy - 3.5, 7, 7);
    ctx.strokeStyle = 'rgba(7,16,28,0.9)'; ctx.strokeRect(hx - 3.5, hy - 3.5, 7, 7);
  }
  ctx.restore();
}
const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];
function autoScale() {
  const wrap = ui.canvas.parentElement;
  return Math.min(Math.max(120, wrap.clientWidth - 20) / bState.screen.w, Math.max(120, wrap.clientHeight - 20) / bState.screen.h, 2);
}
function setZoom(z) { bState.zoom = z; ui.canvas.parentElement.classList.toggle('zoomed', !!z); renderPreview().catch(() => {}); }
function zoomStep(dir) {
  const cur = bState.zoom || autoScale();
  if (dir > 0) { const z = ZOOMS.find(v => v > cur + 0.01); setZoom(z || cur); }
  else { const z = [...ZOOMS].reverse().find(v => v < cur - 0.01); setZoom(z || 0); }
}

let previewTimer = null;
function schedulePreview() { if (previewTimer) clearTimeout(previewTimer); previewTimer = setTimeout(() => { renderPreview().catch(() => {}); }, 60); }
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}

// ---- види вікон (з exe: CWnd бере спрайт "CFIOL"[тип], тип = (style >> 8) & 0xf) ----
//   0 'C' — хмаринка репліки; 2 'I' — вигук (зубчаста); 3 'O' — системне вікно
//   (підказки/меню); 5+ — без рамки (лише текст). Хвостик (@0x2C): 0 — гра сама
//   веде його до мовця; 1/2 — знизу вліво/вправо, 3/4 — зверху вліво/вправо,
//   5–8 — те саме для «думки» (кружечки), 9–12 — для вигуку; @0x2E — зсув від центру.
export const WND_TYPES = { 0: 'bubble', 1: 'frame', 2: 'shout', 3: 'system', 4: 'plain' };
export function wndTypeOf(style) { const t = (style >> 8) & 0xF; return WND_TYPES[t] || 'none'; }
export function tailInfo(kind) {
  if (!kind) return { auto: true, edge: 'bottom', dir: 0, look: 'tail' };
  const k = (kind - 1) & 3;
  return { auto: false, edge: k < 2 ? 'bottom' : 'top', dir: (k & 1) ? 1 : -1, look: kind >= 9 ? 'spike' : (kind >= 5 ? 'dots' : 'tail') };
}
const tint = (u32) => (u32 == null ? [255, 255, 255] : [u32 & 0xFF, (u32 >> 8) & 0xFF, (u32 >> 16) & 0xFF]);
const mulRgb = (rgb, tc) => 'rgb(' + rgb.map((v, i) => Math.round(v * tc[i] / 255)).join(',') + ')';
function spikyPath(ctx, x, y, w, h, S) {
  const n = Math.max(8, Math.round((w + h) / 18));
  const cx = x + w / 2, cy = y + h / 2;
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 1 : 0.82;
    const px = cx + Math.cos(a) * (w / 2) * r * 1.08, py = cy + Math.sin(a) * (h / 2) * r * 1.15;
    if (i === 0) ctx.moveTo(px * S, py * S); else ctx.lineTo(px * S, py * S);
  }
  ctx.closePath();
}
function drawTail(ctx, it, g, S, fillStyle, strokeStyle) {
  const ti = tailInfo(it.tail);
  const half = g.w / 2 - 14;
  const off = Math.max(-half, Math.min(half, ti.auto ? 0 : it.tailOff));
  const bx = g.x + g.w / 2 + off;
  const dir = ti.auto ? -1 : ti.dir;
  const edgeY = ti.edge === 'bottom' ? g.y + g.h : g.y;
  const dy = ti.edge === 'bottom' ? 1 : -1;
  ctx.save();
  if (ti.auto) ctx.setLineDash([3, 2]);
  ctx.fillStyle = fillStyle; ctx.strokeStyle = strokeStyle; ctx.lineWidth = Math.max(1, 1.5 * S);
  if (ti.look === 'dots') {
    for (let i = 0; i < 3; i++) {
      const rr = (5 - i * 1.3), cx = bx + dir * (6 + i * 9), cy = edgeY + dy * (6 + i * 8);
      ctx.beginPath(); ctx.arc(cx * S, cy * S, rr * S, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  } else {
    const len = ti.look === 'spike' ? 30 : 22, base = ti.look === 'spike' ? 10 : 18;
    ctx.beginPath();
    ctx.moveTo((bx - base / 2) * S, (edgeY - dy) * S);
    ctx.lineTo((bx + base / 2) * S, (edgeY - dy) * S);
    ctx.lineTo((bx + dir * len * 0.7) * S, (edgeY + dy * len) * S);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // прибираємо шов між хвостиком і рамкою
    ctx.beginPath(); ctx.moveTo((bx - base / 2 + 1) * S, (edgeY - dy) * S); ctx.lineTo((bx + base / 2 - 1) * S, (edgeY - dy) * S); ctx.strokeStyle = fillStyle; ctx.stroke();
  }
  ctx.restore();
}
// ---- спрайти вікон із гри (UK_message.imd, 256×256, 1 px = 1 px PS2) ----
// Шматки атласу (координати з декодованого IMGD):
//   pill   — капсула хмаринки (9-slice), burst — вигук, tails — хвостики:
//   curve* — звичайна хмаринка (curve-bottom: смужка зверху + хвіст вниз-вправо),
//   straight* — вигук, think* — «думка» (кружечки). Ліві варіанти — дзеркало.
const ATLAS_SD = {
  k: 1, tinted: true,
  pill: { x: 1, y: 0, w: 30, h: 48, corner: 12 },
  burst: { x: 82, y: 3, w: 47, h: 46 },
  tails: {
    tail: { bottom: { x: 193, y: 133, w: 31, h: 41, strip: 8 }, top: { x: 193, y: 174, w: 31, h: 41, strip: 8 } },
    spike: { bottom: { x: 160, y: 133, w: 29, h: 41, strip: 8 }, top: { x: 160, y: 174, w: 29, h: 41, strip: 8 } },
    dots: { bottom: { x: 131, y: 133, w: 29, h: 41, strip: 8 }, top: { x: 131, y: 174, w: 29, h: 41, strip: 8 } }
  }
};
// HD-атлас світу (remastered/WORLD/<код>/WO<код>.RTM/message.imd, 512×512):
// 2 px на 1 px PS2, колір і фаска (блік зверху, лавандова тінь знизу-справа)
// вже в текстурі — малюємо як є, без відтінку і без домальованої рамки.
// Це саме те, що видно у грі (звірено зі скриншотом Traverse Town).
const ATLAS_HD = {
  k: 2, tinted: false,
  pill: { x: 22, y: 18, w: 60, h: 92, corner: 24 },
  burst: { x: 207, y: 5, w: 123, h: 118 },
  tails: {
    tail: { bottom: { x: 350, y: 258, w: 50, h: 81, strip: 16 }, top: { x: 350, y: 344, w: 50, h: 83, strip: 16 } },
    spike: { bottom: { x: 280, y: 258, w: 70, h: 81, strip: 16 }, top: { x: 280, y: 344, w: 70, h: 83, strip: 16 } },
    dots: { bottom: { x: 212, y: 258, w: 62, h: 81, strip: 16 }, top: { x: 212, y: 344, w: 62, h: 83, strip: 16 } }
  }
};
let atlasImg = null, ATLAS = ATLAS_SD, atlasTextDark = true, atlasId = '';
const atlasByWorld = new Map();   // код світу → { img, hd, dark } | null
// WORLDnn/… → 01nn (Сора); FORM/SYS/GIMMICK/WORLD00 → 0100 (нейтральна капсула)
function worldCodeOf(rel) { const m = /(?:^|\/)WORLD(\d\d)\//.exec(rel); return m && m[1] !== '00' ? '01' + m[1] : '0100'; }
async function ensureAtlas(rel) {
  const code = worldCodeOf(rel || '');
  let a = atlasByWorld.get(code);
  if (a === undefined) {
    a = null;
    try {
      const r = await window.kh1.bubbles.atlas({ world: code });
      if (r && r.ok) {
        const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = r.dataUrl; });
        a = { img, hd: !!r.hd, dark: false };
        if (a.hd) {
          // текст у грі темно-коричневий (77,33,0) на світлій капсулі; на темній (Hollow Bastion) — світлий
          const c = document.createElement('canvas'); c.width = c.height = 1;
          const x = c.getContext('2d', { willReadFrequently: true });
          const pc = ATLAS_HD.pill; x.drawImage(img, pc.x + pc.w / 2, pc.y + pc.h / 2, 1, 1, 0, 0, 1, 1);
          const d = x.getImageData(0, 0, 1, 1).data; a.dark = (d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11) < 110;
        }
      } else if (!atlasByWorld.size) toast(t('toastError', { msg: (r && r.error) || 'atlas' }), 'warn', 6000);
    } catch (_) {}
    atlasByWorld.set(code, a);
  }
  atlasImg = a ? a.img : null;
  ATLAS = a && a.hd ? ATLAS_HD : ATLAS_SD;
  atlasTextDark = !(a && a.dark);
  atlasId = a ? (a.hd ? code : 'sd') : '';
  return atlasImg;
}
// Відтінок макета (c0) на спрайт — як PS2-модуляція ×2: tex · c/128 (c0 =
// ff f0 e0 робить помаранчевий атлас кремово-жовтим, як у грі; у Колізеї
// df a0 70 — помаранчевішим). mode 'silhouette' — суцільна заливка кольором
// за альфою (лавандова рамка позаду капсули/хвостика).
const spriteCache = new Map();
function tintedSprite(sx, sy, sw, sh, tc, flipX, mode) {
  const key = [atlasId, sx, sy, sw, sh, tc ? tc.join(',') : '', flipX ? 1 : 0, mode || ''].join('|');
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const x = c.getContext('2d', { willReadFrequently: true });
  if (flipX) { x.translate(sw, 0); x.scale(-1, 1); }
  x.drawImage(atlasImg, sx, sy, sw, sh, 0, 0, sw, sh);
  x.setTransform(1, 0, 0, 1, 0, 0);
  const id = x.getImageData(0, 0, sw, sh); const d = id.data;
  if (mode === 'silhouette') {
    for (let i = 0; i < d.length; i += 4) { d[i] = tc[0]; d[i + 1] = tc[1]; d[i + 2] = tc[2]; }
  } else if (tc) {
    // базові множники підібрані під скриншоти гри (центр капсули 255,187,114 → ≈255,238,175 при c0 = ff f0 e0)
    const f = [1.0 * tc[0] / 255, 1.22 * tc[1] / 240, 1.5 * tc[2] / 224];
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * f[0]); d[i + 1] = Math.min(255, d[i + 1] * f[1]); d[i + 2] = Math.min(255, d[i + 2] * f[2]); }
  }
  x.putImageData(id, 0, 0);
  if (spriteCache.size > 200) spriteCache.clear();
  spriteCache.set(key, c);
  return c;
}
const BORDER = [186, 158, 214];      // лавандова рамка хмаринки (за скриншотами гри)
const BORDER_PX = 2.5;
// 9-slice капсули: кути без масштабу, краї тягнемо.
function drawNineSlice(ctx, spr, x, y, w, h, S) {
  const k = ATLAS.k;                      // px атласу на 1 px PS2
  const c = spr.corner, cd = c / k;
  const sw = spr.w, sh = spr.h;
  const seg = [[0, c], [c, sw - c], [sw - c, sw]], segY = [[0, c], [c, sh - c], [sh - c, sh]];
  const dx = [[x, x + cd], [x + cd, x + w - cd], [x + w - cd, x + w]], dy = [[y, y + cd], [y + cd, y + h - cd], [y + h - cd, y + h]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const sx0 = spr.x + seg[i][0], sx1 = spr.x + seg[i][1], sy0 = spr.y + segY[j][0], sy1 = spr.y + segY[j][1];
    const ddx0 = dx[i][0], ddx1 = dx[i][1], ddy0 = dy[j][0], ddy1 = dy[j][1];
    if (ddx1 <= ddx0 || ddy1 <= ddy0) continue;
    ctx.drawImage(spr.img, sx0, sy0, sx1 - sx0, sy1 - sy0, ddx0 * S, ddy0 * S, (ddx1 - ddx0) * S + 0.5, (ddy1 - ddy0) * S + 0.5);
  }
}
function drawTailSprite(ctx, it, g, S, tc) {
  const ti = tailInfo(it.tail);
  const set = ATLAS.tails[ti.look] || ATLAS.tails.tail;
  const spr = set[ti.edge];
  const k = ATLAS.k, w = spr.w / k, h = spr.h / k, strip = spr.strip / k;
  const half = g.w / 2 - 16;
  const off = Math.max(-half, Math.min(half, ti.auto ? 0 : it.tailOff));
  const dir = ti.auto ? 1 : ti.dir;                       // спрайт намальований «вправо»; вліво — дзеркало
  const img = tintedSprite(spr.x, spr.y, spr.w, spr.h, ATLAS.tinted ? tc : null, dir < 0);
  const cx = g.x + g.w / 2 + off;
  const x0 = cx - w / 2;
  // смужка зверху/знизу спрайта заходить під край капсули
  const y0 = ti.edge === 'bottom' ? g.y + g.h - strip - 2 : g.y - h + strip + 2;
  ctx.save(); if (ti.auto) ctx.globalAlpha = 0.6;
  if (ATLAS.tinted) {
    const b = BORDER_PX;
    const sil = tintedSprite(spr.x, spr.y, spr.w, spr.h, BORDER, dir < 0, 'silhouette');
    ctx.drawImage(sil, (x0 - b) * S, (y0 - b) * S, (w + 2 * b) * S, (h + 2 * b) * S);
  }
  ctx.drawImage(img, x0 * S, y0 * S, w * S, h * S);
  ctx.restore();
}
// drawWindow: малює вікно за типом справжніми спрайтами гри (fallback — вектор);
// повертає колір тексту для fallback-шрифту
function drawWindow(ctx, it, g, S) {
  const type = wndTypeOf(it.style);
  const tc = tint(it.colors && it.colors[0]);
  if (type === 'none' || type === 'plain') return '#f0f0f0';
  if (type === 'system' || type === 'frame') {
    roundRect(ctx, g.x * S, g.y * S, g.w * S, g.h * S, 4 * S);
    ctx.fillStyle = 'rgba(8,10,28,0.88)'; ctx.fill();
    ctx.lineWidth = Math.max(1, 1.5 * S); ctx.strokeStyle = mulRgb([190, 200, 230], tc); ctx.stroke();
    return '#f0f0f0';
  }
  if (atlasImg) {
    ctx.imageSmoothingEnabled = true;
    // хвостик — під капсулою (смужка спрайта ховається під край, як у грі)
    if (it.tail || type === 'bubble') drawTailSprite(ctx, it, g, S, tc);
    const b = ATLAS.tinted ? BORDER_PX : 0;
    const tcs = ATLAS.tinted ? tc : null;
    if (type === 'shout') {
      const img = tintedSprite(ATLAS.burst.x, ATLAS.burst.y, ATLAS.burst.w, ATLAS.burst.h, tcs, false);
      if (b) {
        const sil = tintedSprite(ATLAS.burst.x, ATLAS.burst.y, ATLAS.burst.w, ATLAS.burst.h, BORDER, false, 'silhouette');
        ctx.drawImage(sil, (g.x - g.w * 0.08 - b) * S, (g.y - g.h * 0.12 - b) * S, (g.w * 1.16 + 2 * b) * S, (g.h * 1.24 + 2 * b) * S);
      }
      ctx.drawImage(img, (g.x - g.w * 0.08) * S, (g.y - g.h * 0.12) * S, g.w * 1.16 * S, g.h * 1.24 * S);
    } else {
      if (b) {
        // SD-атлас без фаски: лавандова рамка — силует капсули трохи більший, під нею заливка з відтінком
        const pillSil = { img: tintedSprite(ATLAS.pill.x, ATLAS.pill.y, ATLAS.pill.w, ATLAS.pill.h, BORDER, false, 'silhouette'), x: 0, y: 0, w: ATLAS.pill.w, h: ATLAS.pill.h, corner: ATLAS.pill.corner };
        drawNineSlice(ctx, pillSil, g.x - b, g.y - b, g.w + 2 * b, g.h + 2 * b, S);
      }
      const pill = { img: tintedSprite(ATLAS.pill.x, ATLAS.pill.y, ATLAS.pill.w, ATLAS.pill.h, tcs, false), x: 0, y: 0, w: ATLAS.pill.w, h: ATLAS.pill.h, corner: ATLAS.pill.corner };
      drawNineSlice(ctx, pill, g.x, g.y, g.w, g.h, S);
    }
    return atlasTextDark ? '#4d2100' : '#f0f0f0';
  }
  // fallback без атласу
  const grad = ctx.createLinearGradient(0, g.y * S, 0, (g.y + g.h) * S);
  grad.addColorStop(0, mulRgb([255, 236, 176], tc)); grad.addColorStop(1, mulRgb([242, 188, 104], tc));
  const border = mulRgb([186, 160, 216], tc);
  if (type === 'shout') spikyPath(ctx, g.x, g.y, g.w, g.h, S); else roundRect(ctx, g.x * S, g.y * S, g.w * S, g.h * S, 12 * S);
  ctx.fillStyle = grad; ctx.fill();
  ctx.lineWidth = Math.max(1, 2 * S); ctx.strokeStyle = border; ctx.stroke();
  if (it.tail || type === 'bubble') drawTail(ctx, it, g, S, grad, border);
  return '#3a2a10';
}

async function renderPreview() {
  const cv = ui.canvas; if (!cv) return;
  const S = bState.zoom || autoScale();
  cv.width = Math.round(bState.screen.w * S); cv.height = Math.round(bState.screen.h * S);
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';
  if (ui.zoomVal) ui.zoomVal.textContent = (bState.zoom ? '' : t('bbZoomAuto') + ' ') + Math.round(S * 100) + '%';
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  drawBackdrop(ctx, cv, S);
  const r = bState.sel;
  if (!r) { ctx.fillStyle = 'rgba(174,184,198,0.8)'; ctx.font = '13px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('bbSelectHint'), cv.width / 2, cv.height / 2); ctx.textAlign = 'left'; ui.previewInfo.hidden = true; return; }
  const { it } = r;
  const g = Object.assign({}, geomOf(r.f, it));
  g.x = effectiveX(it.style, g.x, g.w);
  // оригінальна рамка — пунктир
  if (ovOf(r.f, it)) { ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; roundRect(ctx, effectiveX(it.style, it.x, it.w) * S, it.y * S, it.w * S, it.h * S, 10 * S); ctx.stroke(); ctx.setLineDash([]); }
  await ensureAtlas(r.f.rel);
  if (bState.sel !== r) return;
  // вікно за типом макета (хмаринка / вигук / системне / без рамки) + хвостик
  const textColor = drawWindow(ctx, it, g, S);
  // текст: вибрана сторінка (клік по сторінці у списку) або найширша UK, блок по центру
  const u = bState.unitPx;
  const page = (r.page != null && it.pages[r.page]) || it.pages.reduce((best, pg) => (pg.ukW && (!best.ukW || maxW(pg.ukW) > maxW(best.ukW)) ? pg : best), it.pages[0]);
  const text = page.uk || page.en;
  const name = fontNameFor(it.lh);
  const font = await ensureFont(name);
  const lines = await glyphsFor(text, name);
  if (bState.sel !== r) return;
  let widthsPs2 = [];
  const adv = (gi) => (gi === -1 ? (font.line || 26) : (gi === -2 ? (font.space || Math.round((font.line || 26) * 0.35)) : (font.widths[gi] || 0)));
  if (font && font.widths && lines) {
    widthsPs2 = lines.map(ln => ln.reduce((a, gi) => a + adv(gi), 0) * u);
  } else if (page.ukW || page.enW) widthsPs2 = (page.uk ? page.ukW : page.enW).map(w => w * u);
  const mw = maxW(widthsPs2);
  const lh = it.lh || 22;
  const x0 = g.x + (g.w - mw) / 2;
  const y0 = g.y + (g.h - widthsPs2.length * lh) / 2;
  if (font && font.atlas && lines) {
    const prof = font.profile || PROFILES[name];
    const cellPs2 = prof.cell / 3;                       // 1 px атласу = 1/3 px PS2
    // гліфи — у тимчасовий canvas; у хмаринках гра малює гліф як маску одним
    // темним кольором (контур і заливка разом, без чорного обведення — див.
    // скриншоти), у системних вікнах — світлим із контуром (як є в атласі)
    const type = wndTypeOf(it.style);
    const txtTint = type === 'bubble' || type === 'shout' ? (atlasTextDark ? [77, 33, 0] : [240, 240, 240]) : null;
    const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
    const octx = off.getContext('2d', { willReadFrequently: true }); octx.imageSmoothingEnabled = true;
    lines.forEach((ln, li) => {
      let x = x0;
      const y = y0 + li * lh + (lh - cellPs2) / 2;
      for (const gi of ln) {
        if (gi < 0) { x += adv(gi) * u; continue; }
        const b = boxOf(prof, gi);
        octx.drawImage(font.atlas, b.x, b.y, prof.cell, prof.cell, x * S, y * S, cellPs2 * S, cellPs2 * S);
        x += (font.widths[gi] || 0) * u;
      }
    });
    if (txtTint) {
      // у хмаринках гра бере яскравість гліфа як покриття (PS2 ×2: сіра заливка
      // 128 → 1.0, чорний контур → 0), тому видно лише заливку — тонкі літери
      // одного темного кольору без обведення (як на скриншотах)
      const id = octx.getImageData(0, 0, off.width, off.height); const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const cov = Math.min(255, d[i] * 2) / 255;
        d[i + 3] = Math.round(d[i + 3] * cov); d[i] = txtTint[0]; d[i + 1] = txtTint[1]; d[i + 2] = txtTint[2];
      }
      octx.putImageData(id, 0, 0);
    }
    ctx.drawImage(off, 0, 0);
  } else {
    ctx.fillStyle = textColor; ctx.font = Math.round(lh * 0.7 * S) + 'px "Segoe UI", system-ui, sans-serif';
    text.split('\n').forEach((ln, li) => ctx.fillText(ln, x0 * S, (y0 + li * lh + lh * 0.75) * S));
  }
  // межі тексту, якщо не влазить
  if (mw + bState.minPad > g.w) { ctx.strokeStyle = mw > g.w ? 'rgba(255,80,80,0.9)' : 'rgba(255,200,60,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(x0 * S, y0 * S, mw * S, widthsPs2.length * lh * S); ctx.setLineDash([]); }
  drawSelection(ctx, cv, g, S);
  const fit = it.ukW ? Math.round(g.w - mw) : null;
  ui.previewInfo.innerHTML = '<b>' + g.w + ' × ' + g.h + '</b><span>' + esc(linesText(widthsPs2.length)) + '</span><span title="' + esc(t('bbPreviewInfo', { w: g.w, need: Math.ceil(mw), fit: Math.round(g.w - mw), lines: widthsPs2.length })) + '">' + (fit != null ? badgeHtml(fit) : '<span class="bb-badge neutral">' + t('bbNeed') + ' ' + Math.ceil(mw) + '</span>') + '</span>';
  ui.previewInfo.hidden = false;
}

// drag у preview: всередині — перемістити, кут — змінити розмір
function initDrag() {
  const cv = ui.canvas; if (!cv) return;
  let drag = null;
  const toPs2 = (e) => { const rect = cv.getBoundingClientRect(); const S = rect.width / bState.screen.w; return { x: (e.clientX - rect.left) / S, y: (e.clientY - rect.top) / S, S }; };
  const curGeom = () => { const r = bState.sel; const g = Object.assign({}, geomOf(r.f, r.it)); g.x = effectiveX(r.it.style, g.x, g.w); return g; };
  // що під курсором: кут (cx/cy = −1|1) → resize, всередині → move
  const hitTest = (p, g) => {
    const T = 8 / p.S + 2;
    for (const cx of [-1, 1]) for (const cy of [-1, 1]) {
      const px = cx < 0 ? g.x : g.x + g.w, py = cy < 0 ? g.y : g.y + g.h;
      if (Math.abs(p.x - px) < T && Math.abs(p.y - py) < T) return { corner: { cx, cy } };
    }
    return (p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h) ? { move: true } : null;
  };
  cv.addEventListener('mousedown', (e) => {
    const r = bState.sel; if (!r || e.button !== 0) return;
    const p = toPs2(e); const g = curGeom();
    const h = hitTest(p, g); if (!h) return;
    drag = { mode: h.corner ? 'resize' : 'move', corner: h.corner, start: p, g0: g };
    e.preventDefault();
  });
  cv.addEventListener('mousemove', (e) => {
    if (drag || !bState.sel) { if (!bState.sel) cv.style.cursor = 'default'; return; }
    const h = hitTest(toPs2(e), curGeom());
    cv.style.cursor = !h ? 'default' : h.move ? 'move' : (h.corner.cx * h.corner.cy > 0 ? 'nwse-resize' : 'nesw-resize');
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag || !bState.sel) return;
    const p = toPs2(e); const dx = Math.round(p.x - drag.start.x), dy = Math.round(p.y - drag.start.y);
    const g0 = drag.g0; let g;
    const aligned = !!(bState.sel.it.style & 0xFF);   // X задає гра — рухаємо лише по Y
    if (drag.mode === 'move') g = { x: aligned ? bState.sel.it.x : Math.max(0, g0.x + dx), y: Math.max(0, g0.y + dy), w: g0.w, h: g0.h };
    else {
      const c = drag.corner; let x = g0.x, y = g0.y;
      const w = Math.max(24, g0.w + (c.cx > 0 ? dx : -dx)), h = Math.max(16, g0.h + (c.cy > 0 ? dy : -dy));
      if (c.cx < 0) x = g0.x + g0.w - w;     // тягнемо лівий/верхній край — протилежний лишається на місці
      if (c.cy < 0) y = g0.y + g0.h - h;
      g = { x: aligned ? bState.sel.it.x : Math.max(0, x), y: Math.max(0, y), w, h };
    }
    commitGeom(bState.sel, g);
  });
  window.addEventListener('mouseup', () => { drag = null; });
}

// ---- скан / збереження ----
export async function scanBubbles() {
  if (bState.busy) return;
  const engDir = tState.settings && tState.settings.engDir;
  if (!engDir) { toast(t('bbNoEngDir'), 'error'); return; }
  bState.busy = true; ui.scan.disabled = true; ui.status.textContent = t('bbScanning');
  try {
    const [r, ov] = await Promise.all([
      window.kh1.bubbles.scan({ engDir, glossary: gState.translations || {} }),
      window.kh1.bubbles.load({ tsvDir: tState.settings.tsvDir })
    ]);
    if (!r || !r.ok) { toast(t('toastError', { msg: (r && r.error) || '?' }), 'error', 7000); return; }
    bState.files = r.files; bState.unitPx = r.unitPx; bState.minPad = r.minPad; bState.screen = r.screen;
    groupTwins();
    bState.fonts = {};
    for (const [name, f] of Object.entries(r.fonts || {})) bState.fonts[name] = Object.assign({}, f);
    bState.glyphCache.clear();
    fillWorlds();
    if (!Object.keys(bState.overrides).length || !isDirty()) { bState.overrides = (ov && ov.overrides) || {}; bState.saved = JSON.stringify(bState.overrides); }
    bState.sel = null;
    rebuildRows(); fillInspector(); schedulePreview();
    toast(t('toastBbScanned', { files: r.stats.files, total: r.stats.total, over: r.stats.over }), r.stats.over ? 'warn' : 'success', 6000);
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
  finally { bState.busy = false; ui.scan.disabled = false; refreshStatus(); }
}
// «Усі файли» → теки верхнього рівня зі скану (WORLD01…, FORM, SYS…)
function fillWorlds() {
  if (!ui.world) return;
  const set = new Set(bState.files.map(f => worldOf(f.rel)));
  const cur = bState.world;
  ui.world.innerHTML = '<option value="">' + esc(t('bbAllFiles')) + '</option>' + [...set].sort().map(w => '<option value="' + esc(w) + '">' + esc(w) + '</option>').join('');
  ui.world.value = set.has(cur) ? cur : '';
  bState.world = ui.world.value;
}
async function save() {
  const tsvDir = tState.settings && tState.settings.tsvDir;
  if (!tsvDir) { toast(t('bbNoTsvDir'), 'error'); return; }
  try {
    const r = await window.kh1.bubbles.save({ tsvDir, overrides: bState.overrides });
    if (!r || !r.ok) { toast(t('toastError', { msg: (r && r.error) || '?' }), 'error', 7000); return; }
    bState.saved = JSON.stringify(bState.overrides);
    refreshStatus();
    toast(t('toastBbSaved', { n: r.count, file: r.filePath }), 'success', 6000);
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
}

export function initBubbles() {
  ui.scan = el('bb-scan'); ui.filter = el('bb-filter'); ui.search = el('bb-search'); ui.fitAll = el('bb-fit-all'); ui.resetAll = el('bb-reset-all'); ui.save = el('bb-save');
  ui.list = el('bb-list'); ui.canvas = el('bb-canvas'); ui.previewInfo = el('bb-preview-info');
  ui.x = el('bb-x'); ui.y = el('bb-y'); ui.w = el('bb-w'); ui.h = el('bb-h'); ui.fitOne = el('bb-fit-one'); ui.resetOne = el('bb-reset-one');
  ui.selInfo = el('bb-sel-info'); ui.enText = el('bb-en'); ui.ukText = el('bb-uk');
  ui.status = el('bb-status'); ui.info = el('bb-info'); ui.state = el('bb-status-state'); ui.dot = el('bb-status-dot');
  ui.world = el('bb-world'); ui.sort = el('bb-sort'); ui.count = el('bb-count');
  ui.zoomIn = el('bb-zoom-in'); ui.zoomOut = el('bb-zoom-out'); ui.zoomVal = el('bb-zoom-val');
  ui.copyEn = el('bb-copy-en'); ui.copyUk = el('bb-copy-uk');
  if (!ui.list) return;
  ui.scan.addEventListener('click', scanBubbles);
  ui.filter.addEventListener('change', () => { bState.filter = ui.filter.value; rebuildRows(); });
  if (ui.world) ui.world.addEventListener('change', () => { bState.world = ui.world.value; rebuildRows(); });
  if (ui.sort) ui.sort.addEventListener('change', () => { bState.sort = ui.sort.value; rebuildRows(); });
  if (ui.zoomIn) ui.zoomIn.addEventListener('click', () => zoomStep(1));
  if (ui.zoomOut) ui.zoomOut.addEventListener('click', () => zoomStep(-1));
  if (ui.zoomVal) ui.zoomVal.addEventListener('click', () => setZoom(0));
  if (ui.copyEn) ui.copyEn.addEventListener('click', () => { if (bState.sel) copyText(bState.sel.it.pages.map(pg => pg.en).join('\n')); });
  if (ui.copyUk) ui.copyUk.addEventListener('click', () => { if (bState.sel) copyText(bState.sel.it.pages.map(pg => pg.uk || '').join('\n')); });
  let st = null;
  ui.search.addEventListener('input', () => { if (st) clearTimeout(st); st = setTimeout(() => { bState.search = ui.search.value; rebuildRows(); }, 120); });
  ui.fitAll.addEventListener('click', fitAll);
  ui.resetAll.addEventListener('click', resetAll);
  ui.save.addEventListener('click', save);
  for (const k of ['x', 'y', 'w', 'h']) ui[k].addEventListener('change', applyInputs);
  ui.fitOne.addEventListener('click', fitOne);
  ui.resetOne.addEventListener('click', resetOne);
  ui.list.addEventListener('scroll', () => { closeRowMenu(); if (bState.rendered < bState.rows.length && ui.list.scrollTop + ui.list.clientHeight > ui.list.scrollHeight - 400) appendChunk(); });
  window.addEventListener('resize', () => { closeRowMenu(); schedulePreview(); });
  initDrag();
  fillInspector(); refreshStatus();
}

// Перший показ вкладки — скануємо; далі лише перемальовуємо.
export function enterBubbles() {
  if (!bState.files.length && !bState.busy) { scanBubbles(); schedulePreview(); }
  else schedulePreview();
}
