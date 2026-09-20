import { toast } from '../core/log.js';
import { tState } from '../core/state.js';

// =====================================================================
// «Текстури» Re:CoM. Написи інтерфейсу (FRIENDS, CARDS, LEVEL UP!, BONUS,
// підказки меню…) — це картинки у remastered/FORM/<n>/FOxxxx.RTM/UK_*.imz
// (контейнер IMGZ) та кілька UK_*.png. Тут: сітка мініатюр усіх текстур,
// перегляд, заміна конкретної текстури своїм PNG (той самий розмір) — вона
// одразу перезбирається у DONE/Recom/… і потрапляє у «Зібрати патч»; експорт
// усіх у PNG та імпорт теки з відредагованими PNG.
// =====================================================================
const el = (id) => document.getElementById(id);
const t = (k, v) => (window.i18n ? window.i18n.t(k, v) : k);
const ui = {};

export const xState = {
  items: [],          // [{ rel, kind, entries: [{ index, w, h, bpp, replaced }] }]
  rows: [],           // плаский відфільтрований список { item, en }
  filter: 'all', search: '', folder: '', thumb: 180, zoom: 0,
  sel: null,          // { item, en }
  busy: false,
  lastDir: ''         // остання тека експорту/імпорту (для діалогу)
};

const dirs = () => ({ tsvDir: tState.settings && tState.settings.tsvDir, outDir: tState.settings && tState.settings.outDir });
const keyOf = (item, en) => item.rel + '\u0001' + en.index;
const shortRel = (rel) => rel.replace(/^remastered\//, '');
const folderOf = (rel) => shortRel(rel).split('/').slice(0, 2).join('/');   // FORM/0002
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nameOf = (item, en) => item.rel.split('/').pop() + (item.kind === 'imz' && item.entries.length > 1 ? ' #' + en.index : '');

// ---- список ----
function rebuildRows() {
  const q = xState.search.trim().toLowerCase();
  const rows = [];
  for (const item of xState.items) {
    if (xState.folder && folderOf(item.rel) !== xState.folder) continue;
    if (q && !item.rel.toLowerCase().includes(q)) continue;
    for (const en of item.entries) {
      if (xState.filter === 'replaced' && !en.replaced) continue;
      if (xState.filter === 'orig' && en.replaced) continue;
      rows.push({ item, en });
    }
  }
  xState.rows = rows;
  ui.grid.innerHTML = '';
  ui.grid.style.setProperty('--tx-thumb', xState.thumb + 'px');
  if (ui.count) ui.count.textContent = xState.items.length ? '(' + rows.length + ')' : '';
  if (!rows.length) { ui.grid.innerHTML = '<div class="t-empty"><p>' + esc(t(xState.items.length ? 'txNoRows' : 'txEmpty')) + '</p></div>'; refreshStatus(); return; }
  const frag = document.createDocumentFragment();
  for (const r of rows) frag.appendChild(cardEl(r));
  ui.grid.appendChild(frag);
  refreshStatus();
}
function cardEl(r) {
  const { item, en } = r;
  const d = document.createElement('div');
  d.className = 'tx-card' + (en.replaced ? ' replaced' : '') + (xState.sel && xState.sel.item === item && xState.sel.en === en ? ' active' : '');
  d.dataset.key = keyOf(item, en);
  d.innerHTML = '<div class="tx-thumb checker"><img alt="" loading="lazy"></div>' +
    '<div class="tx-card-name" title="' + esc(item.rel) + '">' + esc(nameOf(item, en)) + '</div>' +
    '<div class="tx-card-meta"><span>' + esc(folderOf(item.rel)) + '</span><span>' + en.w + '×' + en.h + '</span>' +
    (en.replaced ? '<span class="bb-badge pos">' + esc(t('txReplacedBadge')) + '</span>' : '') + '</div>';
  d.addEventListener('click', () => select(r));
  d.addEventListener('dblclick', () => replaceSel());
  thumbObserver.observe(d);
  return d;
}
// мініатюри — ліниво, коли картка в полі зору
const thumbObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    thumbObserver.unobserve(e.target);
    const img = e.target.querySelector('img');
    const [rel, idx] = e.target.dataset.key.split('\u0001');
    const item = xState.items.find(x => x.rel === rel);
    if (!item || !img) continue;
    window.kh1.textures.thumb({ rel, index: parseInt(idx, 10), kind: item.kind, max: 256, tsvDir: dirs().tsvDir })
      .then(r => { if (r && r.ok) img.src = r.dataUrl; else e.target.classList.add('broken'); }).catch(() => {});
  }
}, { root: null, rootMargin: '300px' });

