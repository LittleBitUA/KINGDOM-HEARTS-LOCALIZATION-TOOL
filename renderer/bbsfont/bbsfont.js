import { toast } from '../core/log.js';

// =====================================================================
// BBS Font Editor — окрема вкладка для редагування .cod-файлів BBS-шрифтів.
// Workflow: вибираєш теку розпакованого FontEn.arc → шрифт → бачиш атлас
// (HD PNG як фон) з grid-оверлеєм по COD-positions → клік на гліф → правиш
// X/Y/palette/width → save → COD перезаписується.
// =====================================================================
export const bfState = {
  arcDir: null,
  hdDir: null,
  fonts: [],          // [{name, infPath, codPath, mtxPath, cluPath}]
  current: null,      // {name, inf, entries, infPath, codPath}
  origEntries: null,  // для reset
  pngUrl: null,
  pngImg: null,
  selected: -1,
  dirty: false,
  zoom: 1,            // CSS scale factor (1 = native px)
  fitMode: false      // true = автопідгін під ширину контейнера
};
export const BF_ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

export const bfPickArcBtn  = document.getElementById('bf-pick-arc');
export const bfPickHdBtn   = document.getElementById('bf-pick-hd');
export const bfFontSel     = document.getElementById('bf-font-sel');
export const bfPngSel      = document.getElementById('bf-png-sel');
export const bfAddBtn      = document.getElementById('bf-add');
export const bfDelBtn      = document.getElementById('bf-del');
export const bfResetBtn    = document.getElementById('bf-reset');
export const bfSaveBtn     = document.getElementById('bf-save');
export const bfZoomInBtn   = document.getElementById('bf-zoom-in');
export const bfZoomOutBtn  = document.getElementById('bf-zoom-out');
export const bfZoomResetBtn= document.getElementById('bf-zoom-reset');
export const bfZoomFitBtn  = document.getElementById('bf-zoom-fit');
export const bfExportOverlayBtn = document.getElementById('bf-export-overlay');
export const bfAtlasWrap   = document.getElementById('bf-atlas-wrap');
export const bfFields      = document.getElementById('bf-fields');
export const bfList        = document.getElementById('bf-list');
export const bfStatus      = document.getElementById('bf-status');
export const bfInfo        = document.getElementById('bf-info');
export const bfFNoSel      = document.getElementById('bf-no-selection') || null;
export const bfFIndex      = document.getElementById('bf-f-index');
export const bfFId         = document.getElementById('bf-f-id');
export const bfFChar       = document.getElementById('bf-f-char');
export const bfFX          = document.getElementById('bf-f-x');
export const bfFY          = document.getElementById('bf-f-y');
export const bfFPal        = document.getElementById('bf-f-pal');
export const bfFWidth      = document.getElementById('bf-f-width');

export function bfHex2(n) { return '0x' + n.toString(16).toUpperCase().padStart(4, '0'); }
export function bfCharFromId(id) {
  // Декодуємо "видимий" символ з charID — для відображення.
  // ASCII (0x20-0x7E): id безпосередньо ASCII.
  // 0x81xx / 0x82xx etc — спробуємо спитати CTD-codec якщо є.
  const lo = id & 0xFF;
  const hi = (id >> 8) & 0xFF;
  if (hi === 0x00 && lo >= 0x20 && lo < 0x7F) return String.fromCharCode(lo);
  // 2-byte: low byte зазвичай ASCII-наступник
  if ((hi === 0x81 || hi === 0x82) && lo >= 0x40 && lo < 0xFF) {
    // Heuristic: 0x82 0x40+i → ASCII letters
    return '';  // нема надійного маппінгу, показуємо порожньо
  }
  return '';
}

export function bfRefreshButtons() {
  if (bfPickHdBtn) bfPickHdBtn.disabled = !bfState.arcDir;
  if (bfFontSel)   bfFontSel.disabled = !bfState.fonts.length;
  if (bfPngSel)    bfPngSel.disabled = !bfState.hdDir;
  if (bfResetBtn)  bfResetBtn.disabled = !bfState.dirty;
  if (bfSaveBtn)   bfSaveBtn.disabled = !bfState.dirty;
  if (bfExportOverlayBtn) bfExportOverlayBtn.disabled = !bfState.current;
}

