import { toast } from '../core/log.js';

// =====================================================================
// Кернінг Re:CoM — як у KH1, але для шрифту «FFMW»: ширина гліфа (крок каретки)
// зберігається байтом у .binl, атлас — HD PNG `_fo240.png` (дві половини по
// 1024 px, комірки cell×cell). 1 одиниця ширини = S атласних px (S = cell /
// висота рядка = 2). Тягни червону лінію в комірці або впиши число; Auto-fit
// підбирає ширину за непрозорим краєм; preview малює текст цим шрифтом
// (кирилиця — на кодах хіраґани 0x829F…, як у кодеку гри).
// =====================================================================
const el = (id) => document.getElementById(id);
const t = (k, v) => (window.i18n ? window.i18n.t(k, v) : k);
const SCALE = 2;
const ui = {};

export const ckState = {
  name: 'sysfont',
  binlPath: null, pngPath: null, source: '',
  profile: null,           // { cell, cols, rows }
  scaleUnit: 2,            // атласних px на одиницю ширини
  count: 0, line: 0,
  widths: null, original: null,
  map: null,               // код→гліф (u16[]), від коду 0x20
  atlas: null,             // { width, height, data } RGBA
  labels: null,            // glyphIdx → символ(и)
  cyr: null,               // { char: code } з data/recom/tables.json
  glyphs: [],              // { idx, x, y, canvas }
  filterText: '',
  dirty: false
};

// ---- коди ↔ гліфи (як comfont.Font.key) ----
function keyOfCode(code) {
  if (code < 0x100) return code - 0x20;
  if ((code >> 8) === 0x82) return 224 + (code & 0xFF);
  return -1;
}
function glyphOfCode(code) {
  const k = keyOfCode(code);
  if (k < 0 || !ckState.map || k >= ckState.map.length) return 0;
  return ckState.map[k];
}
function codeOfChar(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 0x20 && c < 0x7F) return c;
  if (ckState.cyr && ckState.cyr[ch]) return ckState.cyr[ch];
  // повноширинні цифри/літери → 0x82xx
  if (c >= 0xFF10 && c <= 0xFF19) return 0x824F + (c - 0xFF10);
  if (c >= 0xFF21 && c <= 0xFF3A) return 0x8260 + (c - 0xFF21);
  if (c >= 0xFF41 && c <= 0xFF5A) return 0x8281 + (c - 0xFF41);
  return -1;
}
function buildLabels() {
  const labels = new Map();
  const put = (idx, s) => { if (idx > 0) { const cur = labels.get(idx); if (!cur) labels.set(idx, s); else if (cur.length < 6 && !cur.includes(s)) labels.set(idx, cur + s); } };
  for (let c = 0x21; c < 0x7F; c++) put(glyphOfCode(c), String.fromCharCode(c));
  for (let i = 0; i < 10; i++) put(glyphOfCode(0x824F + i), String.fromCharCode(0xFF10 + i));
  for (let i = 0; i < 26; i++) { put(glyphOfCode(0x8260 + i), String.fromCharCode(0xFF21 + i)); put(glyphOfCode(0x8281 + i), String.fromCharCode(0xFF41 + i)); }
  if (ckState.cyr) for (const [ch, code] of Object.entries(ckState.cyr)) put(glyphOfCode(code), ch);
  ckState.labels = labels;
}
function glyphLabel(idx) {
  const s = ckState.labels && ckState.labels.get(idx);
  return '#' + idx + (s ? ' (' + s + ')' : '');
}