function refreshCard(r) {
  const old = ui.grid.querySelector('[data-key="' + CSS.escape(keyOf(r.item, r.en)) + '"]');
  if (old) old.replaceWith(cardEl(r));
}
function fillFolders() {
  if (!ui.folder) return;
  const set = new Set(xState.items.map(x => folderOf(x.rel)));
  const cur = xState.folder;
  ui.folder.innerHTML = '<option value="">' + esc(t('txAllFolders')) + '</option>' + [...set].sort().map(f => '<option value="' + esc(f) + '">' + esc(f) + '</option>').join('');
  ui.folder.value = set.has(cur) ? cur : ''; xState.folder = ui.folder.value;
}
function refreshStatus() {
  let total = 0, replaced = 0;
  for (const it of xState.items) for (const en of it.entries) { total++; if (en.replaced) replaced++; }
  ui.status.textContent = xState.items.length ? t('txStatus', { files: xState.items.length, total, replaced }) : '';
  if (ui.state) ui.state.textContent = t(xState.busy ? 'bbStateScanning' : !xState.items.length ? 'bbStateIdle' : 'bbStateReady');
  if (ui.dot) ui.dot.className = 'bb-status-dot ' + (xState.busy ? 'busy' : !xState.items.length ? 'idle' : 'ok');
  ui.info.textContent = xState.items.length ? t('bbShown', { n: xState.rows.length }) : '';
  ui.exportAll.disabled = !xState.items.length;
  ui.importDir.disabled = !xState.items.length;
}

