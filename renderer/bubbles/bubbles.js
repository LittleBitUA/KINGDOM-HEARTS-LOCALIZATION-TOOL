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
  filter: 'over',         // over | translated | changed | all
  search: '',
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
  bState.rows = rows;
  bState.rendered = 0;
  ui.list.innerHTML = '';
  if (!rows.length) { ui.list.innerHTML = '<div class="t-empty"><p>' + t(bState.files.length ? 'bbNoRows' : 'bbEmpty') + '</p></div>'; }
  else appendChunk();
  refreshStatus();
}
function rowEl(r) {
  const { f, it } = r;
  const d = document.createElement('div');
  d.className = 'bb-row' + (isOver(f, it) ? ' over' : '') + (ovOf(f, it) ? ' changed' : '') + (bState.sel && bState.sel.it === it ? ' active' : '');
  d.dataset.key = keyOf(f, it);
  const g = geomOf(f, it);
  const fit = fitOf(f, it);
  const need = it.ukW ? Math.ceil(maxW(it.ukW) * bState.unitPx) : null;
  const typeIcon = it.usable === false ? '⚠' : ({ bubble: '💬', shout: '💥', system: '▭', frame: '▭', plain: '¶', none: '¶' }[wndTypeOf(it.style)] || '');
  d.innerHTML =
    '<div class="bb-row-head"><span class="bb-type" title="' + esc(it.usable === false ? t('bbUnusedTitle') : t('bbType_' + wndTypeOf(it.style))) + '">' + typeIcon + '</span><span class="bb-file" title="' + esc(f.rel) + '">' + esc(shortRel(f.rel)) + '</span><span class="bb-id">#' + it.id + '</span>' +
    (it.twins && it.twins.length > 1 ? '<span class="bb-twins" title="' + esc(it.twins.map(tw => tw.f.rel).join('\n')) + '">×' + it.twins.length + '</span>' : '') +
    '<span class="bb-geom">' + g.w + '×' + g.h + (need != null ? ' · ' + t('bbNeed') + ' ' + need : '') + '</span>' +
    (fit != null ? '<span class="bb-fit' + (fit < 0 ? ' bad' : (fit < bState.minPad ? ' warn' : '')) + '">' + (fit >= 0 ? '+' : '') + Math.round(fit) + '</span>' : '') + '</div>' +
    it.pages.map(pg => '<div class="bb-en">' + esc(pg.en) + '</div>' +
      (pg.uk ? '<div class="bb-uk">' + esc(pg.uk) + '</div>' : '<div class="bb-uk dim">' + t('bbNoUk') + '</div>')).join('<div class="bb-page-sep"></div>');
  d.addEventListener('click', () => select(r));
  return d;
}
function appendChunk() {
  const frag = document.createDocumentFragment();
  const end = Math.min(bState.rows.length, bState.rendered + CHUNK);
  for (let i = bState.rendered; i < end; i++) frag.appendChild(rowEl(bState.rows[i]));
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
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function refreshStatus() {
  let total = 0, over = 0, changed = 0, translated = 0;
  for (const f of bState.files) for (const it of f.items) { if (it.primary === false) continue; total++; if (it.uk) translated++; if (isOver(f, it)) over++; if (ovOf(f, it)) changed++; }
  ui.status.textContent = bState.files.length ? t('bbStatus', { files: bState.files.length, total, translated, over, changed }) + (isDirty() ? ' *' : '') : t('bbNotScanned');
  ui.info.textContent = bState.rows.length ? t('bbShown', { n: bState.rows.length }) : '';
  ui.save.disabled = !isDirty();
  ui.fitAll.disabled = !bState.files.length;
  ui.resetAll.disabled = !Object.keys(bState.overrides).length;
}

// ---- вибір + інспектор ----
function select(r) {
  const prev = ui.list.querySelector('.bb-row.active'); if (prev) prev.classList.remove('active');
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
  if (!on) { ui.selInfo.textContent = t('bbSelectHint'); ui.enText.textContent = ''; ui.ukText.textContent = ''; return; }
  const g = geomOf(r.f, r.it);
  for (const k of ['x', 'y', 'w', 'h']) ui[k].value = g[k];
  const it = r.it;
  ui.selInfo.textContent = (it.usable === false ? '⚠ ' + t('bbUnusedTitle') + ' · ' : '') + shortRel(r.f.rel) + ' #' + it.id + (it.count > 1 ? '–' + (it.id + it.count - 1) : '') + (it.twins && it.twins.length > 1 ? ' · ' + t('bbTwins', { n: it.twins.length }) : '') + ' · ' + t('bbOrig') + ' ' + it.x + ',' + it.y + ' ' + it.w + '×' + it.h +
    ' · ' + t('bbLine') + ' ' + it.lh + (it.sug ? ' · ' + t('bbSuggest') + ' ' + it.sug.w + '×' + it.sug.h : '') +
    ' · ' + t('bbType_' + wndTypeOf(it.style)) + ((it.style & 0xFF) ? ' (' + t('bbAlign' + (it.style & 0xFF)) + ')' : '') +
    ' · ' + t('bbTail') + ' ' + tailText(it);
  ui.x.disabled = !!(it.style & 0xFF);
  ui.enText.textContent = it.pages.map(pg => pg.en).join('\n⸻\n');
  ui.ukText.textContent = it.pages.map(pg => pg.uk || t('bbNoUk')).join('\n⸻\n');
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
// drawWindow: малює вікно за типом; повертає колір тексту-підказки для fallback-шрифту
function drawWindow(ctx, it, g, S) {
  const type = wndTypeOf(it.style);
  const tc = tint(it.colors && it.colors[0]);
  if (type === 'none' || type === 'plain') return '#f0f0f0';
  if (type === 'system' || type === 'frame') {
    // темне напівпрозоре вікно з тонкою світлою рамкою (як підказки/меню у грі)
    roundRect(ctx, g.x * S, g.y * S, g.w * S, g.h * S, 4 * S);
    ctx.fillStyle = 'rgba(8,10,28,0.88)'; ctx.fill();
    ctx.lineWidth = Math.max(1, 1.5 * S); ctx.strokeStyle = mulRgb([190, 200, 230], tc); ctx.stroke();
    return '#f0f0f0';
  }
  // хмаринка / вигук: жовто-помаранчевий градієнт × відтінок макета, лавандова рамка
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
  const wrapW = Math.max(200, cv.parentElement.clientWidth - 2);
  const S = Math.min(wrapW / bState.screen.w, 1.6);
  cv.width = Math.round(bState.screen.w * S); cv.height = Math.round(bState.screen.h * S);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  // тло «екрана»
  ctx.fillStyle = '#1b2436'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let gx = 64; gx < bState.screen.w; gx += 64) { ctx.beginPath(); ctx.moveTo(gx * S, 0); ctx.lineTo(gx * S, cv.height); ctx.stroke(); }
  for (let gy = 64; gy < bState.screen.h; gy += 64) { ctx.beginPath(); ctx.moveTo(0, gy * S); ctx.lineTo(cv.width, gy * S); ctx.stroke(); }
  const r = bState.sel;
  if (!r) { ctx.fillStyle = '#9cb3d8'; ctx.font = '13px "Segoe UI", system-ui, sans-serif'; ctx.fillText(t('bbSelectHint'), 12, 24); ui.previewInfo.textContent = '—'; return; }
  const { it } = r;
  const g = Object.assign({}, geomOf(r.f, it));
  g.x = effectiveX(it.style, g.x, g.w);
  // оригінальна рамка — пунктир
  if (ovOf(r.f, it)) { ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; roundRect(ctx, effectiveX(it.style, it.x, it.w) * S, it.y * S, it.w * S, it.h * S, 10 * S); ctx.stroke(); ctx.setLineDash([]); }
  // вікно за типом макета (хмаринка / вигук / системне / без рамки) + хвостик
  const textColor = drawWindow(ctx, it, g, S);
  // текст: найширша сторінка UK (або EN), блок по центру, рядки — від лівого краю блока
  const u = bState.unitPx;
  const page = it.pages.reduce((best, pg) => (pg.ukW && (!best.ukW || maxW(pg.ukW) > maxW(best.ukW)) ? pg : best), it.pages[0]);
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
    ctx.imageSmoothingEnabled = true;
    lines.forEach((ln, li) => {
      let x = x0;
      const y = y0 + li * lh + (lh - cellPs2) / 2;
      for (const gi of ln) {
        if (gi < 0) { x += adv(gi) * u; continue; }
        const b = boxOf(prof, gi);
        ctx.drawImage(font.atlas, b.x, b.y, prof.cell, prof.cell, x * S, y * S, cellPs2 * S, cellPs2 * S);
        x += (font.widths[gi] || 0) * u;
      }
    });
  } else {
    ctx.fillStyle = textColor; ctx.font = Math.round(lh * 0.7 * S) + 'px "Segoe UI", system-ui, sans-serif';
    text.split('\n').forEach((ln, li) => ctx.fillText(ln, x0 * S, (y0 + li * lh + lh * 0.75) * S));
  }
  // межі тексту, якщо не влазить
  if (mw + bState.minPad > g.w) { ctx.strokeStyle = mw > g.w ? 'rgba(255,80,80,0.9)' : 'rgba(255,200,60,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(x0 * S, y0 * S, mw * S, widthsPs2.length * lh * S); ctx.setLineDash([]); }
  // маркер зміни розміру
  ctx.fillStyle = 'rgba(211,173,82,0.95)'; ctx.fillRect((g.x + g.w) * S - 6, (g.y + g.h) * S - 6, 6, 6);
  ui.previewInfo.textContent = t('bbPreviewInfo', { w: g.w, need: Math.ceil(mw), fit: Math.round(g.w - mw), lines: widthsPs2.length });
}

// drag у preview: всередині — перемістити, кут — змінити розмір
function initDrag() {
  const cv = ui.canvas; if (!cv) return;
  let drag = null;
  const toPs2 = (e) => { const rect = cv.getBoundingClientRect(); const S = cv.width / bState.screen.w; return { x: (e.clientX - rect.left) / S, y: (e.clientY - rect.top) / S }; };
  cv.addEventListener('mousedown', (e) => {
    const r = bState.sel; if (!r || e.button !== 0) return;
    const p = toPs2(e); const g = Object.assign({}, geomOf(r.f, r.it)); g.x = effectiveX(r.it.style, g.x, g.w);
    const nearCorner = Math.abs(p.x - (g.x + g.w)) < 10 && Math.abs(p.y - (g.y + g.h)) < 10;
    const inside = p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h;
    if (!nearCorner && !inside) return;
    drag = { mode: nearCorner ? 'resize' : 'move', start: p, g0: g };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag || !bState.sel) return;
    const p = toPs2(e); const dx = Math.round(p.x - drag.start.x), dy = Math.round(p.y - drag.start.y);
    const g0 = drag.g0; let g;
    const aligned = !!(bState.sel.it.style & 0xFF);
    if (drag.mode === 'move') g = { x: aligned ? bState.sel.it.x : Math.max(0, g0.x + dx), y: Math.max(0, g0.y + dy), w: g0.w, h: g0.h };
    else g = { x: g0.x, y: g0.y, w: Math.max(24, g0.w + dx), h: Math.max(16, g0.h + dy) };
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
    if (!Object.keys(bState.overrides).length || !isDirty()) { bState.overrides = (ov && ov.overrides) || {}; bState.saved = JSON.stringify(bState.overrides); }
    bState.sel = null;
    rebuildRows(); fillInspector(); schedulePreview();
    toast(t('toastBbScanned', { files: r.stats.files, total: r.stats.total, over: r.stats.over }), r.stats.over ? 'warn' : 'success', 6000);
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
  finally { bState.busy = false; ui.scan.disabled = false; refreshStatus(); }
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
  ui.status = el('bb-status'); ui.info = el('bb-info');
  if (!ui.list) return;
  ui.scan.addEventListener('click', scanBubbles);
  ui.filter.addEventListener('change', () => { bState.filter = ui.filter.value; rebuildRows(); });
  let st = null;
  ui.search.addEventListener('input', () => { if (st) clearTimeout(st); st = setTimeout(() => { bState.search = ui.search.value; rebuildRows(); }, 120); });
  ui.fitAll.addEventListener('click', fitAll);
  ui.resetAll.addEventListener('click', resetAll);
  ui.save.addEventListener('click', save);
  for (const k of ['x', 'y', 'w', 'h']) ui[k].addEventListener('change', applyInputs);
  ui.fitOne.addEventListener('click', fitOne);
  ui.resetOne.addEventListener('click', resetOne);
  ui.list.addEventListener('scroll', () => { if (bState.rendered < bState.rows.length && ui.list.scrollTop + ui.list.clientHeight > ui.list.scrollHeight - 400) appendChunk(); });
  window.addEventListener('resize', () => { if (bState.sel) schedulePreview(); });
  initDrag();
  fillInspector(); refreshStatus();
}

// Перший показ вкладки — скануємо; далі лише перемальовуємо.
export function enterBubbles() {
  if (!bState.files.length && !bState.busy) scanBubbles();
  else schedulePreview();
}