export function bfSetStatus(text) { if (bfStatus) bfStatus.textContent = text || ''; }
export function bfSetInfo(text)   { if (bfInfo)   bfInfo.textContent   = text || ''; }

if (bfPickArcBtn) bfPickArcBtn.addEventListener('click', async () => {
  const r = await window.kh1.bbsfont.pickArcDir();
  if (r.canceled) return;
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.arcDir = r.dir;
  bfSetStatus(r.dir);
  // Заповнюємо список шрифтів
  const lr = await window.kh1.bbsfont.listFonts(r.dir);
  if (lr.error) { toast(lr.error, 'error'); return; }
  bfState.fonts = lr.fonts || [];
  while (bfFontSel.firstChild) bfFontSel.removeChild(bfFontSel.firstChild);
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '— виберіть шрифт —';
  bfFontSel.appendChild(blank);
  for (const f of bfState.fonts) {
    const o = document.createElement('option');
    o.value = f.name;
    o.textContent = f.name;
    bfFontSel.appendChild(o);
  }
  bfRefreshButtons();
  toast('Знайдено шрифтів: ' + bfState.fonts.length, 'success', 2500);
});

if (bfPickHdBtn) bfPickHdBtn.addEventListener('click', async () => {
  const r = await window.kh1.bbsfont.pickHdDir();
  if (r.canceled) return;
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.hdDir = r.dir;
  // Список PNG
  const lr = await window.kh1.bbsfont.listHdPngs(r.dir);
  if (lr.error) { toast(lr.error, 'error'); return; }
  while (bfPngSel.firstChild) bfPngSel.removeChild(bfPngSel.firstChild);
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '— без HD PNG —';
  bfPngSel.appendChild(blank);
  for (const png of (lr.pngs || [])) {
    const o = document.createElement('option');
    o.value = png;
    o.textContent = png.split(/[\\/]/).pop();
    bfPngSel.appendChild(o);
  }
  bfRefreshButtons();
});

if (bfFontSel) bfFontSel.addEventListener('change', async () => {
  const name = bfFontSel.value;
  const ff = bfState.fonts.find(f => f.name === name);
  if (!ff) return;
  // hdPngPath передаємо лише якщо вибрано в окремому селекторі
  const fontFiles = Object.assign({}, ff, { hdPngPath: bfPngSel && bfPngSel.value || null });
  const r = await window.kh1.bbsfont.loadFont(fontFiles);
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.current = { name: r.name, inf: r.inf, entries: r.entries, infPath: ff.infPath, codPath: ff.codPath };
  bfState.origEntries = JSON.parse(JSON.stringify(r.entries));
  bfState.pngUrl = r.pngDataUrl || null;
  bfState.pngImg = null;
  bfState.selected = -1;
  bfState.dirty = false;
  bfSetInfo(`${r.name} · ${r.entries.length} entries · ${r.inf.textureWidth}×${r.inf.textureHeight} (cell ${r.inf.charWidth}×${r.inf.charHeight})`);
  if (bfState.pngUrl) {
    const img = new Image();
    img.onload = () => { bfState.pngImg = img; bfRenderAtlas(); };
    img.src = bfState.pngUrl;
  }
  bfRenderAtlas();
  bfRenderList();
  bfRefreshButtons();
});

if (bfPngSel) bfPngSel.addEventListener('change', async () => {
  if (!bfState.current) return;
  // Перезавантажити поточний шрифт з новим HD PNG
  bfFontSel.dispatchEvent(new Event('change'));
});

