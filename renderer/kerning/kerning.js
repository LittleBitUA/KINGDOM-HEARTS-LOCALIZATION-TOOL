import { toast } from '../core/log.js';
import { state } from '../core/state.js';

// =====================================================================
// Kerning Editor (.knj) — окремий режим з DDS-атласом
// =====================================================================
export const ATLAS_W = 1024;
export const ATLAS_H = 1024;
export const CELL_W = 48;
export const CELL_H = 64;
export const COLS = Math.floor(ATLAS_W / CELL_W); // 21
export const ROWS = Math.floor(ATLAS_H / CELL_H); // 16
export const MAX_GLYPHS = 230;
export const KERNING_OFFSET = 0x40080;
export const SCALE = 2; // canvas рендериться у 2x для чіткості та зручності drag

export const kState = {
  knjPath: null,
  knjBuf: null,        // Uint8Array — повний файл
  ddsPath: null,
  atlasPx: null,       // Uint8ClampedArray RGBA для всього atlas (1024*1024*4)
  glyphs: [],          // { idx, x, y, byteValue, originalByte, canvas }
  dirty: false,
  filterText: '',
  charMap: null        // { byte: char } — завантажується через IPC
};

export async function kEnsureCharMap() {
  if (kState.charMap) return;
  try {
    const r = await window.kh1.app.getCharMap();
    if (r.ok) kState.charMap = r.map;
    else kState.charMap = {};
  } catch (_) { kState.charMap = {}; }
  _kReverseCharMap = null;   // буде перебудовано при першому пошуку за символом
}

export function kGlyphLabel(idx) {
  const byte = idx + BYTE_GLYPH_OFFSET;
  let ch = kState.charMap ? kState.charMap[byte] : '';
  if (typeof ch !== 'string' || !ch) return '#' + idx;
  // Ховаємо технічні токени типу {Potion}, {III} — для них char = '{...}'
  if (ch.length > 1 && ch.startsWith('{')) return '#' + idx;
  return '#' + idx + ' (' + ch + ')';
}

export const kLoadKnjBtn = document.getElementById('k-load-knj');
export const kLoadDdsBtn = document.getElementById('k-load-dds');
export const kSaveKnjBtn = document.getElementById('k-save-knj');
export const kResetBtn = document.getElementById('k-reset-changes');
export const kAutoFitBtn = document.getElementById('k-autofit');
export const kThresholdInput = document.getElementById('k-threshold');
export function kCurrentThreshold() {
  if (!kThresholdInput) return 96;
  const v = parseInt(kThresholdInput.value, 10);
  if (!Number.isFinite(v)) return 96;
  return Math.max(1, Math.min(255, v));
}
export const kFilter = document.getElementById('k-filter');
export const kGridWrap = document.getElementById('k-grid-wrap');
export const kStatus = document.getElementById('k-status');
export const kInfo = document.getElementById('k-info');
export const kPreviewText = document.getElementById('k-preview-text');
export const kPreviewCanvas = document.getElementById('k-preview-canvas');
export const kPreviewBg = document.getElementById('k-preview-bg');
export const kPreviewInfo = document.getElementById('k-preview-info');

// Перерендерити preview, коли canvas змінює CSS-ширину (resize вікна,
// перемикання режиму, перший показ після прихованого стану).
if (kPreviewCanvas && typeof ResizeObserver !== 'undefined') {
  let _kRO = null;
  const _kROCb = () => {
    const w = Math.max(1, kPreviewCanvas.clientWidth);
    if (w !== _kPreviewLastW) {
      kRenderPreview();
    }
  };
  _kRO = new ResizeObserver(_kROCb);
  _kRO.observe(kPreviewCanvas);
}

