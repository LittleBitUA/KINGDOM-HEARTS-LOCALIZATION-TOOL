'use strict';

// BBS Font Editor + KH1 Kerning (.knj/.dds) IPC.

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const win = require('./window');
const { runWorker } = require('./worker-pool');
const { loadSettings, saveSettings } = require('./settings');
const bbsFont = require('../tools/lib/bbs-font');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ===== BBS Font Editor IPC =====
// Load: користувач вибирає теку розпакованого FontEn.arc → повертаємо
// список фонтів. Дані самих entries беруться окремим викликом per-font.

ipcMain.handle('bbsfont:pickArcDir', async () => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: 'Вкажіть теку з розпакованим FontEn.arc (мають бути .inf/.cod/.mtx файли)',
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? { canceled: true } : { ok: true, dir: r.filePaths[0] };
});

ipcMain.handle('bbsfont:pickHdDir', async () => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: 'Вкажіть HD-remastered теку (PNG атласи), або скасуйте',
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
    title: 'Завантажити .knj',
    defaultPath: settings.lastKnjPath || undefined,
    properties: ['openFile'],
    filters: [
      { name: 'Kanji файли (*.knj)', extensions: ['knj'] },
      { name: 'Усі файли', extensions: ['*'] }
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
    title: 'Завантажити .dds atlas',
    defaultPath: suggestedDir || undefined,
    properties: ['openFile'],
    filters: [
      { name: 'DDS текстури (*.dds)', extensions: ['dds'] },
      { name: 'Усі файли', extensions: ['*'] }
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
  // Повертає об'єкт { byte: char } — об'єднання KH1SYS_Text + ukrainian overlay.
  // Used by Kerning view to label glyphs as "#192 (г)".
  try {
    const single = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'kh1sys_text.json'), 'utf8'));
    const ua = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'ukrainian.json'), 'utf8'));
    const out = {};
    for (const [b, c] of Object.entries(single)) {
      const n = parseInt(b, 10);
      if (!Number.isFinite(n)) continue;
      if (typeof c === 'string') out[n] = c;
    }
    if (ua && ua.decode) {
      for (const [b, c] of Object.entries(ua.decode)) {
        const n = parseInt(b, 10);
        if (!Number.isFinite(n)) continue;
        if (typeof c === 'string') out[n] = c;
      }
    }
    return { ok: true, map: out };
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
    title: 'Зберегти .knj',
    defaultPath: suggested,
    filters: [
      { name: 'Kanji файли (*.knj)', extensions: ['knj'] },
      { name: 'Усі файли', extensions: ['*'] }
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