export function bfRenderAtlas() {
  if (!bfState.current) return;
  const { inf, entries } = bfState.current;
  // INF.textureWidth/Height — це PER-BLOCK розміри (не total atlas).
  // Реальний атлас = 2× ширини (left + right halves для pal=0/pal=1).
  const totalW = inf.textureWidth * 2;
  const totalH = inf.textureHeight;
  const pngW = bfState.pngImg ? bfState.pngImg.width : totalW;
  const pngH = bfState.pngImg ? bfState.pngImg.height : totalH;
  const scaleX = pngW / totalW;
  const scaleY = pngH / totalH;
  const halfPngW = pngW / 2;        // = inf.textureWidth * scaleX

  bfAtlasWrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = pngW;
  canvas.height = pngH;
  canvas.style.imageRendering = 'pixelated';
  bfAtlasWrap.appendChild(canvas);
  bfApplyZoom(canvas, pngW, pngH);
  const ctx = canvas.getContext('2d');
  // Bg + PNG
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, pngW, pngH);
  if (bfState.pngImg) ctx.drawImage(bfState.pngImg, 0, 0);

  // Vertical separator (block 1 / block 2)
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(halfPngW, 0); ctx.lineTo(halfPngW, pngH); ctx.stroke();

  // Cell-grid overlay. Block = palette index (0 → left half, 1 → right half).
  // Рамка = повна клітина гліфа (charWidth × charHeight), не entry.width
  // (entry.width — це advance/visible, редагується у side-panel).
  const cellW = inf.charWidth  * scaleX;
  const cellH = inf.charHeight * scaleY;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const blockOffX = (e.palette === 1) ? halfPngW : 0;
    const px = e.posX * scaleX + blockOffX;
    const py = e.posY * scaleY;
    const isSel = (i === bfState.selected);
    ctx.strokeStyle = isSel ? 'rgba(255, 200, 0, 1)' : 'rgba(255, 215, 90, 0.25)';
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeRect(px, py, cellW, cellH);
  }

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) / rect.width * pngW;
    const cy = (ev.clientY - rect.top)  / rect.height * pngH;
    const isBlock2 = cx > halfPngW;
    const localX = isBlock2 ? cx - halfPngW : cx;
    // Знайти entry: блок = palette (0 → лівий, 1 → правий).
    let bestIdx = -1, bestDist = Infinity;
    const hitW = inf.charWidth  * scaleX;
    const hitH = inf.charHeight * scaleY;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const expectsBlock2 = (e.palette === 1);
      if (expectsBlock2 !== isBlock2) continue;
      const ex = e.posX * scaleX;
      const ey = e.posY * scaleY;
      const ew = hitW;
      const eh = hitH;
      if (localX >= ex && localX < ex + ew && cy >= ey && cy < ey + eh) {
        bfSelectEntry(i);
        return;
      }
      // fallback: nearest
      const dx = Math.max(0, ex - localX, localX - (ex + ew));
      const dy = Math.max(0, ey - cy,     cy - (ey + eh));
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx >= 0) bfSelectEntry(bestIdx);
  });
}

export function bfRenderList() {
  if (!bfState.current) return;
  const entries = bfState.current.entries;
  bfList.innerHTML = '';
  // Limit для performance — показуємо all але рендеримо частинами якщо потрібно
  const frag = document.createDocumentFragment();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const li = document.createElement('li');
    li.className = 'bf-list-item' + (i === bfState.selected ? ' selected' : '');
    li.dataset.index = String(i);
    li.textContent = `#${i}  ${bfHex2(e.id)}  ${bfCharFromId(e.id)}  (${e.posX},${e.posY})  w=${e.width}`;
    li.addEventListener('click', () => bfSelectEntry(i));
    frag.appendChild(li);
  }
  bfList.appendChild(frag);
}