export function kFilenameFromPath(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

// --- DDS decoding ---
export function decodeDds(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 128) throw new Error('DDS файл закороткий');
  if (!(u8[0] === 0x44 && u8[1] === 0x44 && u8[2] === 0x53 && u8[3] === 0x20)) {
    throw new Error('Це не DDS-файл (нема магії "DDS ")');
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const height = dv.getUint32(0x0C, true);
  const width = dv.getUint32(0x10, true);
  const pfFlags = dv.getUint32(0x50, true);
  const fourCC = String.fromCharCode(u8[0x54], u8[0x55], u8[0x56], u8[0x57]);
  const bitCount = dv.getUint32(0x58, true);
  const rMask = dv.getUint32(0x5C, true);
  const gMask = dv.getUint32(0x60, true);
  const bMask = dv.getUint32(0x64, true);
  const aMask = dv.getUint32(0x68, true);

  // Uncompressed RGB/RGBA (фізичний формат у нашому кейсі)
  if ((pfFlags & 0x40) && bitCount === 32) {
    const expected = 128 + width * height * 4;
    if (u8.length < expected) {
      throw new Error('DDS дані обірвані: чекали ' + expected + ', отримано ' + u8.length);
    }
    return decodeUncompressed32(u8, width, height, rMask, gMask, bMask, aMask);
  }
  // FourCC compressed
  if (pfFlags & 0x4) {
    if (fourCC === 'DXT5' || fourCC === 'DXT4' || fourCC === 'NVT3') {
      return decodeBC3(u8.subarray(128), width, height);
    }
    if (fourCC === 'DXT1') {
      return decodeBC1(u8.subarray(128), width, height);
    }
    throw new Error('Непідтримуваний DDS fourCC: ' + fourCC);
  }
  throw new Error('Невідомий DDS pixel format (flags=0x' + pfFlags.toString(16) + ')');
}

export function decodeUncompressed32(u8, w, h, rMask, gMask, bMask, aMask) {
  const px = new Uint8ClampedArray(w * h * 4);
  // Знайти shift для кожної маски
  const shiftOf = (m) => { let s = 0; while (m && !(m & 1)) { m >>>= 1; s++; } return s; };
  const rs = shiftOf(rMask), gs = shiftOf(gMask), bs = shiftOf(bMask), as = shiftOf(aMask);
  for (let i = 0; i < w * h; i++) {
    const off = 128 + i * 4;
    const v = u8[off] | (u8[off+1] << 8) | (u8[off+2] << 16) | (u8[off+3] << 24);
    const dst = i * 4;
    px[dst]   = (v & rMask) >>> rs;
    px[dst+1] = (v & gMask) >>> gs;
    px[dst+2] = (v & bMask) >>> bs;
    px[dst+3] = aMask ? ((v & aMask) >>> as) : 255;
  }
  return { width: w, height: h, data: px };
}

export function decodeBC3(data, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  const blocksW = w >> 2, blocksH = h >> 2;
  let pos = 0;
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      // 8 байт alpha
      const a0 = data[pos], a1 = data[pos+1];
      const aBits = data[pos+2] | (data[pos+3] << 8) | (data[pos+4] << 16) |
                    (data[pos+5] << 24) | (data[pos+6] * 0x100000000) | (data[pos+7] * 0x10000000000);
      const alphas = new Uint8Array(8);
      alphas[0] = a0; alphas[1] = a1;
      if (a0 > a1) {
        for (let k = 1; k < 7; k++) alphas[k+1] = ((7 - k) * a0 + k * a1) / 7 | 0;
      } else {
        for (let k = 1; k < 5; k++) alphas[k+1] = ((5 - k) * a0 + k * a1) / 5 | 0;
        alphas[6] = 0; alphas[7] = 255;
      }
      // 8 байт color (DXT1 logic)
      const c0 = data[pos+8] | (data[pos+9] << 8);
      const c1 = data[pos+10] | (data[pos+11] << 8);
      const cBits = data[pos+12] | (data[pos+13] << 8) | (data[pos+14] << 16) | (data[pos+15] << 24);
      const r0 = ((c0 >> 11) & 0x1F) << 3, g0 = ((c0 >> 5) & 0x3F) << 2, b0 = (c0 & 0x1F) << 3;
      const r1 = ((c1 >> 11) & 0x1F) << 3, g1 = ((c1 >> 5) & 0x3F) << 2, b1 = (c1 & 0x1F) << 3;
      const colors = [
        [r0, g0, b0], [r1, g1, b1],
        [(2*r0 + r1)/3 | 0, (2*g0 + g1)/3 | 0, (2*b0 + b1)/3 | 0],
        [(r0 + 2*r1)/3 | 0, (g0 + 2*g1)/3 | 0, (b0 + 2*b1)/3 | 0]
      ];
      for (let py = 0; py < 4; py++) {
        for (let px4 = 0; px4 < 4; px4++) {
          const ci = (cBits >> ((py * 4 + px4) * 2)) & 0x3;
          // BC3 alpha: 3 bit per pixel в 48-bit aBits
          const ai = Number((BigInt(data[pos+2] | (data[pos+3]<<8) | (data[pos+4]<<16))
                            | (BigInt(data[pos+5] | (data[pos+6]<<8) | (data[pos+7]<<16)) << 24n))
                          >> BigInt((py * 4 + px4) * 3)) & 0x7;
          const c = colors[ci];
          const dx = bx * 4 + px4, dy = by * 4 + py;
          const dst = (dy * w + dx) * 4;
          px[dst] = c[0]; px[dst+1] = c[1]; px[dst+2] = c[2]; px[dst+3] = alphas[ai];
        }
      }
      pos += 16;
    }
  }
  return { width: w, height: h, data: px };
}

