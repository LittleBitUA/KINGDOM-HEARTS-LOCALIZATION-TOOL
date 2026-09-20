'use strict';

// «Хмаринки» Re:CoM: макети діалогових вікон у .ctdl (0x30 байтів на репліку:
// X/Y/W/H у px PS2, стиль, висота рядка, хвостик). Гра НЕ підганяє хмаринку під
// текст — розмір береться з макета, тож довший український рядок вилазить за
// край. Тут: скан усіх UK_*.ctdl → для кожного макета текст EN/UK, ширина
// рядків за .binl і пропозиція нової геометрії; правки зберігаються у
// PROGRESS/_bubbles.json і застосовуються при збірці (composeOneFile → ctdl).
//   bubbles:scan({ engDir, glossary }) → { files: [{ rel, items: [...] }], fonts }
//   bubbles:glyphs({ text, font })     → { lines: [[glyphIdx…]] } для preview
//   bubbles:load({ tsvDir }) / bubbles:save({ tsvDir, overrides })

const { ipcMain, app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsP = require('fs/promises');
const { writeFileAtomic } = require('../shared/safe-fs');
const { parseCtdl } = require('../tools/lib/recom-ctdl-format');
const codec = require('../tools/lib/recom-ctdl-codec');
const layout = require('../tools/lib/recom-ctdl-layout');
const { glossaryLookup } = require('../tools/lib/translate-ops');
const { parseHeader, locateFont } = require('./ipc-comkern');
const { loadSettingsRaw } = require('./settings');
const { findDirNamed } = require('./ipc-uafonts');

const BUBBLES_FILENAME = '_bubbles.json';
const bubblesPath = (tsvDir) => path.join(tsvDir, BUBBLES_FILENAME);

function walk(root) {
  const out = [];
  const rec = (dir, base) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) rec(path.join(dir, e.name), rel);
      else if (/^UK_.*\.ctdl$/i.test(e.name)) out.push(rel);
    }
  };
  rec(root, '');
  return out.sort();
}

async function loadFonts() {
  const fonts = {};
  for (const name of ['evtfont', 'sysfont']) {
    const loc = locateFont(name);
    if (!loc.ok) continue;
    try { fonts[name] = Object.assign(parseHeader(await fsP.readFile(loc.binlPath)), { binlPath: loc.binlPath, pngPath: loc.pngPath, source: loc.source }); } catch (_) {}
  }
  return fonts;
}
const fontFor = (fonts, lh) => (lh === 18 || lh === 15 || lh === 16 ? fonts.sysfont : fonts.evtfont) || fonts.evtfont || fonts.sysfont;

function widthsOf(text, font) {
  if (!font) return [0];
  let bytes;
  try { bytes = codec.encodeDetailed(text, { lenient: true }).bytes; } catch (_) { return [0]; }
  return layout.lineWidths(bytes, font, font.line || 26);
}