export function bfSelectEntry(idx) {
  if (!bfState.current) return;
  if (idx < 0 || idx >= bfState.current.entries.length) return;
  bfState.selected = idx;
  const e = bfState.current.entries[idx];
  bfFields.classList.remove('hidden');
  bfFIndex.value = String(idx);
  bfFId.value    = bfHex2(e.id);
  bfFChar.value  = bfCharFromId(e.id);
  bfFX.value     = String(e.posX);
  bfFY.value     = String(e.posY);
  bfFPal.value   = String(e.palette);
  bfFWidth.value = String(e.width);
  bfRenderAtlas();
  bfRenderList();
  // scroll the selected item into view
  const sel = bfList.querySelector('.bf-list-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

export function bfRefreshSelectedListItem() {
  if (!bfState.current || bfState.selected < 0) return;
  const e = bfState.current.entries[bfState.selected];
  const li = bfList.querySelector(`.bf-list-item[data-index="${bfState.selected}"]`);
  if (li) li.textContent = `#${bfState.selected}  ${bfHex2(e.id)}  ${bfCharFromId(e.id)}  (${e.posX},${e.posY})  w=${e.width}`;
}

// === Zoom ===
export function bfApplyZoom(canvas, pngW, pngH) {
  let z = bfState.zoom;
  if (bfState.fitMode) {
    const wrapW = Math.max(1, bfAtlasWrap.clientWidth - 16); // padding
    z = wrapW / pngW;
    bfState.zoom = z;
  }
  canvas.style.width  = (pngW * z) + 'px';
  canvas.style.height = (pngH * z) + 'px';
  canvas.style.maxWidth = 'none';
  bfUpdateZoomLabel();
}
export function bfUpdateZoomLabel() {
  if (bfZoomResetBtn) bfZoomResetBtn.textContent = Math.round(bfState.zoom * 100) + '%';
}
export function bfSetZoom(z, anchor) {
  // anchor: optional {clientX, clientY} — keep that point under cursor
  z = Math.max(0.1, Math.min(16, z));
  const wrap = bfAtlasWrap;
  const canvas = wrap.querySelector('canvas');
  let preserve = null;
  if (anchor && canvas) {
    const rect = canvas.getBoundingClientRect();
    const fx = (anchor.clientX - rect.left) / rect.width;   // 0..1 within canvas
    const fy = (anchor.clientY - rect.top)  / rect.height;
    const oldScrollLeft = wrap.scrollLeft;
    const oldScrollTop  = wrap.scrollTop;
    const oldW = rect.width, oldH = rect.height;
    preserve = { fx, fy, oldScrollLeft, oldScrollTop, oldW, oldH };
  }
  bfState.zoom = z;
  bfState.fitMode = false;
  if (canvas && bfState.current) {
    const { inf } = bfState.current;
    const totalW = inf.textureWidth * 2;
    const pngW = bfState.pngImg ? bfState.pngImg.width : totalW;
    const pngH = bfState.pngImg ? bfState.pngImg.height : inf.textureHeight;
    bfApplyZoom(canvas, pngW, pngH);
    if (preserve) {
      const newW = pngW * z, newH = pngH * z;
      // canvas top-left x within wrap (in wrap's content coords) == canvas.offsetLeft - wrap.offsetLeft? simpler:
      // anchor pixel within canvas BEFORE = preserve.fx * oldW; want it under same viewport position
      // viewport x of anchor = anchor.clientX - wrap.clientLeft; should remain same
      const wrapRect = wrap.getBoundingClientRect();
      const viewportX = anchor.clientX - wrapRect.left;
      const viewportY = anchor.clientY - wrapRect.top;
      wrap.scrollLeft = preserve.fx * newW - viewportX + (wrap.clientLeft || 0);
      wrap.scrollTop  = preserve.fy * newH - viewportY + (wrap.clientLeft || 0);
    }
  }
  bfUpdateZoomLabel();
}
export function bfZoomStep(direction, anchor) {
  const cur = bfState.zoom;
  let idx = BF_ZOOM_STEPS.findIndex(s => s >= cur - 1e-6);
  if (idx < 0) idx = BF_ZOOM_STEPS.length - 1;
  if (direction > 0) {
    idx = Math.min(BF_ZOOM_STEPS.length - 1, (BF_ZOOM_STEPS[idx] > cur + 1e-6) ? idx : idx + 1);
  } else {
    idx = Math.max(0, idx - 1);
  }
  bfSetZoom(BF_ZOOM_STEPS[idx], anchor);
}
if (bfZoomInBtn)    bfZoomInBtn.addEventListener('click',  () => bfZoomStep(+1));
if (bfZoomOutBtn)   bfZoomOutBtn.addEventListener('click', () => bfZoomStep(-1));
if (bfZoomResetBtn) bfZoomResetBtn.addEventListener('click', () => bfSetZoom(1));
if (bfZoomFitBtn)   bfZoomFitBtn.addEventListener('click', () => {
  bfState.fitMode = true;
  bfRenderAtlas();
});
if (bfAtlasWrap) {
  bfAtlasWrap.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    bfZoomStep(ev.deltaY < 0 ? +1 : -1, { clientX: ev.clientX, clientY: ev.clientY });
  }, { passive: false });
}