export function decodeBC1(data, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  const blocksW = w >> 2, blocksH = h >> 2;
  let pos = 0;
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      const c0 = data[pos] | (data[pos+1] << 8);
      const c1 = data[pos+2] | (data[pos+3] << 8);
      const cBits = data[pos+4] | (data[pos+5] << 8) | (data[pos+6] << 16) | (data[pos+7] << 24);
      const r0 = ((c0 >> 11) & 0x1F) << 3, g0 = ((c0 >> 5) & 0x3F) << 2, b0 = (c0 & 0x1F) << 3;
      const r1 = ((c1 >> 11) & 0x1F) << 3, g1 = ((c1 >> 5) & 0x3F) << 2, b1 = (c1 & 0x1F) << 3;
      const colors = c0 > c1
        ? [[r0,g0,b0],[r1,g1,b1],[(2*r0+r1)/3|0,(2*g0+g1)/3|0,(2*b0+b1)/3|0],[(r0+2*r1)/3|0,(g0+2*g1)/3|0,(b0+2*b1)/3|0]]
        : [[r0,g0,b0],[r1,g1,b1],[(r0+r1)/2|0,(g0+g1)/2|0,(b0+b1)/2|0],[0,0,0]];
      for (let py = 0; py < 4; py++) {
        for (let px4 = 0; px4 < 4; px4++) {
          const ci = (cBits >> ((py * 4 + px4) * 2)) & 0x3;
          const c = colors[ci];
          const dx = bx * 4 + px4, dy = by * 4 + py;
          const dst = (dy * w + dx) * 4;
          px[dst] = c[0]; px[dst+1] = c[1]; px[dst+2] = c[2]; px[dst+3] = 255;
        }
      }
      pos += 8;
    }
  }
  return { width: w, height: h, data: px };
}

// --- Renderer ---
export function kBuildGlyphList() {
  kState.glyphs = [];
  for (let i = 0; i < MAX_GLYPHS; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const byte = kState.knjBuf ? kState.knjBuf[KERNING_OFFSET + i] : 0;
    kState.glyphs.push({
      idx: i,
      x: col * CELL_W,
      y: row * CELL_H,
      byteValue: byte,
      originalByte: byte,
      canvas: null
    });
  }
}