// ---- атлас ----
function boxOf(i) {
  const { cell, cols, rows } = ckState.profile;
  const per = cols * rows;
  const blk = Math.floor(i / per), j = i % per;
  return { x: blk * 1024 + (j % cols) * cell, y: Math.floor(j / cols) * cell };
}
async function loadAtlas(dataUrl) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('PNG не читається')); img.src = dataUrl; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: id.data, canvas: c };
}
function threshold() {
  const v = parseInt(ui.threshold && ui.threshold.value, 10);
  return Number.isFinite(v) ? Math.max(1, Math.min(255, v)) : 96;
}
function rightEdge(g) {
  if (!ckState.atlas) return -1;
  const { cell } = ckState.profile;
  const { width: w, height: h, data } = ckState.atlas;
  const thr = threshold();
  let rightmost = -1;
  for (let row = 0; row < cell; row++) {
    const sy = g.y + row; if (sy >= h) break;
    for (let col = cell - 1; col > rightmost; col--) {
      const sx = g.x + col; if (sx >= w) continue;
      if (data[(sy * w + sx) * 4 + 3] >= thr) { rightmost = col; break; }
    }
    if (rightmost === cell - 1) break;
  }
  return rightmost;
}
function maxWidth() { return Math.round(ckState.profile.cell / ckState.scaleUnit); }
function suggest(g) {
  const right = rightEdge(g);
  if (right < 0) return ckState.widths[g.idx];
  return Math.max(1, Math.min(maxWidth(), Math.ceil((right + 2) / ckState.scaleUnit)));
}

