'use strict';

// BBS Font Editor + KH1 Kerning (.knj/.dds) IPC.

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const win = require('./window');
const { runWorker } = require('./worker-pool');
const codec = require('../shared/codec');
const { loadSettings, saveSettings, loadSettingsRaw, migrateIfNeeded } = require('./settings');
const bbsFont = require('../tools/lib/bbs-font');
const { unpackArc } = require('../tools/lib/bbs-arc');
const { findDirNamed } = require('./ipc-uafonts');
const { app } = require('electron');
const { dl } = require('./menu');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ===== BBS Font Editor IPC =====
// Load: користувач вибирає теку розпакованого FontEn.arc → повертаємо
// список фонтів. Дані самих entries беруться окремим викликом per-font.

// Тека з розпакованим FontEn.arc для редактора. Приймає будь-що з цього:
//   • теку з *.inf/*.cod (вже розпаковано) — як є;
//   • теку, де лежить файл FontEn.arc (original/arc_en/system) — розпаковуємо;
//   • теку HD-PNG (remastered/…/FontEn.arc/) — шукаємо оригінальний .arc поруч.
// Розпаковуємо у <Documents>/KH-Localization/FONTS/kh-bbs-final-mix/FontEn.arc_unpack.
function unpackDirFor() {
  return path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', 'kh-bbs-final-mix', 'FontEn.arc_unpack');
}
function findHedOutAbove(p) {
  let cur = path.resolve(p);
  for (let i = 0; i < 8; i++) {
    if (/\.hed_out$/i.test(path.basename(cur))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
function resolveArcDir(picked) {
  const hasFonts = (d) => { try { return fsSync.readdirSync(d).some(f => /\.(inf|cod)$/i.test(f)); } catch (_) { return false; } };
  if (hasFonts(picked)) return { ok: true, dir: picked, hdDir: null };
  let arcFile = null, hdDir = null;
  const direct = path.join(picked, 'FontEn.arc');
  if (fsSync.existsSync(direct) && fsSync.statSync(direct).isFile()) arcFile = direct;
  else if (fsSync.existsSync(picked) && fsSync.statSync(picked).isFile() && /\.arc$/i.test(picked)) arcFile = picked;
  else {
    // remastered/arc_en/system/FontEn.arc (PNG) → original/arc_en/system/FontEn.arc
    const hedOut = findHedOutAbove(picked);
    if (hedOut) {
      const cand = path.join(hedOut, 'original', 'arc_en', 'system', 'FontEn.arc');
      if (fsSync.existsSync(cand)) arcFile = cand;
    }
  }
  if (!arcFile) return { error: 'У цій теці нема ні *.inf/*.cod, ні файла FontEn.arc — вкажи original/arc_en/system або розпаковану теку' };
  const hedOut = findHedOutAbove(arcFile);
  if (hedOut) {
    const png = path.join(hedOut, 'remastered', 'arc_en', 'system', 'FontEn.arc');
    if (fsSync.existsSync(png)) hdDir = png;
  }
  const out = unpackDirFor();
  const names = unpackArc(arcFile, out);
  return { ok: true, dir: out, hdDir, arcFile, unpacked: names.length };
}

ipcMain.handle('bbsfont:pickArcDir', async () => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: dl('pickArcDir'),
    properties: ['openDirectory']
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  try { return resolveArcDir(r.filePaths[0]); }
  catch (e) { return { error: 'FontEn.arc: ' + (e.message || e) }; }
});

// Без діалогу: взяти FontEn.arc із розпакованої гри (Setup → bbs_first.hed_out).
ipcMain.handle('bbsfont:autoArc', async () => {
  try {
    const raw = migrateIfNeeded(loadSettingsRaw());
    const gameDir = (raw.gameDirectories || {})['kh-bbs-final-mix'];
    if (!gameDir || !fsSync.existsSync(gameDir)) return { error: 'Теку гри BBS не вказано (Setup)' };
    const hedOut = findDirNamed(gameDir, 'bbs_first.hed_out', 4);
    if (!hedOut) return { error: 'У грі нема розпакованої bbs_first.hed_out — спершу розпакуй гру у Setup' };
    const arc = path.join(hedOut, 'original', 'arc_en', 'system', 'FontEn.arc');
    if (!fsSync.existsSync(arc)) return { error: 'Не знайдено ' + arc };
    return resolveArcDir(path.dirname(arc));
  } catch (e) { return { error: 'FontEn.arc: ' + (e.message || e) }; }
});

ipcMain.handle('bbsfont:pickHdDir', async () => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: dl('pickHdDir'),
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? { canceled: true } : { ok: true, dir: r.filePaths[0] };
});

ipcMain.handle('bbsfont:listFonts', async (_e, dir) => {
  if (!dir) return { error: 'Не вказано теку' };
  try {
    const fonts = bbsFont.discoverFonts(dir);
    return {
      ok: true,
      fonts: fonts.map(f => ({
        name: f.name,
        infPath: f.infPath,
        codPath: f.codPath,
        mtxPath: f.mtxPath || null,
        cluPath: f.cluPath || null
      }))
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('bbsfont:loadFont', async (_e, fontFiles) => {
  if (!fontFiles || !fontFiles.infPath || !fontFiles.codPath) {
    return { error: 'Не вказано INF/COD' };
  }
  try {
    const font = bbsFont.loadFont(fontFiles);
    // PNG (HD) теж зчитуємо якщо є — повертаємо як data:URL для display.
    let pngDataUrl = null;
    if (fontFiles.hdPngPath) {
      try {
        const buf = fsSync.readFileSync(fontFiles.hdPngPath);
        pngDataUrl = 'data:image/png;base64,' + buf.toString('base64');
      } catch (_) {}
    }
    return {
      ok: true,
      name: font.name,
      inf: font.inf,
      entries: font.entries,
      pngDataUrl
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('bbsfont:saveCod', async (_e, payload) => {
  if (!payload || !payload.codPath || !Array.isArray(payload.entries)) {
    return { error: 'Невірні параметри' };
  }
  try {
    const written = bbsFont.saveCod(payload.codPath, payload.entries);
    return { ok: true, byteLength: written };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('bbsfont:listHdPngs', async (_e, hdDir) => {
  if (!hdDir) return { ok: true, pngs: [] };
  try {
    const files = fsSync.readdirSync(hdDir).filter(f => /\.png$/i.test(f));
    return { ok: true, pngs: files.map(f => path.join(hdDir, f)) };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('kerning:openKnj', async () => {
  const settings = loadSettings();
  const r = await dialog.showOpenDialog(win.get(), {
    title: dl('loadKnj'),
    defaultPath: settings.lastKnjPath || undefined,
    properties: ['openFile'],
    filters: [
      { name: dl('knjFiles') + ' (*.knj)', extensions: ['knj'] },
      { name: dl('allFiles'), extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  try {
    const buf = await fs.readFile(r.filePaths[0]);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    saveSettings({ lastKnjPath: r.filePaths[0] });
    return { ok: true, filePath: r.filePaths[0], data: ab };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('kerning:loadKnjFromPath', async (_e, knjPath) => {
  // Безмовне завантаження за збереженим шляхом (для авто-load на старті).
  if (!knjPath) return { ok: false };
  try {
    if (!fsSync.existsSync(knjPath)) return { ok: false, error: 'not_found' };
    const buf = await fs.readFile(knjPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, filePath: knjPath, data: ab };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('kerning:openDds', async (_e, suggestedDir) => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: dl('loadDds'),
    defaultPath: suggestedDir || undefined,
    properties: ['openFile'],
    filters: [
      { name: dl('ddsFiles') + ' (*.dds)', extensions: ['dds'] },
      { name: dl('allFiles'), extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  try {
    const buf = await fs.readFile(r.filePaths[0]);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    saveSettings({ lastDdsPath: r.filePaths[0] });
    return { ok: true, filePath: r.filePaths[0], data: ab };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('kerning:loadDdsFromPath', async (_e, ddsPath) => {
  // Безмовне завантаження за збереженим шляхом (для авто-load на старті).
  if (!ddsPath) return { ok: false };
  try {
    if (!fsSync.existsSync(ddsPath)) return { ok: false, error: 'not_found' };
    const buf = await fs.readFile(ddsPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, filePath: ddsPath, data: ab };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('kerning:autoFindDds', async (_e, knjPath) => {
  // Шукаємо .dds в дочірній теці з ім'ям самого .knj-файла
  // Наприклад: UA_kanji.knj → ./UA_kanji.knj/UA_kanji_knj0.dds
  if (!knjPath) return { ok: false };
  try {
    const dir = path.dirname(knjPath);
    const baseName = path.basename(knjPath); // UA_kanji.knj
    const candidates = [
      path.join(dir, baseName, baseName.replace(/\.knj$/i, '_knj0.dds')),
      path.join(dir, baseName + '0.dds'),
      path.join(dir, baseName.replace(/\.knj$/i, '_knj0.dds'))
    ];
    for (const c of candidates) {
      if (fsSync.existsSync(c)) {
        const buf = await fs.readFile(c);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        saveSettings({ lastDdsPath: c });
        return { ok: true, filePath: c, data: ab };
      }
    }
    // Резервно — шукаємо будь-який .dds у теці зі співпадаючою назвою
    const sub = path.join(dir, baseName);
    if (fsSync.existsSync(sub) && fsSync.statSync(sub).isDirectory()) {
      const ddsFiles = fsSync.readdirSync(sub).filter(f => /\.dds$/i.test(f));
      if (ddsFiles.length) {
        const c = path.join(sub, ddsFiles[0]);
        const buf = await fs.readFile(c);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        saveSettings({ lastDdsPath: c });
        return { ok: true, filePath: c, data: ab };
      }
    }
    return { ok: false };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('app:getCharMap', async () => {
  // Повертає { map: { byte: char } (KH1SYS_Text), native: { glyphIdx: char } }.
  // Kerning-режим підписує гліфи як "#40 (H)" / "#224 19 00 (А)".
  try {
    const single = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'kh1sys_text.json'), 'utf8'));
    const out = {};
    for (const [b, c] of Object.entries(single)) {
      const n = parseInt(b, 10);
      if (!Number.isFinite(n)) continue;
      if (typeof c === 'string') out[n] = c;
    }
    // Нативна кирилиця: індекси гліфів 224+ (коди 19 NN) → літера — з тієї самої
    // карти, що й кодек (користувацька kh1-native-map.json, якщо є).
    const native = {};
    try {
      for (const [code, ch] of codec.loadNative().decodeMap) native[((code >> 8) - 0x19) * 256 + (code & 0xFF) + 0xE0] = ch;
    } catch (_) {}
    return { ok: true, map: out, native };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('kerning:encodeText', async (_e, text) => {
  if (typeof text !== 'string' || text.length === 0) return { ok: true, bytes: [] };
  try {
    const r = await runWorker({ op: 'encode', text });
    const arr = Array.from(new Uint8Array(r.bytes));
    return { ok: true, bytes: arr };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('kerning:saveKnj', async (_e, payload) => {
  const suggested = (payload && payload.suggestedPath) || 'output.knj';
  const r = await dialog.showSaveDialog(win.get(), {
    title: dl('saveKnj'),
    defaultPath: suggested,
    filters: [
      { name: dl('knjFiles') + ' (*.knj)', extensions: ['knj'] },
      { name: dl('allFiles'), extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    await fs.writeFile(r.filePath, Buffer.from(payload.data));
    return { ok: true, filePath: r.filePath, byteLength: payload.data.byteLength };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

// Таблиця ширин гліфів шрифту діалогів KH1 (.knj @0x40080, 336 × u8) для
// вимірювання рядків у глосарії. Спершу — збірка шрифтів UA (має ширини нативних
// літер 224+), далі — файл, відкритий у Kerning, далі — розпакована гра.
const KNJ_WIDTH_OFFSET = 0x40080;
const KNJ_WIDTH_COUNT = 336;
ipcMain.handle('translate:knjWidths', async (_e, payload) => {
  const gameId = String((payload && payload.gameId) || 'kh1-final-mix');
  if (gameId !== 'kh1-final-mix') return { ok: false, error: 'лише KH1' };
  const cands = [];
  try {
    const build = path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', gameId, 'build');
    for (const rel of ['kh1_first/original/exchange/UK_kanji.knj', 'kh1_first.hed_out/original/exchange/UK_kanji.knj']) cands.push(path.join(build, rel));
  } catch (_) {}
  try {
    const s = loadSettings();
    if (s && s.lastKnjPath) cands.push(s.lastKnjPath);
    const raw = loadSettingsRaw();
    const gameDir = raw.gameDirectories && raw.gameDirectories[gameId];
    if (gameDir) {
      const hedOut = findDirNamed(gameDir, 'kh1_first.hed_out', 4);
      if (hedOut) cands.push(path.join(hedOut, 'original', 'exchange', 'UK_kanji.knj'));
    }
  } catch (_) {}
  for (const c of cands) {
    try {
      const buf = await fs.readFile(c);
      if (buf.length < KNJ_WIDTH_OFFSET + KNJ_WIDTH_COUNT) continue;
      return { ok: true, widths: Array.from(buf.subarray(KNJ_WIDTH_OFFSET, KNJ_WIDTH_OFFSET + KNJ_WIDTH_COUNT)), source: c };
    } catch (_) { /* наступний кандидат */ }
  }
  return { ok: false, error: 'UK_kanji.knj не знайдено (збірка шрифтів UA / Kerning / гра)' };
});
