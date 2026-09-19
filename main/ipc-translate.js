'use strict';

// Translate-режим IPC: settings, список файлів, extract/compose, TSV,
// глосарій, масові операції. Уся формат-специфіка — у tools/lib/formats
// і tools/lib/translate-ops; тут лише IPC-обгортки.

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const win = require('./window');
const { runWorker, POOL_SIZE } = require('./worker-pool');
const { loadSettings, saveSettings } = require('./settings');
const { writeFileAtomic } = require('../shared/safe-fs');
const { classifyFile } = require('../tools/lib/formats');
const ops = require('../tools/lib/translate-ops');
const codec = require('../shared/codec');
const { readGlossary, saveGlossary } = require('../tools/lib/glossary');
const { importFile: importTranslationsFile } = require('../tools/lib/import-translations');
const { dl } = require('./menu');

const DATA_DIR = path.join(__dirname, '..', 'data');

function sendProgress(payload) { win.send('translate:progress', payload); }

function walkDirSync(root) {
  const out = [];
  function rec(dir, base) {
    let entries;
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      const rel = base ? path.join(base, e.name) : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        rec(abs, rel);
      } else if (e.isFile()) {
        let size = 0;
        try { size = fsSync.statSync(abs).size; } catch (_) {}
        const ext = path.extname(e.name).toLowerCase();
        const cls = classifyFile(abs, ext);
        // Не додаємо до списку *_mes_data.bin — він auxiliary до _mes_ofs.bin
        // і записується разом з ним. Інакше у Safe-mode tovaste «1 заблоковано».
        if (cls.kind === 'mesdata') continue;
        out.push({
          rel: rel.split(path.sep).join('/'),
          size,
          ext,
          kind: cls.kind,
          magic: cls.magic,
          isTranslatable: cls.isTranslatable
        });
      }
    }
  }
  rec(root, '');
  return out;
}

// translate:getSettings(gameId?) — повертає merged settings (global + game-scoped).

// Схема кирилиці KH1 (overlay/native) живе у per-game settings; кодек у main
// і worker'и беруть її як default. Оновлюємо при кожному читанні/записі
// налаштувань гри (renderer читає їх при вході в гру та після змін).
function applyFontScheme(settings) {
  codec.setDefaultScheme((settings && settings.fontScheme) || 'overlay');
  return settings;
}
ipcMain.handle('translate:getSettings', (_e, gameId) => {
  const s = loadSettings(gameId || null);
  if (gameId) applyFontScheme(s);
  return s;
});
ipcMain.handle('translate:saveSettings', (_e, payload, gameId) => {
  const s = saveSettings(payload || {}, gameId || null);
  if (payload && payload.fontScheme !== undefined) applyFontScheme(s);
  return s;
});