// bubbles:scan — усі макети всіх UK_*.ctdl з engDir; uk — з глосарію.
ipcMain.handle('bubbles:scan', async (_e, payload) => {
  const engDir = payload && payload.engDir;
  const glossary = (payload && payload.glossary) || {};
  if (!engDir || !fs.existsSync(engDir)) return { ok: false, error: 'Нема теки ENG/FILES' };
  const fonts = await loadFonts();
  if (!fonts.evtfont && !fonts.sysfont) return { ok: false, error: 'Не знайдено UK_evtfont.binl / UK_sysfont.binl (збірка шрифтів UA або розпакована гра)' };
  const files = [];
  let total = 0, over = 0, translated = 0;
  for (const rel of walk(engDir)) {
    let parsed;
    try { parsed = parseCtdl(await fsP.readFile(path.join(engDir, rel))); } catch (_) { continue; }
    if (!parsed.layouts.length) continue;
    const items = [];
    for (let li = 0; li < parsed.layouts.length; li++) {
      const L = layout.readLayout(parsed.layouts[li]);
      const font = fontFor(fonts, L.lineHeight);
      // сторінки: count послідовних повідомлень від msgId
      const pages = [];
      for (let j = 0; j < Math.max(1, L.count); j++) {
        const entry = parsed.entries[L.msgId + j];
        if (!entry) break;
        const en = entry.text;
        const uk = glossaryLookup(glossary, codec.glossaryKey(en)) || '';
        pages.push({ id: L.msgId + j, en, uk, enW: layout.lineWidths(entry.originalBytes, font, font.line || 26), ukW: uk ? widthsOf(uk, font) : null });
      }
      if (!pages.length) continue;
      // найширша сторінка визначає потрібну ширину; висота — за найбільшою кількістю рядків
      const widest = (arr) => arr.reduce((best, w) => (w && Math.max(...w) > Math.max(...best) ? w : best), arr.find(w => w) || [0]);
      const enW = widest(pages.map(pg => pg.enW));
      const ukPages = pages.filter(pg => pg.ukW);
      const ukW = ukPages.length ? widest(ukPages.map(pg => pg.ukW)) : null;
      const linesMax = (arr) => arr.reduce((m, w) => Math.max(m, w ? w.length : 0), 0);
      const enWH = enW.slice(); while (enWH.length < linesMax(pages.map(pg => pg.enW))) enWH.push(0);
      const ukWH = ukW ? ukW.slice() : null; if (ukWH) while (ukWH.length < linesMax(ukPages.map(pg => pg.ukW))) ukWH.push(0);
      const usable = layout.layoutUsable(L, enWH);
      const sug = ukWH && usable ? layout.suggestGeometry(L, enWH, ukWH) : null;
      const fit = ukW ? L.w - Math.max(...ukW) * layout.UNIT_PX : null;
      const uk = pages.some(pg => pg.uk);
      total++;
      if (uk) translated++;
      if (usable && fit != null && fit < layout.MIN_PAD) over++;
      items.push({ li, id: L.msgId, count: pages.length, pages, en: pages[0].en, uk: pages[0].uk, x: L.x, y: L.y, w: L.w, h: L.h, style: L.style, lh: L.lineHeight, tail: L.tail, tailOff: L.tailOff, colors: L.colors, enW, ukW, sug, fit, usable });
    }
    if (items.length) files.push({ rel, items });
  }
  const fontsInfo = Object.fromEntries(Object.entries(fonts).map(([k, f]) => [k, { binlPath: f.binlPath, pngPath: f.pngPath, source: f.source, line: f.line }]));
  return {
    ok: true, files, stats: { files: files.length, total, translated, over }, fonts: fontsInfo,
    unitPx: layout.UNIT_PX, minPad: layout.MIN_PAD, screen: { w: layout.SCREEN_W, h: layout.SCREEN_H }
  };
});

// bubbles:glyphs — індекси гліфів по рядках (для малювання з атласу у preview):
//   -1 = іконка (крок = висота рядка), -2 = пробіл (крок space, не малюється).
ipcMain.handle('bubbles:glyphs', async (_e, payload) => {
  const text = (payload && payload.text) || '';
  const name = (payload && payload.font) || 'evtfont';
  const fonts = await loadFonts();
  const font = fonts[name] || fonts.evtfont || fonts.sysfont;
  if (!font) return { ok: false, error: 'Нема шрифту' };
  let bytes;
  try { bytes = codec.encodeDetailed(text, { lenient: true }).bytes; } catch (e) { return { ok: false, error: e.message }; }
  const lines = [[]];
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c === 0x0A) { lines.push([]); continue; }
    if (c === 0xF5 || c === 0xF9) { i++; if (c === 0xF5) lines[lines.length - 1].push(-1); continue; }
    if (c === 0x20) { lines[lines.length - 1].push(-2); continue; }   // пробіл: лише крок spaceAdvance, без гліфа
    let code = c;
    if (c >= 0x81 && c <= 0x9F && i < bytes.length) { const t = bytes[i]; if (t >= 0x40 && t <= 0xFC && t !== 0x7F) { code = (c << 8) | t; i++; } }
    let g = 0;
    if (code >= 0x20 && code < 0x80) g = font.map[code - 0x20];
    else if (code > 0xFF) { const k = ((code >> 8) - 0x81) * 192 + (code & 0xFF) + 32; g = k < font.map.length ? font.map[k] : 0; }
    lines[lines.length - 1].push(g);
  }
  return { ok: true, lines, widths: font.widths, line: font.line, count: font.count, space: layout.spaceAdvance(font) };
});