// ---- сітка ----
function drawGlyph(canvas, g) {
  const { cell } = ckState.profile;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1a2848';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (ckState.atlas) ctx.drawImage(ckState.atlas.canvas, g.x, g.y, cell, cell, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let px = 8; px < cell; px += 8) { const x = px * SCALE; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  const lineX = ckState.widths[g.idx] * ckState.scaleUnit * SCALE + 0.5;
  ctx.strokeStyle = '#ff5566'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(255,80,100,0.7)'; ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.moveTo(lineX, 0); ctx.lineTo(lineX, canvas.height); ctx.stroke();
  ctx.shadowBlur = 0;
  if (ckState.widths[g.idx] !== ckState.original[g.idx]) { ctx.strokeStyle = '#f4c430'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2); }
}
function valueText(g) {
  let s = (ckState.widths[g.idx] * ckState.scaleUnit) + ' px (w=' + ckState.widths[g.idx] + ')';
  if (ckState.atlas) { const r = rightEdge(g); if (r >= 0) s += ' · max=' + (r + 1) + 'px'; }
  return s;
}
function setWidth(g, v, canvas, valueLabel, input) {
  v = Math.max(0, Math.min(maxWidth(), v | 0));
  if (ckState.widths[g.idx] === v) return;
  ckState.widths[g.idx] = v;
  ckState.dirty = true;
  if (input) input.value = v;
  if (valueLabel) valueLabel.textContent = valueText(g);
  if (canvas) drawGlyph(canvas, g);
  refreshStatus();
  schedulePreview();
}
function parseFilter(text) {
  if (!text || !text.trim()) return null;
  const set = new Set();
  for (const part of text.split(/[,\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (m) { const a = +m[1], b = m[2] ? +m[2] : a; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i); continue; }
    for (const ch of Array.from(part)) { const code = codeOfChar(ch); const idx = code >= 0 ? glyphOfCode(code) : 0; if (idx > 0) set.add(idx); }
  }
  return set.size ? set : null;
}
function renderGrid() {
  ui.grid.innerHTML = '';
  if (!ckState.widths) { ui.grid.innerHTML = '<div class="t-empty"><p>' + t('ckEmpty') + '</p></div>'; return; }
  const grid = document.createElement('div');
  grid.className = 'k-grid';
  const filter = parseFilter(ckState.filterText);
  const { cell } = ckState.profile;
  const frag = document.createDocumentFragment();
  for (const g of ckState.glyphs) {
    if (filter && !filter.has(g.idx)) continue;
    const cellEl = document.createElement('div');
    cellEl.className = 'k-cell';
    const canvas = document.createElement('canvas');
    canvas.width = cell * SCALE; canvas.height = cell * SCALE;
    canvas.className = 'k-canvas';
    g.canvas = canvas;
    const head = document.createElement('div'); head.className = 'k-head'; head.textContent = glyphLabel(g.idx);
    const value = document.createElement('div'); value.className = 'k-value'; value.textContent = valueText(g);
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = String(maxWidth()); input.value = ckState.widths[g.idx]; input.className = 'k-input';
    input.addEventListener('input', () => { const v = parseInt(input.value, 10); setWidth(g, Number.isFinite(v) ? v : 0, canvas, value, input); });
    let dragging = false;
    const fromX = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width * cell;
      setWidth(g, Math.round(px / ckState.scaleUnit), canvas, value, input);
    };
    canvas.addEventListener('mousedown', (e) => { if (e.button !== 0) return; dragging = true; fromX(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (dragging) fromX(e.clientX); });
    window.addEventListener('mouseup', () => { dragging = false; });
    cellEl.append(head, canvas, value, input);
    frag.appendChild(cellEl);
    drawGlyph(canvas, g);
  }
  grid.appendChild(frag);
  ui.grid.appendChild(grid);
}
function refreshStatus() {
  const changed = ckState.widths ? ckState.widths.reduce((n, w, i) => n + (w !== ckState.original[i] ? 1 : 0), 0) : 0;
  const base = (p) => (p ? String(p).split(/[\\/]/).pop() : '—');
  ui.status.textContent = ckState.binlPath ? base(ckState.binlPath) + (ckState.dirty ? ' *' : '') + ' · PNG: ' + base(ckState.pngPath) + (ckState.source ? ' · ' + ckState.source : '') : t('ckNotLoaded');
  ui.info.textContent = ckState.widths ? t('ckInfo', { n: ckState.count, changed, line: ckState.line }) : '';
  ui.save.disabled = !ckState.dirty;
  ui.reset.disabled = changed === 0;
  ui.autofit.disabled = !ckState.widths || !ckState.atlas;
  if (ui.previewText) ui.previewText.disabled = !ckState.widths;
}

// ---- preview ----
let previewTimer = null;
function schedulePreview() { if (previewTimer) clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }
function renderPreview() {
  const cv = ui.preview; if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  const cssW = Math.max(1, cv.clientWidth) || 1100;
  if (cv.width !== cssW) cv.width = cssW;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const text = ui.previewText ? ui.previewText.value : '';
  if (!text || !ckState.widths || !ckState.atlas) { ctx.fillStyle = '#9cb3d8'; ctx.font = '13px "Segoe UI", system-ui, sans-serif'; ctx.fillText(t('previewEmpty'), 12, 30); if (ui.previewInfo) ui.previewInfo.textContent = '—'; return; }
  const { cell } = ckState.profile;
  const S = ckState.scaleUnit;
  const scale = Math.min(1.5, (cv.height - 8) / cell);
  const y0 = (cv.height - cell * scale) / 2;
  let x = 8, missing = 0, drawn = 0;
  for (const ch of Array.from(text)) {
    if (ch === ' ') { x += (ckState.widths[glyphOfCode(0x20)] || 5) * S * scale; continue; }
    const code = codeOfChar(ch);
    const idx = code >= 0 ? glyphOfCode(code) : 0;
    if (idx <= 0) { missing++; x += 6 * scale; continue; }
    const b = boxOf(idx);
    ctx.drawImage(ckState.atlas.canvas, b.x, b.y, cell, cell, x, y0, cell * scale, cell * scale);
    x += ckState.widths[idx] * S * scale;
    drawn++;
  }
  if (ui.previewInfo) ui.previewInfo.textContent = drawn + ' ' + t('ckGlyphs') + ' · ' + Math.round((x - 8) / scale) + ' px' + (missing ? ' · ' + t('ckNoGlyph', { n: missing }) : '');
}

// ---- завантаження ----
async function ensureCyr() {
  if (ckState.cyr) return;
  try { const r = await window.kh1.comkern.cyrTable(); if (r && r.ok) ckState.cyr = r.cyr; } catch (_) { ckState.cyr = {}; }
}
async function loadFrom(binlPath, pngPath, source) {
  const r = await window.kh1.comkern.load({ binlPath, pngPath });
  if (!r || !r.ok) { toast(t('toastError', { msg: (r && r.error) || '?' }), 'error', 7000); return false; }
  await ensureCyr();
  ckState.name = r.name; ckState.profile = r.profile; ckState.count = r.count; ckState.line = r.line;
  ckState.scaleUnit = Math.max(1, Math.round(r.profile.cell / (r.line || r.profile.cell)));
  ckState.widths = r.widths.slice(); ckState.original = r.widths.slice(); ckState.map = r.map;
  ckState.binlPath = r.binlPath; ckState.pngPath = r.pngPath; ckState.source = source || '';
  ckState.dirty = false;
  ckState.atlas = null;
  if (r.pngDataUrl) { try { ckState.atlas = await loadAtlas(r.pngDataUrl); } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); } }
  buildLabels();
  ckState.glyphs = [];
  for (let i = 0; i < ckState.count; i++) { const b = boxOf(i); ckState.glyphs.push({ idx: i, x: b.x, y: b.y, canvas: null }); }
  if (ui.font) ui.font.value = ckState.name;
  renderGrid(); refreshStatus(); schedulePreview();
  return true;
}
async function loadAuto() {
  const name = ui.font ? ui.font.value : 'sysfont';
  try {
    const r = await window.kh1.comkern.locate({ name });
    if (!r.ok) { toast(r.error, 'error', 7000); return; }
    if (await loadFrom(r.binlPath, r.pngPath, r.source === 'build' ? t('ckSourceBuild') : t('ckSourceGame'))) toast(t('toastCkLoaded', { file: r.binlPath.split(/[\\/]/).pop(), n: ckState.count }), 'success');
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
}
async function openFile() {
  try {
    const r = await window.kh1.comkern.open();
    if (r.canceled) return;
    if (await loadFrom(r.binlPath, null, '')) toast(t('toastCkLoaded', { file: r.binlPath.split(/[\\/]/).pop(), n: ckState.count }), 'success');
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
}
async function save() {
  if (!ckState.widths || !ckState.binlPath) return;
  try {
    const r = await window.kh1.comkern.save({ binlPath: ckState.binlPath, widths: ckState.widths });
    if (r.canceled) return;
    if (!r.ok) { toast(t('toastError', { msg: r.error }), 'error', 7000); return; }
    ckState.original = ckState.widths.slice(); ckState.dirty = false; ckState.binlPath = r.filePath;
    renderGrid(); refreshStatus();
    toast(t('toastCkSaved', { file: r.filePath }), 'success', 6000);
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
}
function autoFitAll() {
  if (!ckState.widths || !ckState.atlas) return;
  let changed = 0, kept = 0, empty = 0;
  for (const g of ckState.glyphs) {
    if (rightEdge(g) < 0) { empty++; continue; }
    const v = suggest(g);
    if (v !== ckState.widths[g.idx]) { ckState.widths[g.idx] = v; changed++; } else kept++;
  }
  if (changed) ckState.dirty = true;
  renderGrid(); refreshStatus(); schedulePreview();
  toast(t('toastAutoFitDone', { changed, kept, empty }), 'success', 5000);
}
function resetAll() {
  if (!ckState.widths) return;
  ckState.widths = ckState.original.slice(); ckState.dirty = false;
  renderGrid(); refreshStatus(); schedulePreview();
}

export function initComKerning() {
  ui.font = el('ck-font'); ui.auto = el('ck-load-auto'); ui.open = el('ck-open'); ui.filter = el('ck-filter');
  ui.threshold = el('ck-threshold'); ui.autofit = el('ck-autofit'); ui.reset = el('ck-reset'); ui.save = el('ck-save');
  ui.previewText = el('ck-preview-text'); ui.preview = el('ck-preview-canvas'); ui.previewBg = el('ck-preview-bg'); ui.previewInfo = el('ck-preview-info');
  ui.grid = el('ck-grid-wrap'); ui.status = el('ck-status'); ui.info = el('ck-info');
  if (!ui.grid) return;
  ui.auto.addEventListener('click', loadAuto);
  ui.open.addEventListener('click', openFile);
  ui.font.addEventListener('change', () => { if (ckState.widths) loadAuto(); });
  ui.filter.addEventListener('input', () => { ckState.filterText = ui.filter.value; renderGrid(); });
  ui.threshold.addEventListener('change', () => renderGrid());
  ui.autofit.addEventListener('click', autoFitAll);
  ui.reset.addEventListener('click', resetAll);
  ui.save.addEventListener('click', save);
  ui.previewText.addEventListener('input', schedulePreview);
  if (ui.previewBg) ui.previewBg.addEventListener('change', () => { ui.preview.classList.toggle('transparent-bg', !ui.previewBg.checked); schedulePreview(); });
  window.addEventListener('resize', () => { if (ckState.widths) schedulePreview(); });
  refreshStatus();
}

// Перший показ вкладки: якщо ще нічого не завантажено — беремо зі збірки шрифтів UA.
export function enterComKerning() {
  if (!ckState.widths) loadAuto();
  else schedulePreview();
}
