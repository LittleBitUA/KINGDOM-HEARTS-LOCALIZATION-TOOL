'use strict';

// Кернінг Re:CoM: шрифт «FFMW» (.binl: заголовок, u8 ширина на гліф @0x10,
// таблиця код→гліф) + HD-атлас `_fo240.png` (дві половини по 1024 px).
// Формат — tools/py/recom/comfont.py. Тут лише читання/запис ширин; сітка,
// drag і preview — renderer/kerning/comkern.js.

const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsP = require('fs/promises');
const win = require('./window');
const { writeFileAtomic } = require('../shared/safe-fs');
const { loadSettingsRaw } = require('./settings');
const { findDirNamed } = require('./ipc-uafonts');
const { dl } = require('./menu');

const PROFILES = {
  sysfont: { cell: 40, cols: 25, rows: 25 },
  evtfont: { cell: 52, cols: 19, rows: 39 }
};
const MAGIC = 'FFMW';

function parseHeader(buf) {
  if (buf.length < 0x10 || buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('Не шрифт Re:CoM (нема "FFMW")');
  const count = buf.readUInt16LE(0x06);
  const mapOff = buf.readUInt16LE(0x08);
  const line = buf.readUInt32LE(0x0C);
  if (0x10 + count > buf.length || mapOff > buf.length) throw new Error('Пошкоджений заголовок .binl');
  const widths = Array.from(buf.subarray(0x10, 0x10 + count));
  const nmap = Math.floor((buf.length - mapOff) / 2);
  const map = new Array(nmap);
  for (let i = 0; i < nmap; i++) map[i] = buf.readUInt16LE(mapOff + i * 2);
  return { count, mapOff, line, widths, map };
}

function nameOf(binlPath) {
  const m = /UK_(sysfont|evtfont)\.binl$/i.exec(path.basename(binlPath));
  return m ? m[1].toLowerCase() : null;
}
function pngFor(binlPath) {
  const name = nameOf(binlPath);
  if (!name) return null;
  const dir = path.dirname(binlPath);
  const cands = [
    path.join(dir, '..', 'SY0001.VTM', 'UK_' + name + '_fo240.png'),
    path.join(dir, 'UK_' + name + '_fo240.png')
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

// Де взяти шрифт: збірка шрифтів UA (FONTS/kh-re-com/build) → розпакована гра.
function locateFont(name) {
  const cands = [];
  const build = path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', 'kh-re-com', 'build');
  for (const top of ['Recom', 'Recom.hed_out']) cands.push({ p: path.join(build, top, 'remastered', 'SYS', '0001', 'SY0001.BIN', 'UK_' + name + '.binl'), source: 'build' });
  try {
    const raw = loadSettingsRaw();
    const gameDir = raw.gameDirectories && raw.gameDirectories['kh-re-com'];
    if (gameDir) {
      const hedOut = findDirNamed(gameDir, 'Recom.hed_out', 4);
      if (hedOut) cands.push({ p: path.join(hedOut, 'remastered', 'SYS', '0001', 'SY0001.BIN', 'UK_' + name + '.binl'), source: 'game' });
    }
  } catch (_) {}
  for (const c of cands) {
    if (fs.existsSync(c.p) && pngFor(c.p)) return { ok: true, binlPath: c.p, pngPath: pngFor(c.p), source: c.source };
  }
  return { ok: false, error: 'UK_' + name + '.binl не знайдено ні у збірці шрифтів UA, ні у розпакованій грі' };
}
ipcMain.handle('comkern:locate', async (_e, payload) => locateFont((payload && payload.name) || 'sysfont'));

ipcMain.handle('comkern:open', async () => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: 'Re:CoM: UK_sysfont.binl / UK_evtfont.binl',
    properties: ['openFile'],
    filters: [{ name: 'Re:CoM font (*.binl)', extensions: ['binl'] }, { name: dl('allFiles'), extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  return { ok: true, binlPath: r.filePaths[0] };
});

// comkern:load({ binlPath }) → метрики + PNG (data URL) для renderer.
ipcMain.handle('comkern:load', async (_e, payload) => {
  const binlPath = payload && payload.binlPath;
  if (!binlPath) return { ok: false, error: 'Не вказано .binl' };
  try {
    const buf = await fsP.readFile(binlPath);
    const h = parseHeader(buf);
    const name = nameOf(binlPath) || (h.line >= 26 ? 'evtfont' : 'sysfont');
    const prof = PROFILES[name];
    const pngPath = (payload && payload.pngPath) || pngFor(binlPath);
    let pngDataUrl = null;
    if (pngPath && fs.existsSync(pngPath)) pngDataUrl = 'data:image/png;base64,' + (await fsP.readFile(pngPath)).toString('base64');
    return { ok: true, binlPath, pngPath, pngDataUrl, name, profile: prof, count: h.count, line: h.line, widths: h.widths, map: h.map, fileSize: buf.length };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

// comkern:save({ binlPath, widths, saveAs }) — ширини назад у той самий .binl
// (діалог «Зберегти як» з тим самим шляхом за замовчуванням, бекап .bak.1).
ipcMain.handle('comkern:save', async (_e, payload) => {
  const binlPath = payload && payload.binlPath;
  const widths = payload && payload.widths;
  if (!binlPath || !Array.isArray(widths)) return { ok: false, error: 'Нема даних' };
  let target = binlPath;
  if (payload.saveAs !== false) {
    const r = await dialog.showSaveDialog(win.get(), { title: 'Зберегти шрифт Re:CoM', defaultPath: binlPath, filters: [{ name: 'Re:CoM font (*.binl)', extensions: ['binl'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    target = r.filePath;
  }
  try {
    const buf = Buffer.from(await fsP.readFile(binlPath));
    const h = parseHeader(buf);
    if (widths.length !== h.count) return { ok: false, error: 'Кількість ширин (' + widths.length + ') ≠ гліфів у файлі (' + h.count + ')' };
    for (let i = 0; i < h.count; i++) buf[0x10 + i] = Math.max(0, Math.min(255, widths[i] | 0));
    await writeFileAtomic(target, buf, { backups: 1 });
    return { ok: true, filePath: target, byteLength: buf.length };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

// Кирилиця Re:CoM живе на кодах хіраґани 0x829F… (data/recom/tables.json → cyr).
ipcMain.handle('comkern:cyrTable', async () => {
  try {
    const t = JSON.parse(await fsP.readFile(path.join(__dirname, '..', 'data', 'recom', 'tables.json'), 'utf8'));
    const cyr = {};
    for (const [ch, hex] of Object.entries(t.cyr || {})) cyr[ch] = parseInt(hex, 16);
    return { ok: true, cyr };
  } catch (e) { return { ok: false, error: e.message }; }
});

module.exports = { PROFILES, parseHeader, locateFont, pngFor };