// === Export overlay (rectangles only) як прозорий PNG ===
if (bfExportOverlayBtn) bfExportOverlayBtn.addEventListener('click', () => {
  if (!bfState.current) return;
  const { inf, entries } = bfState.current;
  const totalW = inf.textureWidth * 2;
  const totalH = inf.textureHeight;
  const pngW = bfState.pngImg ? bfState.pngImg.width : totalW;
  const pngH = bfState.pngImg ? bfState.pngImg.height : totalH;
  const scaleX = pngW / totalW;
  const scaleY = pngH / totalH;
  const halfPngW = pngW / 2;

  const off = document.createElement('canvas');
  off.width = pngW;
  off.height = pngH;
  const ctx = off.getContext('2d');
  // прозорий фон — нічого не малюємо
  // Розділювач блоків (червоний, тонкий)
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(halfPngW + 0.5, 0); ctx.lineTo(halfPngW + 0.5, pngH); ctx.stroke();
  // Рамки гліфів = повна клітина (charWidth × charHeight)
  ctx.strokeStyle = 'rgba(255, 215, 90, 1)';
  ctx.lineWidth = 1;
  const cellW = Math.round(inf.charWidth  * scaleX);
  const cellH = Math.round(inf.charHeight * scaleY);
  for (const e of entries) {
    const blockOffX = (e.palette === 1) ? halfPngW : 0;
    const x = Math.round(e.posX * scaleX + blockOffX) + 0.5;
    const y = Math.round(e.posY * scaleY) + 0.5;
    ctx.strokeRect(x, y, cellW, cellH);
  }

  off.toBlob((blob) => {
    if (!blob) { toast('PNG export failed', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bfState.current.name}-overlay-${pngW}x${pngH}.png`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }, 'image/png');
});

export function bfBindFieldEdit(input, key, parser) {
  input.addEventListener('input', () => {
    if (!bfState.current || bfState.selected < 0) return;
    const e = bfState.current.entries[bfState.selected];
    const v = parser(input.value);
    if (Number.isNaN(v) || v == null) return;
    e[key] = v;
    bfState.dirty = true;
    bfRefreshButtons();
    bfRenderAtlas();
    bfRefreshSelectedListItem();
  });
}
if (bfFX)     bfBindFieldEdit(bfFX,     'posX',    s => parseInt(s, 10));
if (bfFY)     bfBindFieldEdit(bfFY,     'posY',    s => parseInt(s, 10));
if (bfFPal)   bfBindFieldEdit(bfFPal,   'palette', s => parseInt(s, 10));
if (bfFWidth) bfBindFieldEdit(bfFWidth, 'width',   s => parseInt(s, 10));
if (bfFId)    bfBindFieldEdit(bfFId,    'id',      s => {
  const m = String(s).trim().match(/^0x([0-9a-fA-F]{1,4})$/);
  return m ? parseInt(m[1], 16) : NaN;
});

// === Add / Delete entry ===
if (bfAddBtn) bfAddBtn.addEventListener('click', () => {
  if (!bfState.current) return;
  const newEntry = { index: bfState.current.entries.length, id: 0, posX: 0, posY: 0, palette: 0, width: 0 };
  bfState.current.entries.push(newEntry);
  bfState.dirty = true;
  bfRenderList();
  bfSelectEntry(bfState.current.entries.length - 1);
  bfRefreshButtons();
});

if (bfDelBtn) bfDelBtn.addEventListener('click', () => {
  if (!bfState.current || bfState.selected < 0) return;
  if (!window.confirm('Видалити entry #' + bfState.selected + ' з COD?')) return;
  bfState.current.entries.splice(bfState.selected, 1);
  bfState.dirty = true;
  bfState.selected = -1;
  bfFields.classList.add('hidden');
  bfRenderAtlas();
  bfRenderList();
  bfRefreshButtons();
});

if (bfResetBtn) bfResetBtn.addEventListener('click', () => {
  if (!bfState.current || !bfState.origEntries) return;
  if (!window.confirm('Скинути всі зміни до завантажених значень?')) return;
  bfState.current.entries = JSON.parse(JSON.stringify(bfState.origEntries));
  bfState.dirty = false;
  bfState.selected = -1;
  bfFields.classList.add('hidden');
  bfRenderAtlas();
  bfRenderList();
  bfRefreshButtons();
});

if (bfSaveBtn) bfSaveBtn.addEventListener('click', async () => {
  if (!bfState.current) return;
  const r = await window.kh1.bbsfont.saveCod({
    codPath: bfState.current.codPath,
    entries: bfState.current.entries
  });
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.origEntries = JSON.parse(JSON.stringify(bfState.current.entries));
  bfState.dirty = false;
  bfRefreshButtons();
  toast(`Збережено: ${r.byteLength} байт у ${bfState.current.codPath}`, 'success', 4000);
});