// ---- вибір + перегляд ----
function select(r) {
  const prev = ui.grid.querySelector('.tx-card.active'); if (prev) prev.classList.remove('active');
  xState.sel = r;
  const cur = ui.grid.querySelector('[data-key="' + CSS.escape(keyOf(r.item, r.en)) + '"]'); if (cur) cur.classList.add('active');
  fillInspector();
  loadPreview();
}
function chip(text, cls, title) { return '<span class="bb-chip' + (cls ? ' ' + cls : '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>'; }
function fillInspector() {
  const r = xState.sel, on = !!r;
  ui.replace.disabled = !on || (r && r.en.bpp !== 32);
  ui.reset.disabled = !on || !(r && r.en.replaced);
  ui.exportOne.disabled = !on; ui.reveal.disabled = !on;
  if (!on) { ui.selName.textContent = ''; ui.selInfo.innerHTML = chip(t('txSelectHint'), 'dim'); return; }
  const { item, en } = r;
  ui.selName.textContent = nameOf(item, en);
  const chips = [chip(shortRel(item.rel), 'mono', item.rel), chip(en.w + ' × ' + en.h), chip(item.kind === 'imz' ? 'IMGZ · IMGD ' + en.bpp + 'bpp' : 'PNG')];
  if (item.kind === 'imz' && item.entries.length > 1) chips.push(chip(t('txEntryOf', { i: en.index + 1, n: item.entries.length })));
  if (en.replaced) chips.push(chip(t('txReplacedBadge'), 'gold'));
  if (en.bpp !== 32) chips.push(chip(t('txNoReplace8'), 'warn'));
  ui.selInfo.innerHTML = chips.join('');
}
let previewSeq = 0;
async function loadPreview() {
  const r = xState.sel; const seq = ++previewSeq;
  if (!r) { ui.preview.hidden = true; ui.previewEmpty.hidden = false; ui.zoomVal.textContent = '—'; return; }
  const res = await window.kh1.textures.thumb({ rel: r.item.rel, index: r.en.index, kind: r.item.kind, max: 0, tsvDir: dirs().tsvDir });
  if (seq !== previewSeq) return;
  if (!res || !res.ok) { toast(t('toastError', { msg: (res && res.error) || '?' }), 'error', 6000); return; }
  ui.preview.src = res.dataUrl; ui.preview.hidden = false; ui.previewEmpty.hidden = true;
  ui.preview.dataset.w = res.w; ui.preview.dataset.h = res.h;
  applyZoom();
}
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
function autoScale() {
  const w = parseInt(ui.preview.dataset.w, 10) || 1, h = parseInt(ui.preview.dataset.h, 10) || 1;
  const wrap = ui.previewWrap;
  return Math.min((wrap.clientWidth - 24) / w, (wrap.clientHeight - 24) / h, 2);
}
function applyZoom() {
  if (ui.preview.hidden) return;
  const S = xState.zoom || autoScale();
  const w = parseInt(ui.preview.dataset.w, 10), h = parseInt(ui.preview.dataset.h, 10);
  ui.preview.style.width = Math.round(w * S) + 'px'; ui.preview.style.height = Math.round(h * S) + 'px';
  ui.preview.style.imageRendering = S >= 2 ? 'pixelated' : 'auto';
  ui.previewWrap.classList.toggle('zoomed', !!xState.zoom);
  ui.zoomVal.textContent = (xState.zoom ? '' : t('bbZoomAuto') + ' ') + Math.round(S * 100) + '%';
}
function zoomStep(dir) {
  const cur = xState.zoom || autoScale();
  if (dir > 0) xState.zoom = ZOOMS.find(v => v > cur + 0.01) || cur;
  else xState.zoom = [...ZOOMS].reverse().find(v => v < cur - 0.01) || 0;
  applyZoom();
}

// ---- дії ----
async function replaceSel() {
  const r = xState.sel; if (!r || r.en.bpp !== 32) return;
  const { tsvDir, outDir } = dirs();
  if (!tsvDir || !outDir) { toast(t('txNoDirs'), 'error'); return; }
  const pick = await window.kh1.textures.pick();
  if (!pick || pick.canceled) return;
  const res = await window.kh1.textures.replace({ rel: r.item.rel, index: r.en.index, kind: r.item.kind, pngPath: pick.pngPath, tsvDir, outDir });
  if (!res || !res.ok) { toast(t('toastError', { msg: (res && res.error) || '?' }), 'error', 8000); return; }
  r.en.replaced = true;
  refreshCard(r); fillInspector(); loadPreview(); refreshStatus();
  toast(t('toastTxReplaced', { name: nameOf(r.item, r.en), file: res.written }), 'success', 6000);
}
async function resetSel() {
  const r = xState.sel; if (!r || !r.en.replaced) return;
  const { tsvDir, outDir } = dirs();
  const res = await window.kh1.textures.reset({ rel: r.item.rel, index: r.en.index, kind: r.item.kind, tsvDir, outDir });
  if (!res || !res.ok) { toast(t('toastError', { msg: (res && res.error) || '?' }), 'error', 8000); return; }
  r.en.replaced = false;
  refreshCard(r); fillInspector(); loadPreview(); refreshStatus();
  toast(t('toastTxReset', { name: nameOf(r.item, r.en) }), 'success', 4000);
}
async function exportAll(one) {
  const r = one ? xState.sel : null;
  if (one && !r) return;
  const res = await window.kh1.textures.export(Object.assign({ defaultDir: xState.lastDir, tsvDir: dirs().tsvDir }, r ? { rel: r.item.rel, kind: r.item.kind, index: r.en.index } : {}));
  if (!res || res.canceled) return;
  if (!res.ok) { toast(t('toastError', { msg: res.error || '?' }), 'error', 8000); return; }
  xState.lastDir = res.dir; try { localStorage.setItem('kh.tx.lastDir', res.dir); } catch (_) {}
  toast(t('toastTxExported', { n: res.count, dir: res.dir }) + (res.errors && res.errors.length ? ' · ' + res.errors.slice(0, 2).join('; ') : ''), res.errors && res.errors.length ? 'warn' : 'success', 7000);
}
async function importDir() {
  const { tsvDir, outDir } = dirs();
  if (!tsvDir || !outDir) { toast(t('txNoDirs'), 'error'); return; }
  const res = await window.kh1.textures.importDir({ defaultDir: xState.lastDir, tsvDir, outDir });
  if (!res || res.canceled) return;
  if (!res.ok) { toast(t('toastError', { msg: res.error || '?' }), 'error', 8000); return; }
  xState.lastDir = res.dir; try { localStorage.setItem('kh.tx.lastDir', res.dir); } catch (_) {}
  toast(t('toastTxImported', { found: res.found, n: res.count, same: res.unchanged }) + (res.errors.length ? ' · ' + res.errors.slice(0, 3).join('; ') : ''), res.errors.length ? 'warn' : 'success', 8000);
  await scanTextures(true);
}

// ---- скан ----
export async function scanTextures(keepSel) {
  if (xState.busy) return;
  xState.busy = true; ui.scan.disabled = true; refreshStatus();
  try {
    const r = await window.kh1.textures.scan({ tsvDir: dirs().tsvDir });
    if (!r || !r.ok) { toast(t('toastError', { msg: (r && r.error) || '?' }), 'error', 8000); return; }
    xState.items = r.items;
    const selKey = keepSel && xState.sel ? keyOf(xState.sel.item, xState.sel.en) : null;
    xState.sel = null;
    fillFolders(); rebuildRows();
    if (selKey) { const row = xState.rows.find(x => keyOf(x.item, x.en) === selKey); if (row) select(row); }
    else fillInspector();
    toast(t('toastTxScanned', { files: r.stats.files, total: r.stats.textures, replaced: r.stats.replaced }), 'success', 5000);
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
  finally { xState.busy = false; ui.scan.disabled = false; refreshStatus(); }
}

export function initTextures() {
  ui.scan = el('tx-scan'); ui.filter = el('tx-filter'); ui.search = el('tx-search'); ui.folder = el('tx-folder');
  ui.exportAll = el('tx-export-all'); ui.importDir = el('tx-import-dir');
  ui.grid = el('tx-grid'); ui.count = el('tx-count'); ui.size = el('tx-size');
  ui.preview = el('tx-preview'); ui.previewWrap = el('tx-preview-wrap'); ui.previewEmpty = el('tx-preview-empty'); ui.checker = el('tx-checker');
  ui.zoomIn = el('tx-zoom-in'); ui.zoomOut = el('tx-zoom-out'); ui.zoomVal = el('tx-zoom-val');
  ui.replace = el('tx-replace'); ui.reset = el('tx-reset'); ui.exportOne = el('tx-export-one'); ui.reveal = el('tx-reveal');
  ui.selName = el('tx-sel-name'); ui.selInfo = el('tx-sel-info');
  ui.status = el('tx-status'); ui.info = el('tx-info'); ui.state = el('tx-status-state'); ui.dot = el('tx-status-dot');
  if (!ui.grid) return;
  try { xState.lastDir = localStorage.getItem('kh.tx.lastDir') || ''; } catch (_) {}
  ui.scan.addEventListener('click', () => scanTextures(true));
  ui.filter.addEventListener('change', () => { xState.filter = ui.filter.value; rebuildRows(); });
  let st = null;
  ui.search.addEventListener('input', () => { if (st) clearTimeout(st); st = setTimeout(() => { xState.search = ui.search.value; rebuildRows(); }, 120); });
  ui.folder.addEventListener('change', () => { xState.folder = ui.folder.value; rebuildRows(); });
  ui.size.addEventListener('change', () => { xState.thumb = parseInt(ui.size.value, 10) || 180; rebuildRows(); });
  ui.exportAll.addEventListener('click', () => exportAll(false));
  ui.importDir.addEventListener('click', importDir);
  ui.replace.addEventListener('click', replaceSel);
  ui.reset.addEventListener('click', resetSel);
  ui.exportOne.addEventListener('click', () => exportAll(true));
  ui.reveal.addEventListener('click', async () => { const r = xState.sel; if (!r) return; const res = await window.kh1.textures.reveal({ rel: r.item.rel, outDir: dirs().outDir }); if (res && !res.ok) toast(res.error, 'error'); });
  ui.zoomIn.addEventListener('click', () => zoomStep(1));
  ui.zoomOut.addEventListener('click', () => zoomStep(-1));
  ui.zoomVal.addEventListener('click', () => { xState.zoom = 0; applyZoom(); });
  ui.checker.addEventListener('change', () => ui.previewWrap.classList.toggle('checker', ui.checker.checked));
  window.addEventListener('resize', () => applyZoom());
  fillInspector(); refreshStatus();
}

// Перший показ вкладки — скануємо.
export function enterTextures() {
  if (!xState.items.length && !xState.busy) scanTextures(false);
  else applyZoom();
}