ipcMain.handle('translate:pickDirectory', async (_e, title) => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: title || dl('pickDir'),
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

ipcMain.handle('translate:listFiles', (_e, rusDir) => {
  if (!rusDir) return { files: [] };
  try {
    return { files: walkDirSync(rusDir) };
  } catch (e) {
    return { files: [], error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:extract', async (_e, payload) => {
  const engPath = payload && payload.engPath;
  const rusPath = payload && payload.rusPath;
  if (!engPath || !rusPath) return { error: 'Не вказано шляхи' };
  try {
    return await ops.extractFile(engPath, { rusPath, opts: payload.opts || {}, runWorker });
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:compose', async (_e, payload) => {
  const engPath = payload && payload.engPath;
  const replacements = (payload && payload.replacements) || [];
  const outPath = payload && payload.outPath;
  if (!engPath || !outPath) return { error: 'Не вказано шляхи' };
  try {
    return await ops.composeFile(engPath, replacements, outPath, { runWorker });
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:saveTsv', async (_e, payload) => {
  const tsvPath = payload && payload.tsvPath;
  const content = (payload && payload.content) || '';
  if (!tsvPath) return { error: 'Не вказано шлях TSV' };
  try {
    await writeFileAtomic(tsvPath, content, { encoding: 'utf8' });
    return { ok: true, tsvPath };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:readTsv', async (_e, tsvPath) => {
  if (!tsvPath) return { error: 'Не вказано шлях TSV' };
  try {
    const content = await fs.readFile(tsvPath, 'utf8');
    return { ok: true, content };
  } catch (e) {
    return { error: (e && e.message) || String(e), missing: e.code === 'ENOENT' };
  }
});

ipcMain.handle('translate:readGlossary', (_e, tsvDir) => {
  try {
    return { ok: true, entries: readGlossary(tsvDir) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:saveGlossary', (_e, payload) => {
  const tsvDir = payload && payload.tsvDir;
  const entries = (payload && payload.entries) || {};
  if (!tsvDir) return { error: 'Не задано TSV-теку' };
  try {
    saveGlossary(tsvDir, entries);
    return { ok: true, count: Object.keys(entries).length };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:buildGlossary', async (_e, payload) => {
  const engDir = payload && payload.engDir;
  const files = (payload && payload.files) || [];
  if (!engDir || !files.length) return { error: 'Не задано теки/файли' };
  try {
    return await ops.buildGlossaryIndex(files, {
      engDir,
      rusDir: (payload && payload.rusDir) || engDir,
      safeMode: payload.safeMode !== false,
      opts: payload.opts || {},
      runWorker,
      concurrency: POOL_SIZE * 2,
      // UI використовує лише count/fileCount — occurrences лише роздувають IPC.
      withOccurrences: !!payload.withOccurrences,
      onProgress: sendProgress
    });
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

// ---- text_all.txt (формат обміну Python-наборів BBS/CoM/DDD) ----
ipcMain.handle('translate:exportTextAll', async (_e, payload) => {
  const p = payload || {};
  if (!p.engDir || !Array.isArray(p.files)) return { error: 'Не задано теки/файли' };
  try {
    return await ops.exportTextAll(p.files, {
      engDir: p.engDir, rusDir: p.rusDir || p.engDir, tsvDir: p.tsvDir || null,
      glossary: p.glossary || {}, safeMode: p.safeMode !== false, all: !!p.all, runWorker, onProgress: sendProgress
    });
  } catch (e) { return { error: (e && e.message) || String(e) }; }
});

ipcMain.handle('translate:importTextAll', async (_e, payload) => {
  const p = payload || {};
  if (!p.engDir || !Array.isArray(p.files) || typeof p.content !== 'string') return { error: 'Не задано теки/файли/вміст' };
  try {
    return await ops.importTextAll(p.content, p.files, {
      engDir: p.engDir, rusDir: p.rusDir || p.engDir, tsvDir: p.tsvDir || null,
      safeMode: p.safeMode !== false, toGlossary: p.toGlossary !== false, runWorker, onProgress: sendProgress
    });
  } catch (e) { return { error: (e && e.message) || String(e) }; }
});

ipcMain.handle('translate:importTextAllPair', async (_e, payload) => {
  const p = payload || {};
  if (typeof p.enContent !== 'string' || typeof p.ukContent !== 'string') return { error: 'Потрібні обидва файли' };
  try { return ops.importTextAllPair(p.enContent, p.ukContent); }
  catch (e) { return { error: (e && e.message) || String(e) }; }
});

ipcMain.handle('translate:pickTextFile', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: (opts && opts.title) || dl('importTxt'),
    properties: ['openFile'],
    filters: [{ name: dl('txtFiles') + ' (*.txt)', extensions: ['txt'] }, { name: dl('allFiles'), extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  try { return { ok: true, filePath: r.filePaths[0], content: await fs.readFile(r.filePaths[0], 'utf8') }; }
  catch (e) { return { error: (e && e.message) || String(e) }; }
});

ipcMain.handle('translate:saveTextFile', async (_e, payload) => {
  const p = payload || {};
  const r = await dialog.showSaveDialog(win.get(), {
    title: p.title || dl('exportTxt'),
    defaultPath: p.defaultName || 'text_all.txt',
    filters: [{ name: dl('txtFiles') + ' (*.txt)', extensions: ['txt'] }, { name: dl('allFiles'), extensions: ['*'] }]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try { await writeFileAtomic(r.filePath, p.content || '', { encoding: 'utf8' }); return { ok: true, filePath: r.filePath }; }
  catch (e) { return { error: (e && e.message) || String(e) }; }
});

ipcMain.handle('translate:composeAll', async (_e, payload) => {
  const engDir = payload && payload.engDir;
  const outDir = payload && payload.outDir;
  const files = (payload && payload.files) || [];
  if (!engDir || !outDir || !files.length) return { error: 'Не задано теки/файли' };
  try {
    return await ops.composeAll(files, {
      engDir,
      rusDir: (payload && payload.rusDir) || engDir,
      outDir,
      tsvDir: payload.tsvDir || null,
      glossary: payload.glossary || {},
      safeMode: payload.safeMode !== false,
      opts: payload.opts || {},
      runWorker,
      concurrency: POOL_SIZE * 2,
      onProgress: sendProgress
    });
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:importTranslations', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: dl('importTranslations'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: dl('tableFiles'), extensions: ['html', 'htm', 'tsv', 'csv'] },
      { name: 'HTML', extensions: ['html', 'htm'] },
      { name: 'TSV/CSV', extensions: ['tsv', 'csv'] },
      { name: dl('allFiles'), extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };

  const importOpts = opts || {};
  const allPairs = [];
  const sources = [];
  const errors = [];
  for (const fp of r.filePaths) {
    try {
      const result = importTranslationsFile(fp, importOpts);
      sources.push({
        path: fp,
        format: result.format,
        totalRows: result.totalRows,
        pairs: result.pairs.length
      });
      allPairs.push(...result.pairs);
    } catch (e) {
      errors.push({ path: fp, error: (e && e.message) || String(e) });
    }
  }

  return {
    ok: true,
    sources,
    pairs: allPairs,
    errors
  };
});

ipcMain.handle('translate:getWorldsMap', async () => {
  try {
    const txt = await fs.readFile(path.join(DATA_DIR, 'worlds.json'), 'utf8');
    const json = JSON.parse(txt);
    delete json._comment;
    return { ok: true, map: json };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:exportFileTxt', async (_e, payload) => {
  const defaultName = (payload && payload.defaultName) || 'translation.txt';
  const content = (payload && payload.content) || '';
  const r = await dialog.showSaveDialog(win.get(), {
    title: dl('exportTxt'),
    defaultPath: defaultName,
    filters: [
      { name: dl('txtFiles') + ' (*.txt)', extensions: ['txt'] },
      { name: dl('allFiles'), extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    await fs.writeFile(r.filePath, content, 'utf8');
    return { ok: true, filePath: r.filePath, byteLength: Buffer.byteLength(content, 'utf8') };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:importFileTxt', async () => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: dl('importTxt'),
    properties: ['openFile'],
    filters: [
      { name: dl('txtFiles') + ' (*.txt)', extensions: ['txt'] },
      { name: dl('allFiles'), extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  try {
    const content = await fs.readFile(r.filePaths[0], 'utf8');
    return { ok: true, filePath: r.filePaths[0], content };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:tsvExists', async (_e, tsvPath) => {
  if (!tsvPath) return { exists: false };
  try {
    await fs.access(tsvPath);
    return { exists: true };
  } catch (_) {
    return { exists: false };
  }
});
