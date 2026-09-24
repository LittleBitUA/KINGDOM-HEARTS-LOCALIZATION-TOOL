'use strict';

// Translate-режим IPC: settings, список файлів, extract/compose, TSV,
// глосарій, масові операції. Уся формат-специфіка — у tools/lib/formats
// і tools/lib/translate-ops; тут лише IPC-обгортки.

const { ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const win = require('./window');
const { runWorker, runFormat, broadcastFormat, POOL_SIZE } = require('./worker-pool');
const { loadSettings, saveSettings } = require('./settings');
const { writeFileAtomic } = require('../shared/safe-fs');
const ops = require('../tools/lib/translate-ops');
const codec = require('../shared/codec');
const { nativeMapPathFor } = require('./native-map');
const { readGlossary, saveGlossaryAsync } = require('../tools/lib/glossary');
const { importFile: importTranslationsFile } = require('../tools/lib/import-translations');
const { dl } = require('./menu');
const { readBubbleOverrides } = require('./ipc-bubbles');

const DATA_DIR = path.join(__dirname, '..', 'data');

function sendProgress(payload) { win.send('translate:progress', payload); }

// Карта нативних гліфів KH1, яку записав генератор шрифту (додаткові символи):
// кодек у main і воркери беруть її замість data/kh1_native.json, якщо існує.
codec.setNativeMapPath(nativeMapPathFor());

ipcMain.handle('translate:getSettings', (_e, gameId) => loadSettings(gameId || null));
ipcMain.handle('translate:saveSettings', (_e, payload, gameId) => saveSettings(payload || {}, gameId || null));

ipcMain.handle('translate:pickDirectory', async (_e, title) => {
  const r = await dialog.showOpenDialog(win.get(), {
    title: title || dl('pickDir'),
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

ipcMain.handle('translate:listFiles', async (_e, rusDir) => {
  if (!rusDir) return { files: [] };
  try {
    // Обхід + класифікація 2000+ файлів — у воркері формату, щоб не блокувати main.
    const r = await runFormat({ op: 'listFiles', dir: rusDir });
    return { files: r.result || [] };
  } catch (e) {
    return { files: [], error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:extract', async (_e, payload) => {
  const engPath = payload && payload.engPath;
  // rusPath опційний: без нього працює вбудований еталон (data/kh1_oracle.json).
  // Стара плоска RUS-тека (kh1_first без префікса) — пробуємо обидві розкладки.
  let rusPath = (payload && payload.rusPath) || undefined;
  if (rusPath && !fsSync.existsSync(rusPath) && payload.rusDir && payload.rel) rusPath = ops.rusPathFor(payload.rusDir, payload.rel);
  if (!engPath) return { error: 'Не вказано шляхи' };
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

ipcMain.handle('translate:saveGlossary', async (_e, payload) => {
  const tsvDir = payload && payload.tsvDir;
  const entries = (payload && payload.entries) || {};
  if (!tsvDir) return { error: 'Не задано TSV-теку' };
  try {
    await saveGlossaryAsync(tsvDir, entries);
    return { ok: true, count: Object.keys(entries).length };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

// Кеш індексу: індекс не зберігається між запусками, а будується при вході в гру.
// Щоб вхід був миттєвим, результат кладемо у <userData>/index-cache/<key>.json із
// сигнатурою списку файлів (rel + size + mtime) — будь-яка зміна ENG перебудовує.
// INDEX_CACHE_VERSION піднімати, коли змінюються ключі/слоти у format-handler'ах.
const { indexCacheFile, rememberIndexCache } = require('./index-cache');
function indexCachePaths(engDir, safeMode, filesMeta) {
  const sigSrc = filesMeta.slice().sort((a, b) => a.rel.localeCompare(b.rel)).map(f => f.rel + ':' + f.size + ':' + Math.round(f.mtimeMs || 0)).join('\n');
  const sig = crypto.createHash('sha1').update(sigSrc).digest('hex');
  return { file: indexCacheFile(engDir, safeMode), sig };
}
ipcMain.handle('translate:buildGlossary', async (_e, payload) => {
  const engDir = payload && payload.engDir;
  const files = (payload && payload.files) || [];
  if (!engDir || !files.length) return { error: 'Не задано теки/файли' };
  const safeMode = payload.safeMode !== false;
  const filesMeta = Array.isArray(payload.filesMeta) && payload.filesMeta.length === files.length ? payload.filesMeta : null;
  const cache = filesMeta && !payload.withOccurrences && payload.useCache !== false ? indexCachePaths(engDir, safeMode, filesMeta) : null;
  if (cache) {
    try {
      const raw = JSON.parse(await fs.readFile(cache.file, 'utf8'));
      if (raw && raw.sig === cache.sig && Array.isArray(raw.entries)) return Object.assign({ cached: true }, raw.result, { entries: raw.entries });
    } catch (_) { /* нема кешу або застарілий */ }
  }
  try {
    const r = await ops.buildGlossaryIndex(files, {
      engDir,
      rusDir: (payload && payload.rusDir) || null,
      safeMode,
      opts: payload.opts || {},
      runFormat,
      concurrency: POOL_SIZE * 2,
      // UI використовує лише count/fileCount — occurrences лише роздувають IPC.
      withOccurrences: !!payload.withOccurrences,
      onProgress: sendProgress
    });
    if (cache && r && r.ok) {
      const { entries, ...result } = r;
      fs.mkdir(path.dirname(cache.file), { recursive: true })
        .then(() => writeFileAtomic(cache.file, JSON.stringify({ sig: cache.sig, savedAt: new Date().toISOString(), result, entries }), { encoding: 'utf8' }))
        .then(() => rememberIndexCache(engDir, safeMode, cache.file))
        .catch(() => {});
    }
    return r;
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
      engDir: p.engDir, rusDir: p.rusDir || null, tsvDir: p.tsvDir || null,
      glossary: p.glossary || {}, safeMode: p.safeMode !== false, all: !!p.all, runWorker, onProgress: sendProgress
    });
  } catch (e) { return { error: (e && e.message) || String(e) }; }
});

ipcMain.handle('translate:importTextAll', async (_e, payload) => {
  const p = payload || {};
  if (!p.engDir || !Array.isArray(p.files) || typeof p.content !== 'string') return { error: 'Не задано теки/файли/вміст' };
  try {
    return await ops.importTextAll(p.content, p.files, {
      engDir: p.engDir, rusDir: p.rusDir || null, tsvDir: p.tsvDir || null,
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
    // Глосарій — у кожен воркер формату один раз; далі лише rel + env на файл.
    // Хмаринки Re:CoM: PROGRESS/_bubbles.json → у воркери разом із глосарієм.
    const layouts = payload.gameId === 'kh-re-com' ? readBubbleOverrides(payload.tsvDir || null) : null;
    await broadcastFormat({ op: 'setGlossary', glossary: payload.glossary || {}, layouts });
    return await ops.composeAll(files, {
      layouts,
      engDir,
      rusDir: (payload && payload.rusDir) || null,
      outDir,
      tsvDir: payload.tsvDir || null,
      useTsvOverrides: !!payload.useTsvOverrides,
      glossary: payload.glossary || {},
      safeMode: payload.safeMode !== false,
      opts: payload.opts || {},
      runFormat,
      concurrency: POOL_SIZE * 2,
      onProgress: sendProgress,
      outLayout: payload.outLayout || null,
      gameId: payload.gameId || null
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