// bubbles:atlas({ world }) — спрайти вікон із гри → PNG data URL. Шматки атласу
// (9-slice хмаринки, вигук, хвостики) вирізає renderer.
//   HD (те, що бачимо у грі): remastered/WORLD/<код>/WO<код>.RTM/message.imd —
//     IMGD 32bpp 512×512, 2 px на 1 px PS2, колір капсули ЗАПЕЧЕНИЙ у текстурі
//     і свій для кожного світу (Traverse Town — помаранчевий 232,183,109 з
//     жовтим бліком і лавандовою тінню; звірено попіксельно зі скриншотом гри).
//     Код світу: WORLDnn → 01nn (Сора), 11nn — Ріку; FORM/SYS/WORLD00 → 0100.
//   Fallback: remastered/FORM/1000/FO1000.RTM/UK_message.imd (256×256, 1:1).
const atlasCache = new Map();   // path → результат
function hedOutDir() {
  try {
    const raw = loadSettingsRaw();
    const gameDir = raw.gameDirectories && raw.gameDirectories['kh-re-com'];
    if (gameDir) return findDirNamed(gameDir, 'Recom.hed_out', 4);
  } catch (_) {}
  return null;
}
function locateMessageImd(world) {
  const cands = [];
  const hedOut = hedOutDir();
  if (hedOut && world) cands.push({ p: path.join(hedOut, 'remastered', 'WORLD', world, 'WO' + world + '.RTM', 'message.imd'), hd: true });
  const build = path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', 'kh-re-com', 'build');
  for (const top of ['Recom', 'Recom.hed_out']) cands.push({ p: path.join(build, top, 'remastered', 'FORM', '1000', 'FO1000.RTM', 'UK_message.imd'), hd: false });
  if (hedOut) cands.push({ p: path.join(hedOut, 'remastered', 'FORM', '1000', 'FO1000.RTM', 'UK_message.imd'), hd: false });
  return cands.find(c => fs.existsSync(c.p)) || null;
}
function decodeImgd(buf) {
  if (buf.toString('ascii', 0, 4) !== 'IMGD') throw new Error('Не IMGD');
  const bo = buf.readUInt32LE(8), bl = buf.readUInt32LE(12), w = buf.readUInt16LE(0x1C), h = buf.readUInt16LE(0x1E);
  if (bl !== w * h * 4) throw new Error('IMGD: підтримується лише 32bpp (' + w + '×' + h + ', ' + bl + ' Б)');
  const bgra = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = bo + i * 4;
    bgra[i * 4] = buf[o + 2]; bgra[i * 4 + 1] = buf[o + 1]; bgra[i * 4 + 2] = buf[o]; bgra[i * 4 + 3] = Math.min(255, buf[o + 3] * 2);
  }
  return { w, h, bgra };
}
ipcMain.handle('bubbles:atlas', async (_e, payload) => {
  const world = payload && /^\d{4}$/.test(String(payload.world || '')) ? String(payload.world) : '';
  const c = locateMessageImd(world);
  if (!c) return { ok: false, error: 'message.imd не знайдено (remastered/WORLD/<код>/WO<код>.RTM або FORM/1000/FO1000.RTM)' };
  if (atlasCache.has(c.p)) return atlasCache.get(c.p);
  try {
    const { w, h, bgra } = decodeImgd(await fsP.readFile(c.p));
    const png = nativeImage.createFromBitmap(bgra, { width: w, height: h }).toPNG();
    const r = { ok: true, path: c.p, hd: c.hd, world: c.hd ? world : '', width: w, height: h, dataUrl: 'data:image/png;base64,' + png.toString('base64') };
    atlasCache.set(c.p, r);
    return r;
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

ipcMain.handle('bubbles:load', async (_e, payload) => {
  const tsvDir = payload && payload.tsvDir;
  if (!tsvDir) return { ok: true, overrides: {} };
  try {
    const raw = JSON.parse(await fsP.readFile(bubblesPath(tsvDir), 'utf8'));
    return { ok: true, overrides: (raw && raw.files) || {} };
  } catch (_) { return { ok: true, overrides: {} }; }
});

ipcMain.handle('bubbles:save', async (_e, payload) => {
  const tsvDir = payload && payload.tsvDir;
  const overrides = (payload && payload.overrides) || {};
  if (!tsvDir) return { ok: false, error: 'Нема теки PROGRESS' };
  try {
    await fsP.mkdir(tsvDir, { recursive: true });
    const n = Object.values(overrides).reduce((a, f) => a + Object.keys(f || {}).length, 0);
    await writeFileAtomic(bubblesPath(tsvDir), JSON.stringify({ version: 1, game: 'kh-re-com', updatedAt: new Date().toISOString(), count: n, files: overrides }, null, 1), { encoding: 'utf8', backups: 2 });
    return { ok: true, filePath: bubblesPath(tsvDir), count: n };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

// Для збірки: overrides з PROGRESS/_bubbles.json (або {} якщо файла нема).
function readBubbleOverrides(tsvDir) {
  if (!tsvDir) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(bubblesPath(tsvDir), 'utf8'));
    const files = raw && raw.files;
    return files && Object.keys(files).length ? files : null;
  } catch (_) { return null; }
}

module.exports = { BUBBLES_FILENAME, bubblesPath, readBubbleOverrides };