export function kDrawGlyph(canvas, g) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Темне тло
  ctx.fillStyle = '#1a2848';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Atlas crop
  if (kState.atlasPx) {
    const w = kState.atlasPx.width, h = kState.atlasPx.height;
    const cellData = new ImageData(CELL_W, CELL_H);
    for (let row = 0; row < CELL_H; row++) {
      for (let col = 0; col < CELL_W; col++) {
        const sx = g.x + col, sy = g.y + row;
        if (sx >= w || sy >= h) continue;
        const srcOff = (sy * w + sx) * 4;
        const dstOff = (row * CELL_W + col) * 4;
        cellData.data[dstOff]   = kState.atlasPx.data[srcOff];
        cellData.data[dstOff+1] = kState.atlasPx.data[srcOff+1];
        cellData.data[dstOff+2] = kState.atlasPx.data[srcOff+2];
        cellData.data[dstOff+3] = kState.atlasPx.data[srcOff+3];
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = CELL_W; tmp.height = CELL_H;
    tmp.getContext('2d').putImageData(cellData, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }
  // Тонка вертикальна сітка кожні 8 px
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let px = 8; px < CELL_W; px += 8) {
    const x = px * SCALE;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  // Червона лінія advance-width = byteValue * 2 px
  const advancePx = g.byteValue * 2;
  const lineX = advancePx * SCALE + 0.5;
  ctx.strokeStyle = '#ff5566';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(255,80,100,0.7)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(lineX, 0);
  ctx.lineTo(lineX, canvas.height);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Жовта рамка якщо змінено
  if (g.byteValue !== g.originalByte) {
    ctx.strokeStyle = '#f4c430';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  }
}

export function kAttachDrag(canvas, g, valueLabel, input) {
  function setFromX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const localX = (clientX - rect.left) / rect.width * canvas.width;
    let advancePx = Math.round(localX / SCALE);
    if (advancePx < 0) advancePx = 0;
    let byte = Math.round(advancePx / 2);
    if (byte > 24) byte = 24;
    if (byte < 0) byte = 0;
    if (g.byteValue !== byte) {
      g.byteValue = byte;
      kState.knjBuf[KERNING_OFFSET + g.idx] = byte;
      kState.dirty = true;
      input.value = byte;
      valueLabel.textContent = (byte * 2) + ' px (b=' + byte + ')';
      kDrawGlyph(canvas, g);
      kRefreshStatus();
      kSchedulePreview();
    }
  }
  let dragging = false;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    setFromX(e.clientX);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (dragging) setFromX(e.clientX);
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

// Lazy reverse charMap { char → byte }. Будується з kState.charMap при першому
// зверненні; kEnsureCharMap гарантує що kState.charMap не null до цього моменту.
export let _kReverseCharMap = null;
export function _kRebuildReverseCharMap() {
  _kReverseCharMap = Object.create(null);
  if (!kState.charMap) return;
  for (const k of Object.keys(kState.charMap)) {
    const ch = kState.charMap[k];
    if (typeof ch === 'string' && ch.length === 1 && !_kReverseCharMap[ch]) {
      _kReverseCharMap[ch] = parseInt(k, 10);
    }
  }
}
export function _kCharToGlyphIdx(ch) {
  if (!_kReverseCharMap) _kRebuildReverseCharMap();
  const byte = _kReverseCharMap[ch];
  if (typeof byte !== 'number') return -1;
  return byte - BYTE_GLYPH_OFFSET;
}

export function kParseFilter(text) {
  // Підтримує:
  //   • числові індекси/діапазони:  "0-50, 100, 120-130"
  //   • літерали символів:          "Q", "Q a 5", "AB" (кожен символ окремо)
  // Числове і символьне можна змішувати: "0-32 Q a 100-110".
  if (!text || !text.trim()) return null;
  const set = new Set();
  for (const part of text.split(/[,\s]+/)) {
    if (!part) continue;
    const numMatch = part.match(/^(\d+)(?:-(\d+))?$/);
    if (numMatch) {
      const a = parseInt(numMatch[1], 10);
      const b = numMatch[2] ? parseInt(numMatch[2], 10) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
      continue;
    }
    // Не число — інтерпретуємо кожен символ як гліф
    for (const ch of Array.from(part)) {
      const idx = _kCharToGlyphIdx(ch);
      if (idx >= 0) set.add(idx);
    }
  }
  return set.size ? set : null;
}

export function kRenderGrid() {
  kGridWrap.innerHTML = '';
  if (!kState.knjBuf) {
    kGridWrap.innerHTML = '<div class="t-empty"><p>Спершу завантажте .knj-файл.</p></div>';
    return;
  }
  // ensure charMap loaded asynchronously; if not yet, draw now and re-render after fetch
  if (!kState.charMap) {
    kEnsureCharMap().then(() => kRenderGrid());
  }
  const grid = document.createElement('div');
  grid.className = 'k-grid';
  const filter = kParseFilter(kState.filterText);
  for (const g of kState.glyphs) {
    if (filter && !filter.has(g.idx)) continue;
    const cell = document.createElement('div');
    cell.className = 'k-cell';
    cell.dataset.idx = g.idx;

    const canvas = document.createElement('canvas');
    canvas.width = CELL_W * SCALE;
    canvas.height = CELL_H * SCALE;
    canvas.className = 'k-canvas';
    g.canvas = canvas;

    const headLabel = document.createElement('div');
    headLabel.className = 'k-head';
    headLabel.textContent = kGlyphLabel(g.idx);

    const valueLabel = document.createElement('div');
    valueLabel.className = 'k-value';
    let labelText = (g.byteValue * 2) + ' px (b=' + g.byteValue + ')';
    if (kState.atlasPx) {
      const right = kFindGlyphRightEdge(g);
      if (right >= 0) labelText += ' · max=' + (right + 1) + 'px';
    }
    valueLabel.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '24';
    input.value = g.byteValue;
    input.className = 'k-input';
    input.addEventListener('input', () => {
      let v = parseInt(input.value, 10);
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, Math.min(24, v));
      if (g.byteValue !== v) {
        g.byteValue = v;
        kState.knjBuf[KERNING_OFFSET + g.idx] = v;
        kState.dirty = true;
        valueLabel.textContent = (v * 2) + ' px (b=' + v + ')';
        kDrawGlyph(canvas, g);
        kRefreshStatus();
        kSchedulePreview();
      }
    });

    cell.appendChild(headLabel);
    cell.appendChild(canvas);
    cell.appendChild(valueLabel);
    cell.appendChild(input);
    grid.appendChild(cell);

    kDrawGlyph(canvas, g);
    kAttachDrag(canvas, g, valueLabel, input);
  }
  kGridWrap.appendChild(grid);
}

export function kRefreshStatus() {
  const changed = kState.glyphs.filter(g => g.byteValue !== g.originalByte).length;
  kStatus.textContent = (kState.knjPath ? kFilenameFromPath(kState.knjPath) : 'не завантажено') +
    (kState.dirty ? ' *' : '') +
    ' · DDS: ' + (kState.atlasPx ? kFilenameFromPath(kState.ddsPath) : 'не завантажено');
  kInfo.textContent = 'Гліфів: ' + kState.glyphs.length + ' · змінено: ' + changed;
  kSaveKnjBtn.disabled = !kState.dirty;
  kResetBtn.disabled = changed === 0;
  if (kAutoFitBtn) kAutoFitBtn.disabled = !kState.knjBuf || !kState.atlasPx;
  // Live-preview потребує і .knj, і .dds — без них рендер canvas ні на що
  // не спирається. Disable + плейсхолдер краще, ніж дозволити друкувати у
  // нікуди (користувач не розуміє чому canvas мовчить).
  if (kPreviewText) {
    const ready = !!(kState.knjBuf && kState.atlasPx);
    kPreviewText.disabled = !ready;
    kPreviewText.placeholder = ready
      ? (window.i18n ? window.i18n.t('previewPlaceholder') : 'Live-preview: введіть текст…')
      : (window.i18n ? window.i18n.t('previewNeedKnj') : 'Спочатку завантажте .knj/.dds');
  }
}

export async function kApplyKnjLoaded(r, opts) {
  // Спільний код: оновити kState, перерендерити, запустити auto-find DDS.
  // opts.silent=true   — без toast'у про завантажений knj (для авто-load на старті).
  // opts.preferDds     — спочатку спробувати завантажити саме цей збережений шлях,
  //                       перш ніж шукати DDS поряд з .knj.
  kState.knjPath = r.filePath;
  kState.knjBuf = new Uint8Array(r.data);
  kState.dirty = false;
  kBuildGlyphList();
  kRenderGrid();
  kRefreshStatus();
  kSchedulePreview();
  if (!opts || !opts.silent) {
    toast(window.i18n.t('toastKnjLoaded', {file: kFilenameFromPath(r.filePath), n: r.data.byteLength}), 'success');
  }
  // 1) Спробувати збережений lastDdsPath (точний користувацький вибір)
  let ddsLoaded = false;
  if (opts && opts.preferDds) {
    try {
      const d = await window.kh1.kerning.loadDdsFromPath(opts.preferDds);
      if (d && d.ok) {
        kState.ddsPath = d.filePath;
        kState.atlasPx = decodeDds(d.data);
        ddsLoaded = true;
      }
    } catch (_) { /* провалюємось у autoFind */ }
  }
  // 2) Якщо збереженого нема або не вдалось — auto-find поряд з .knj
  if (!ddsLoaded) {
    try {
      const a = await window.kh1.kerning.autoFindDds(r.filePath);
      if (a.ok) {
        kState.ddsPath = a.filePath;
        kState.atlasPx = decodeDds(a.data);
        ddsLoaded = true;
        if (!opts || !opts.silent) {
          toast(window.i18n.t('toastKnjAutoDds', {file: kFilenameFromPath(a.filePath)}), 'info', 4000);
        }
      }
    } catch (e) {
      toast(window.i18n.t('toastKnjDdsFoundFail', {msg: e.message}), 'error', 6000);
    }
  }
  if (ddsLoaded) {
    kRenderGrid();
    kRefreshStatus();
    // Атлас тепер завантажений — перерендерити preview, щоб користувач
    // одразу бачив печатний текст замість "Завантажте .dds...".
    kSchedulePreview();
  }
}

export async function kLoadKnj() {
  try {
    const r = await window.kh1.kerning.openKnj();
    if (r.canceled) return;
    if (r.error || !r.ok) { toast(window.i18n.t('toastError', {msg: r.error || '?'}), 'error'); return; }
    await kApplyKnjLoaded(r);
  } catch (e) {
    toast(window.i18n.t('toastLoadError', {msg: e.message}), 'error');
  }
}

// Авто-завантаження останнього .knj + .dds зі settings на старті.
export async function kAutoLoadKnjOnBoot() {
  try {
    const settings = await window.kh1.translate.getSettings();
    if (!settings || !settings.lastKnjPath) return;
    const r = await window.kh1.kerning.loadKnjFromPath(settings.lastKnjPath);
    if (r && r.ok) {
      await kApplyKnjLoaded(r, { silent: false, preferDds: settings.lastDdsPath || null });
    }
  } catch (_) { /* тихо ігноруємо — користувач сам завантажить вручну */ }
}

export async function kLoadDds() {
  try {
    const suggestedDir = kState.knjPath ? kState.knjPath.substring(0, kState.knjPath.lastIndexOf(/[\\/]/.test(kState.knjPath) ? (kState.knjPath.match(/[\\/]/g) ? kState.knjPath.lastIndexOf(kState.knjPath.match(/[\\/]/g).pop()) : 0) : 0)) : null;
    const r = await window.kh1.kerning.openDds(kState.knjPath || undefined);
    if (r.canceled) return;
    if (r.error || !r.ok) { toast(window.i18n.t('toastError', {msg: r.error || '?'}), 'error'); return; }
    kState.ddsPath = r.filePath;
    try {
      kState.atlasPx = decodeDds(r.data);
    } catch (e) {
      toast(window.i18n.t('toastDdsDecodeFail', {msg: e.message}), 'error', 7000);
      kState.atlasPx = null;
      return;
    }
    kRenderGrid();
    kRefreshStatus();
    kSchedulePreview();
    toast(window.i18n.t('toastKnjDdsLoaded', {file: kFilenameFromPath(r.filePath), w: kState.atlasPx.width, h: kState.atlasPx.height}), 'success');
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error');
  }
}

export async function kSaveKnj() {
  if (!kState.knjBuf) return;
  try {
    const r = await window.kh1.kerning.saveKnj({
      suggestedPath: kState.knjPath || 'output.knj',
      data: kState.knjBuf.buffer.slice(kState.knjBuf.byteOffset, kState.knjBuf.byteOffset + kState.knjBuf.byteLength)
    });
    if (r.canceled) return;
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error'); return; }
    kState.dirty = false;
    for (const g of kState.glyphs) g.originalByte = g.byteValue;
    kState.knjPath = r.filePath;
    kRenderGrid();
    kRefreshStatus();
    kSchedulePreview();
    toast(window.i18n.t('toastSavedKnj', {path: r.filePath, n: r.byteLength}), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastSaveError', {msg: e.message}), 'error');
  }
}

// Знайти найправіший непрозорий піксел у тайлі гліфа.
// Повертає -1 якщо тайл порожній.
export function kFindGlyphRightEdge(g, alphaThreshold) {
  if (!kState.atlasPx) return -1;
  const w = kState.atlasPx.width, h = kState.atlasPx.height;
  const data = kState.atlasPx.data;
  const ax = g.x, ay = g.y;
  // Threshold з input (default 96) — ігнорує anti-aliased «тіні» на краях
  const thr = (typeof alphaThreshold === 'number') ? alphaThreshold : kCurrentThreshold();
  let rightmost = -1;
  for (let row = 0; row < CELL_H; row++) {
    const sy = ay + row;
    if (sy >= h) break;
    for (let col = CELL_W - 1; col > rightmost; col--) {
      const sx = ax + col;
      if (sx >= w) continue;
      const a = data[(sy * w + sx) * 4 + 3];
      if (a >= thr) { rightmost = col; break; }
    }
    if (rightmost === CELL_W - 1) break;
  }
  return rightmost;
}

// Повертає рекомендоване значення байту (0..24) для гліфа з ~1 px gap.
export function kSuggestAdvance(g) {
  const right = kFindGlyphRightEdge(g);
  if (right < 0) return 0; // порожній — пробіл-style 0 (або залишити як було?)
  const px = right + 2; // +1 px gap
  let byte = Math.round(px / 2);
  if (byte < 1) byte = 1;
  if (byte > 24) byte = 24;
  return byte;
}

export async function kAutoFitAll() {
  if (!kState.knjBuf) { toast(window.i18n.t('toastError', {msg: '.knj not loaded'}), 'error'); return; }
  if (!kState.atlasPx) { toast(window.i18n.t('toastNeedAtlas'), 'error'); return; }
  let changed = 0, kept = 0, empty = 0;
  for (const g of kState.glyphs) {
    const right = kFindGlyphRightEdge(g);
    if (right < 0) {
      // Порожній тайл — лишаємо як є
      empty++;
      continue;
    }
    const byte = kSuggestAdvance(g);
    if (byte !== g.byteValue) {
      g.byteValue = byte;
      kState.knjBuf[KERNING_OFFSET + g.idx] = byte;
      changed++;
    } else {
      kept++;
    }
  }
  if (changed > 0) kState.dirty = true;
  kRenderGrid();
  kRefreshStatus();
  kSchedulePreview();
  toast(window.i18n.t('toastAutoFitDone', { changed, kept, empty }), 'success', 5000);
}

export function kResetChanges() {
  for (const g of kState.glyphs) {
    if (g.byteValue !== g.originalByte) {
      g.byteValue = g.originalByte;
      kState.knjBuf[KERNING_OFFSET + g.idx] = g.byteValue;
    }
  }
  kState.dirty = false;
  kRenderGrid();
  kRefreshStatus();
  toast(window.i18n.t('toastResetDone'), 'info');
}

kLoadKnjBtn.addEventListener('click', kLoadKnj);
kLoadDdsBtn.addEventListener('click', kLoadDds);
kSaveKnjBtn.addEventListener('click', kSaveKnj);
kResetBtn.addEventListener('click', kResetChanges);
if (kAutoFitBtn) kAutoFitBtn.addEventListener('click', kAutoFitAll);
if (kThresholdInput) {
  kThresholdInput.addEventListener('change', () => {
    if (kState.knjBuf) kRenderGrid();
  });
}
kFilter.addEventListener('input', () => {
  kState.filterText = kFilter.value;
  kRenderGrid();
});

// =====================================================================
// Live-preview: encode text → KH1 bytes → render tiles with advance-width
// =====================================================================
export let _kPreviewTimer = null;
export function kSchedulePreview() {
  if (_kPreviewTimer) clearTimeout(_kPreviewTimer);
  _kPreviewTimer = setTimeout(kRenderPreview, 120);
}

// Atlas починається з byte 32 (перші 32 — control bytes, не мають гліфів)
export const BYTE_GLYPH_OFFSET = 32;
export function kComputeGlyphRect(byte) {
  const idx = byte - BYTE_GLYPH_OFFSET;
  if (idx < 0 || idx >= MAX_GLYPHS) return null;
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  return { x: col * CELL_W, y: row * CELL_H };
}

// Зберігаємо останньо-зрендерену ширину, щоб ResizeObserver міг визначити
// зміну CSS-розміру canvas і перерендерити (інакше буфер 1100px розтягується
// під CSS і текст виглядає кривим, поки користувач не змінить розмір вікна).
export let _kPreviewLastW = 0;
export async function kRenderPreview() {
  if (!kPreviewCanvas) return;
  const ctx = kPreviewCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Розтягнути canvas-px під реальну ширину
  const cssW = Math.max(1, kPreviewCanvas.clientWidth) || 1100;
  if (kPreviewCanvas.width !== cssW) kPreviewCanvas.width = cssW;
  _kPreviewLastW = cssW;
  ctx.clearRect(0, 0, kPreviewCanvas.width, kPreviewCanvas.height);

  const text = kPreviewText ? kPreviewText.value : '';
  if (!text) {
    ctx.fillStyle = '#9cb3d8';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(window.i18n.t('previewEmpty'), 12, 30);
    if (kPreviewInfo) kPreviewInfo.textContent = '—';
    return;
  }
  if (!kState.atlasPx) {
    ctx.fillStyle = '#fbbf24';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(window.i18n.t('previewNoAtlas'), 12, 30);
    return;
  }
  if (!kState.knjBuf) return;

  let bytes = [];
  try {
    const r = await window.kh1.kerning.encodeText(text);
    if (!r.ok) {
      ctx.fillStyle = '#f87171';
      ctx.font = '13px "Cascadia Code", monospace';
      ctx.fillText('encode error: ' + (r.error || '?'), 12, 30);
      return;
    }
    bytes = r.bytes;
  } catch (e) {
    ctx.fillStyle = '#f87171';
    ctx.fillText('IPC error: ' + e.message, 12, 30);
    return;
  }

  const SCALE_PV = 1.5; // 1.5x для читабельності
  const baselineY = (kPreviewCanvas.height - CELL_H * SCALE_PV) / 2;
  const atlasW = kState.atlasPx.width;
  let x = 8;
  let totalWidth = 0;
  let drawn = 0;
  const tmp = document.createElement('canvas');
  tmp.width = CELL_W; tmp.height = CELL_H;
  const tctx = tmp.getContext('2d');

  const SPACE_PX = 10; // фіксована ширина пробілу для preview
  for (const byte of bytes) {
    if (byte === 0x00) continue; // sentinel/end-of-string
    if (byte === 0x01) { // пробіл
      x += SPACE_PX * SCALE_PV;
      totalWidth += SPACE_PX;
      drawn++;
      if (x > kPreviewCanvas.width - CELL_W) break;
      continue;
    }
    if (byte === 0x02) { // {lf} — м'який перенос рядка, для preview просто зсуваємо
      x += SPACE_PX * SCALE_PV;
      continue;
    }
    const rect = kComputeGlyphRect(byte);
    if (!rect) continue;
    const glyphIdx = byte - BYTE_GLYPH_OFFSET;
    const advance = (kState.knjBuf[KERNING_OFFSET + glyphIdx] || 0) * 2;
    if (advance === 0) continue;
    // Витягуємо тайл
    const tile = new ImageData(CELL_W, CELL_H);
    for (let row = 0; row < CELL_H; row++) {
      for (let col = 0; col < CELL_W; col++) {
        const sx = rect.x + col, sy = rect.y + row;
        if (sx >= atlasW || sy >= kState.atlasPx.height) continue;
        const so = (sy * atlasW + sx) * 4;
        const dt = (row * CELL_W + col) * 4;
        tile.data[dt]   = kState.atlasPx.data[so];
        tile.data[dt+1] = kState.atlasPx.data[so+1];
        tile.data[dt+2] = kState.atlasPx.data[so+2];
        tile.data[dt+3] = kState.atlasPx.data[so+3];
      }
    }
    tctx.clearRect(0, 0, CELL_W, CELL_H);
    tctx.putImageData(tile, 0, 0);
    ctx.drawImage(tmp, x, baselineY, CELL_W * SCALE_PV, CELL_H * SCALE_PV);
    // Маркер advance — тонка червона лінія знизу
    const advanceX = x + advance * SCALE_PV;
    ctx.strokeStyle = 'rgba(255, 80, 100, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(advanceX, baselineY + CELL_H * SCALE_PV);
    ctx.lineTo(advanceX, baselineY + CELL_H * SCALE_PV + 6);
    ctx.stroke();
    x += advance * SCALE_PV;
    totalWidth += advance;
    drawn++;
    if (x > kPreviewCanvas.width - CELL_W) break;
  }
  if (kPreviewInfo) {
    kPreviewInfo.textContent = window.i18n.t('previewInfo', { n: drawn, w: totalWidth });
  }
}

if (kPreviewText) {
  kPreviewText.addEventListener('input', kSchedulePreview);
  // Initialize disabled state + placeholder за відсутністю knj/dds.
  kRefreshStatus();
}
// Re-render on window resize so canvas pixel-size matches CSS width (fixed-scale text)
window.addEventListener('resize', () => {
  if (state.mode === 'kerning') kSchedulePreview();
});
if (kPreviewBg) {
  kPreviewBg.addEventListener('change', () => {
    kPreviewCanvas.classList.toggle('transparent-bg', !kPreviewBg.checked);
  });
  // Init: dark by default
  kPreviewCanvas.classList.toggle('transparent-bg', !kPreviewBg.checked);
}

