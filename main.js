'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { Worker } = require('worker_threads');

// electron-updater є опціональним: якщо нема (наприклад dev запуск без npm install) —
// просто вимикаємо auto-update, не падаємо.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; }
catch (_) { autoUpdater = null; }
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;

let mainWindow = null;
let appLang = 'uk';

const MENU_DICT = {
  uk: {
    file: 'Файл', import: 'Імпортувати...', export: 'Експортувати як...',
    modeEditor: 'Режим: Редактор', modeTranslate: 'Режим: Переклад', modeKerning: 'Режим: Кернінг',
    quit: 'Вийти',
    edit: 'Редагування', undo: 'Скасувати', redo: 'Повторити',
    cut: 'Вирізати', copy: 'Копіювати', paste: 'Вставити', selectAll: 'Виділити все',
    find: 'Знайти...', findNext: 'Знайти далі', replace: 'Замінити в глосарії...',
    view: 'Вигляд', reload: 'Перезавантажити', devTools: 'Інструменти розробника',
    zoomIn: 'Збільшити масштаб', zoomOut: 'Зменшити масштаб', resetZoom: 'Скинути масштаб',
    fullscreen: 'Повноекранний режим',
    help: 'Довідка', about: 'Про програму', checkUpdates: 'Перевірити оновлення'
  },
  en: {
    file: 'File', import: 'Import...', export: 'Export as...',
    modeEditor: 'Mode: Editor', modeTranslate: 'Mode: Translate', modeKerning: 'Mode: Kerning',
    quit: 'Quit',
    edit: 'Edit', undo: 'Undo', redo: 'Redo',
    cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    find: 'Find...', findNext: 'Find Next', replace: 'Replace in glossary...',
    view: 'View', reload: 'Reload', devTools: 'Developer Tools',
    zoomIn: 'Zoom In', zoomOut: 'Zoom Out', resetZoom: 'Reset Zoom',
    fullscreen: 'Fullscreen',
    help: 'Help', about: 'About', checkUpdates: 'Check for updates'
  }
};
function ml(key) { return (MENU_DICT[appLang] && MENU_DICT[appLang][key]) || MENU_DICT.uk[key] || key; }

let workerInstance = null;
let workerSeq = 0;
const workerPending = new Map();

function rejectAllPending(reason) {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  for (const { reject } of workerPending.values()) reject(err);
  workerPending.clear();
}

function getWorker() {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker(path.join(__dirname, 'workers', 'codec-worker.js'));

  workerInstance.on('message', (msg) => {
    const id = msg && msg.id;
    const pending = workerPending.get(id);
    if (!pending) return;
    workerPending.delete(id);
    if (msg.ok) pending.resolve(msg);
    else pending.reject(new Error(msg.error || 'Помилка обробника'));
  });

  workerInstance.on('error', (err) => {
    rejectAllPending(err);
    workerInstance = null;
  });

  workerInstance.on('exit', () => {
    rejectAllPending('Обробник завершив роботу');
    workerInstance = null;
  });

  return workerInstance;
}

function runWorker(payload, transferList) {
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    workerPending.set(id, { resolve, reject });
    try {
      getWorker().postMessage(Object.assign({ id }, payload), transferList || []);
    } catch (e) {
      workerPending.delete(id);
      reject(e);
    }
  });
}

const FILE_FILTERS_OPEN = [
  { name: 'Підтримувані файли (*.bin;*.binl;*.ard)', extensions: ['bin', 'binl', 'ard'] },
  { name: 'BIN файли (*.bin)', extensions: ['bin'] },
  { name: 'BINL файли (*.binl)', extensions: ['binl'] },
  { name: 'ARD файли (*.ard)', extensions: ['ard'] },
  { name: 'Усі файли', extensions: ['*'] }
];

const FILE_FILTERS_SAVE = [
  { name: 'BIN файли (*.bin)', extensions: ['bin'] },
  { name: 'BINL файли (*.binl)', extensions: ['binl'] },
  { name: 'ARD файли (*.ard)', extensions: ['ard'] },
  { name: 'Усі файли', extensions: ['*'] }
];

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Імпортувати файл BIN/BINL/ARD',
    properties: ['openFile'],
    filters: FILE_FILTERS_OPEN
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }
  const filePath = result.filePaths[0];
  try {
    const buffer = await fs.readFile(filePath);
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const r = await runWorker({ op: 'decode', bytes: ab }, [ab]);
    return {
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      byteLength: buffer.length,
      text: r.text
    };
  } catch (e) {
    return { canceled: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('file:save', async (_event, payload) => {
  const text = (payload && payload.text) != null ? payload.text : '';
  const suggestedName = (payload && payload.suggestedName) || 'untitled.bin';

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Експортувати файл BIN/BINL/ARD',
    defaultPath: suggestedName,
    filters: FILE_FILTERS_SAVE
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  let bytes;
  try {
    const r = await runWorker({ op: 'encode', text });
    bytes = Buffer.from(r.bytes);
  } catch (e) {
    return { canceled: false, error: (e && e.message) || String(e) };
  }

  try {
    await fs.writeFile(result.filePath, bytes);
  } catch (e) {
    return { canceled: false, error: 'Не вдалося записати файл: ' + ((e && e.message) || String(e)) };
  }

  return {
    canceled: false,
    filePath: result.filePath,
    fileName: path.basename(result.filePath),
    byteLength: bytes.length
  };
});

// =====================================================================
// Translate Mode: settings, file listing, extract, compose, TSV I/O
// =====================================================================

const SETTINGS_PATH = path.join(app.getPath('userData'), 'translate-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fsSync.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (_) {
    return { engDir: '', rusDir: '', outDir: '', tsvDir: '' };
  }
}

function saveSettings(s) {
  try {
    fsSync.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fsSync.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
  } catch (_) {}
}

// .binl магічна сигнатура: ASCII "EvMsg" перші 5 байт
const BINL_MAGIC = Buffer.from([0x45, 0x76, 0x4D, 0x73, 0x67]);
// .ard магічна сигнатура (KGR + NUL) — контейнер, не редагується напряму
const ARD_MAGIC = Buffer.from([0x4B, 0x47, 0x52, 0x00]);

const { parsePair: parseMesOfs, composePair: composeMesOfs, isMesOfsName, pairedDataName } = require('./tools/lib/mes-ofs');
const { parseEv, composeEv, isEvName } = require('./tools/lib/ev-format');

// Класифікація:
//  - 'binl'    — структурований .binl з EvMsg-заголовком (header=11, footer=5)
//  - 'rawbin'  — сирий .bin із KH1-кодованим текстом, без заголовка
//                (наприклад btltbl.bin/UK_AbilityName.bin тощо)
//  - 'mesofs'  — парний формат *_mes_ofs.bin + *_mes_data.bin
//  - 'unknown' — байткод/контейнер/інше — не чіпати
function classifyFile(absPath, ext) {
  let kind = 'unknown';
  let magic = '';
  let extractOpts = null;
  // Спочатку перевіряємо парний формат за іменем — це найдешевша перевірка.
  const baseName = path.basename(absPath);
  if (isMesOfsName(baseName)) {
    // Перевіряємо чи поряд лежить data-файл.
    const dataPath = path.join(path.dirname(absPath), pairedDataName(baseName));
    if (fsSync.existsSync(dataPath)) {
      return { kind: 'mesofs', magic: 'mes_ofs', extractOpts: { dataPath }, isTranslatable: true };
    }
  }
  // Парний *_mes_data.bin розпізнаємо як неперекладний (його не редагують
  // напряму — переклад йде через _mes_ofs.bin).
  if (/_mes_data\.bin$/i.test(baseName)) {
    return { kind: 'mesdata', magic: 'mes_data', extractOpts: null, isTranslatable: false };
  }
  // .ev / .evdl — event-script container з текст-блоком всередині.
  // Footer/bytecode позиційно-незалежний (підтверджено byte-by-byte порівнянням
  // ENG vs RUS файлів: блоки PUSH/JMP/BEQZ ідентичні, навіть коли весь footer
  // зміщений через довший RUS-текст). Тому потрібно ОНОВЛЮВАТИ ЛИШЕ header
  // pointer table при зростанні текстового блоку — що composeEv (compact mode)
  // і робить.
  if (isEvName(baseName)) {
    return { kind: 'ev', magic: 'ev_evdl', extractOpts: null, isTranslatable: true };
  }
  try {
    const fd = fsSync.openSync(absPath, 'r');
    const buf = Buffer.alloc(256);
    const n = fsSync.readSync(fd, buf, 0, 256, 0);
    fsSync.closeSync(fd);
    if (n >= 5) {
      magic = buf.subarray(0, 5).toString('ascii');
      const head4 = buf.subarray(0, 4);

      if (ext === '.binl' && buf.subarray(0, 5).equals(BINL_MAGIC)) {
        kind = 'binl';
        extractOpts = { header: 11, footer: 5 };
      } else if (ext === '.bin' && !head4.equals(ARD_MAGIC) &&
                 !buf.subarray(0, 5).equals(BINL_MAGIC)) {
        // Heuristic для raw text .bin: переважно KH1-printable байти
        // плюс 0x00-термінатори рядків.
        // Включає: 0x00 (sentinel), 0x01-0x0F (control/format tokens),
        // 0x21-0x79 (basic ASCII KH1), 0x80-0xFF (extended/cyrillic).
        const sample = buf.subarray(0, n);
        let printable = 0;
        let zeros = 0;
        for (let i = 0; i < sample.length; i++) {
          const b = sample[i];
          if (b === 0x00) zeros++;
          if (b <= 0x0F || (b >= 0x21 && b <= 0x79) || b >= 0x80) {
            printable++;
          }
        }
        if (sample.length >= 8 && printable / sample.length >= 0.85 && zeros >= 2) {
          kind = 'rawbin';
          extractOpts = { header: 0, footer: 0 };
        }
      }
    }
  } catch (_) {}
  return { kind, magic, extractOpts, isTranslatable: kind !== 'unknown' };
}

function getExtractOpts(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const cls = classifyFile(absPath, ext);
  return cls.extractOpts || {};
}

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
          magic: cls.magic,
          isTranslatable: cls.isTranslatable
        });
      }
    }
  }
  rec(root, '');
  return out;
}

ipcMain.handle('translate:getSettings', () => loadSettings());

ipcMain.handle('translate:saveSettings', (_e, s) => {
  const merged = Object.assign(loadSettings(), s || {});
  saveSettings(merged);
  return merged;
});

ipcMain.handle('translate:pickDirectory', async (_e, title) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Виберіть теку',
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

ipcMain.handle('translate:listFiles', (_e, rusDir) => {
  if (!rusDir) return { files: [] };
  try {
    const files = walkDirSync(rusDir);
    return { files };
  } catch (e) {
    return { files: [], error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:extract', async (_e, payload) => {
  const engPath = payload && payload.engPath;
  const rusPath = payload && payload.rusPath;
  if (!engPath || !rusPath) return { error: 'Не вказано шляхи' };
  try {
    // Спеціальна гілка: парний формат *_mes_ofs.bin + *_mes_data.bin.
    const ext = path.extname(engPath).toLowerCase();
    const cls = classifyFile(engPath, ext);
    if (cls.kind === 'ev') {
      const codec = require('./shared/codec');
      const ofsBuf = await fs.readFile(engPath);
      const parsed = parseEv(ofsBuf, codec);
      // Показуємо UI лише translatable слоти (без padding-{eol}-байтів).
      const visible = parsed.slots.filter(s => s.translatable);
      const uiSlots = visible.map((s, idx) => ({
        index: idx,
        offset: s.offset,           // відносно textOffset
        absOffset: s.absOffset,     // абсолютна позиція в файлі (для compose lookup)
        byteLen: s.byteLen,
        english: s.english,
        ukText: ''
      }));
      return {
        slots: uiSlots,
        stats: {
          ev: true,
          totalSlots: parsed.slots.length,
          translatableSlots: visible.length,
          textOffset: parsed.textOffset,
          footerOffset: parsed.footerOffset,
          fileSize: parsed.fileSize
        },
        engSize: ofsBuf.length,
        rusSize: 0
      };
    }
    if (cls.kind === 'mesofs') {
      const codec = require('./shared/codec');
      const dataPath = cls.extractOpts && cls.extractOpts.dataPath;
      if (!dataPath || !fsSync.existsSync(dataPath)) {
        return { error: 'Не знайдено пару _mes_data.bin для ' + path.basename(engPath) };
      }
      const ofsBuf = await fs.readFile(engPath);
      const dataBuf = await fs.readFile(dataPath);
      const parsed = parseMesOfs(ofsBuf, dataBuf, codec);
      // Збираємо унікальні offsets із linkedCount, у тому ж порядку,
      // в якому пойнтери першого разу зустрічаються в ofs (зручно для UI).
      const offsetSeen = new Map();
      for (const s of parsed.slots) {
        if (!offsetSeen.has(s.offset)) {
          offsetSeen.set(s.offset, { count: 1, firstIdx: s.index, byteLen: s.byteLen, english: s.english });
        } else {
          offsetSeen.get(s.offset).count++;
        }
      }
      const sortedByFirst = [...offsetSeen.entries()].sort((a, b) => a[1].firstIdx - b[1].firstIdx);
      const uiSlots = sortedByFirst.map(([off, info], idx) => ({
        index: idx,
        offset: off,
        byteLen: parsed.cellLengthByOffset.get(off) || info.byteLen,
        english: info.english,
        ukText: '',
        linkedCount: info.count
      }));
      // Зберігаємо meta для compose-step:
      mesOfsMetaCache.set(engPath, {
        ofsLength: ofsBuf.length,
        dataLength: dataBuf.length,
        cellLengthByOffset: parsed.cellLengthByOffset
      });
      return {
        slots: uiSlots,
        stats: {
          mesofs: true,
          pointerCount: parsed.pointerCount,
          uniqueStrings: parsed.uniqueStrings,
          ofsPadding: parsed.ofsPadding,
          dataPadding: parsed.dataPadding
        },
        engSize: ofsBuf.length + dataBuf.length,
        rusSize: 0
      };
    }
    // Звичайна гілка: extract через worker.
    const eng = await fs.readFile(engPath);
    const rus = await fs.readFile(rusPath);
    const engAb = eng.buffer.slice(eng.byteOffset, eng.byteOffset + eng.byteLength);
    const rusAb = rus.buffer.slice(rus.byteOffset, rus.byteOffset + rus.byteLength);
    const opts = Object.assign({}, getExtractOpts(engPath), payload.opts || {});
    const r = await runWorker(
      { op: 'extract', eng: engAb, rus: rusAb, opts },
      [engAb, rusAb]
    );
    return { slots: r.slots, stats: r.stats, engSize: eng.length, rusSize: rus.length };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

// Кеш мета-даних *_mes_ofs.bin парсів для подальшого compose
// (зберігаємо ofsLength/dataLength/cellLengthByOffset, щоб не парсити двічі).
const mesOfsMetaCache = new Map();

ipcMain.handle('translate:compose', async (_e, payload) => {
  const engPath = payload && payload.engPath;
  const replacements = (payload && payload.replacements) || [];
  const outPath = payload && payload.outPath;
  if (!engPath || !outPath) return { error: 'Не вказано шляхи' };
  try {
    // Спеціальна гілка: mesofs парне записування ofs+data.
    const ext = path.extname(engPath).toLowerCase();
    const cls = classifyFile(engPath, ext);
    if (cls.kind === 'ev') {
      const codec = require('./shared/codec');
      const evBuf = await fs.readFile(engPath);
      const parsed = parseEv(evBuf, codec);
      // Replacements мапляться по slot.offset (relative to textOffset).
      const ukByOffset = new Map();
      for (const r of replacements) {
        if (r && typeof r.offset === 'number' && r.ukText && r.ukText.length) {
          ukByOffset.set(r.offset, r.ukText);
        }
      }
      // Compose використовує ВСІ слоти (translatable + padding) для round-trip.
      const slotsForCompose = parsed.slots.map(s => ({
        offset: s.offset,
        english: s.english,
        ukText: ukByOffset.has(s.offset) ? ukByOffset.get(s.offset) : s.english
      }));
      const composed = composeEv(evBuf, slotsForCompose, codec);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, composed.buf);
      return {
        ok: true,
        outPath,
        byteLength: composed.buf.length,
        applied: ukByOffset.size,
        skipped: parsed.slots.filter(s => s.translatable).length - ukByOffset.size,
        errors: [],
        ev: { sizeDiff: composed.sizeDiff, relocCount: composed.relocCount }
      };
    }
    if (cls.kind === 'mesofs') {
      const codec = require('./shared/codec');
      const dataPath = cls.extractOpts && cls.extractOpts.dataPath;
      const ofsBuf = await fs.readFile(engPath);
      const dataBuf = await fs.readFile(dataPath);
      const parsed = parseMesOfs(ofsBuf, dataBuf, codec);
      // Застосовуємо replacements: для кожного slot з заданим UK — записуємо.
      const ukByOffset = new Map();
      for (const r of replacements) {
        if (r && typeof r.offset === 'number' && r.ukText && r.ukText.length) {
          ukByOffset.set(r.offset, r.ukText);
        }
      }
      const slotsForCompose = parsed.slots.map(s => ({
        offset: s.offset,
        english: s.english,
        ukText: ukByOffset.has(s.offset) ? ukByOffset.get(s.offset) : s.english
      }));
      const composed = composeMesOfs(slotsForCompose, {
        ofsLength: ofsBuf.length,
        dataLength: dataBuf.length,
        cellLengthByOffset: parsed.cellLengthByOffset
      }, codec);
      // Виводимо ofs у outPath, data — у пару (заміна в імені).
      const outDataPath = path.join(path.dirname(outPath), pairedDataName(path.basename(outPath)));
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, composed.ofsBuf);
      await fs.writeFile(outDataPath, composed.dataBuf);
      return {
        ok: true,
        outPath,
        byteLength: composed.ofsBuf.length + composed.dataBuf.length,
        applied: ukByOffset.size,
        skipped: parsed.uniqueStrings - ukByOffset.size,
        errors: [],
        mesofs: { layout: composed.layout, dataPath: outDataPath }
      };
    }
    const eng = await fs.readFile(engPath);
    const engAb = eng.buffer.slice(eng.byteOffset, eng.byteOffset + eng.byteLength);
    const r = await runWorker({ op: 'compose', eng: engAb, replacements }, [engAb]);
    const buf = Buffer.from(r.bytes);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buf);
    return {
      ok: true,
      outPath,
      byteLength: buf.length,
      applied: r.applied,
      skipped: r.skipped,
      errors: r.errors || []
    };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:saveTsv', async (_e, payload) => {
  const tsvPath = payload && payload.tsvPath;
  const content = (payload && payload.content) || '';
  if (!tsvPath) return { error: 'Не вказано шлях TSV' };
  try {
    await fs.mkdir(path.dirname(tsvPath), { recursive: true });
    await fs.writeFile(tsvPath, content, 'utf8');
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

// ---- Glossary ----
const { readGlossary, saveGlossary } = require('./tools/lib/glossary');
const { importFile: importTranslationsFile } = require('./tools/lib/import-translations');

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('translate:progress', payload);
  }
}

ipcMain.handle('translate:readGlossary', (_e, tsvDir) => {
  try {
    const entries = readGlossary(tsvDir);
    return { ok: true, entries };
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
  const rusDir = payload && payload.rusDir;
  const files = (payload && payload.files) || [];
  const opts = (payload && payload.opts) || {};
  const safeMode = payload && payload.safeMode !== false;
  if (!engDir || !rusDir || !files.length) return { error: 'Не задано теки/файли' };

  const map = new Map();
  let processed = 0;
  let skipped = 0;
  let skippedUnsafe = 0;
  const total = files.length;

  for (const rel of files) {
    const engPath = path.join(engDir, rel);
    const rusPath = path.join(rusDir, rel);
    if (!fsSync.existsSync(engPath) || !fsSync.existsSync(rusPath)) {
      skipped++;
      processed++;
      sendProgress({ phase: 'glossary-build', done: processed, total, currentFile: rel, skipped: true });
      continue;
    }

    const ext = path.extname(rel).toLowerCase();
    const cls = classifyFile(engPath, ext);

    // Safe mode: пропускати файли без розпізнаної структури (.evdl/байткод/інше)
    if (safeMode && !cls.isTranslatable) {
      skippedUnsafe++;
      processed++;
      sendProgress({ phase: 'glossary-build', done: processed, total, currentFile: rel, skipped: 'unsafe' });
      continue;
    }

    try {
      const eng = await fs.readFile(engPath);
      const rus = await fs.readFile(rusPath);
      const engAb = eng.buffer.slice(eng.byteOffset, eng.byteOffset + eng.byteLength);
      const rusAb = rus.buffer.slice(rus.byteOffset, rus.byteOffset + rus.byteLength);
      const fileOpts = Object.assign({}, cls.extractOpts || {}, opts);
      const r = await runWorker(
        { op: 'extract', eng: engAb, rus: rusAb, opts: fileOpts },
        [engAb, rusAb]
      );
      for (const slot of r.slots) {
        const key = slot.english;
        let entry = map.get(key);
        if (!entry) { entry = { count: 0, occurrences: [] }; map.set(key, entry); }
        entry.count++;
        entry.occurrences.push({ rel, offset: slot.offset, byteLen: slot.byteLen, index: slot.index });
      }
    } catch (_) {
      skipped++;
    }

    processed++;
    sendProgress({ phase: 'glossary-build', done: processed, total, currentFile: rel });
  }

  // serialize: array of { english, count, files: number, occurrences? }
  const entries = [];
  for (const [english, info] of map) {
    const fileSet = new Set(info.occurrences.map(o => o.rel));
    entries.push({
      english,
      count: info.count,
      fileCount: fileSet.size,
      occurrences: info.occurrences
    });
  }
  // sort: most-frequent first
  entries.sort((a, b) => b.count - a.count || a.english.localeCompare(b.english));

  return { ok: true, entries, processed, skipped, skippedUnsafe, total };
});

ipcMain.handle('translate:importTranslations', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Виберіть один або кілька файлів з готовими перекладами',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Таблиці перекладів (HTML/CSV/TSV)', extensions: ['html', 'htm', 'tsv', 'csv'] },
      { name: 'HTML', extensions: ['html', 'htm'] },
      { name: 'TSV/CSV', extensions: ['tsv', 'csv'] },
      { name: 'Усі файли', extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };

  const allPairs = [];
  const sources = [];
  const errors = [];
  for (const fp of r.filePaths) {
    try {
      const result = importTranslationsFile(fp);
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

ipcMain.handle('translate:composeAll', async (_e, payload) => {
  const engDir = payload && payload.engDir;
  const rusDir = payload && payload.rusDir;
  const outDir = payload && payload.outDir;
  const tsvDir = payload && payload.tsvDir; // optional, для per-file overrides
  const files = (payload && payload.files) || [];
  const glossary = (payload && payload.glossary) || {};
  const opts = (payload && payload.opts) || {};
  const safeMode = payload && payload.safeMode !== false;

  if (!engDir || !rusDir || !outDir || !files.length) {
    return { error: 'Не задано теки/файли' };
  }

  let processed = 0;
  let written = 0;
  let skippedNoTranslations = 0;
  let skippedUnsafe = 0;
  let totalReplacements = 0;
  const errors = [];
  const total = files.length;

  for (const rel of files) {
    const engPath = path.join(engDir, rel);
    const rusPath = path.join(rusDir, rel);
    const outPath = path.join(outDir, rel);

    if (!fsSync.existsSync(engPath) || !fsSync.existsSync(rusPath)) {
      processed++;
      sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel, skipped: true });
      continue;
    }

    const ext = path.extname(rel).toLowerCase();
    const cls = classifyFile(engPath, ext);

    // Safe mode: не чіпати .evdl/байткод/інше
    if (safeMode && !cls.isTranslatable) {
      skippedUnsafe++;
      processed++;
      sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel, skipped: 'unsafe' });
      continue;
    }

    try {
      // ===== Спецгілка для .ev/.evdl: парсимо локально, не через worker =====
      if (cls.kind === 'ev') {
        const codecLocal = require('./shared/codec');
        const evBuf = await fs.readFile(engPath);
        const parsed = parseEv(evBuf, codecLocal);
        // optional per-file overrides from TSV
        let perFileMap = null;
        if (tsvDir) {
          const tsvPath = path.join(tsvDir, rel) + '.tsv';
          if (fsSync.existsSync(tsvPath)) {
            try {
              const txt = await fs.readFile(tsvPath, 'utf8');
              perFileMap = parseTsvOverrides(txt);
            } catch (_) {}
          }
        }
        let appliedCount = 0;
        const slotsForCompose = parsed.slots.map(s => {
          let uk = '';
          if (perFileMap && perFileMap.has(s.offset)) uk = perFileMap.get(s.offset);
          if (!uk && Object.prototype.hasOwnProperty.call(glossary, s.english)) {
            uk = glossary[s.english];
          }
          if (uk && uk.trim() && uk !== s.english) {
            uk = preserveStructure(s.english, uk);
            appliedCount++;
            return Object.assign({}, s, { ukText: uk });
          }
          return Object.assign({}, s, { ukText: s.english });
        });
        if (appliedCount === 0) {
          skippedNoTranslations++;
          processed++;
          sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel, skipped: 'no-translations' });
          continue;
        }
        const composed = composeEv(evBuf, slotsForCompose, codecLocal);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, composed.buf);
        written++;
        totalReplacements += appliedCount;
        processed++;
        sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel });
        continue;
      }
      // ===== Спецгілка для *_mes_ofs.bin (паре mes-ofs+mes-data) =====
      if (cls.kind === 'mesofs') {
        const codecLocal = require('./shared/codec');
        const dataPath = cls.extractOpts && cls.extractOpts.dataPath;
        if (!dataPath || !fsSync.existsSync(dataPath)) {
          errors.push({ rel, error: 'mesofs: pair _mes_data.bin not found' });
          processed++;
          sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel, skipped: 'no-pair' });
          continue;
        }
        const ofsBuf = await fs.readFile(engPath);
        const dataBuf = await fs.readFile(dataPath);
        const parsed = parseMesOfs(ofsBuf, dataBuf, codecLocal);
        let perFileMap = null;
        if (tsvDir) {
          const tsvPath = path.join(tsvDir, rel) + '.tsv';
          if (fsSync.existsSync(tsvPath)) {
            try {
              const txt = await fs.readFile(tsvPath, 'utf8');
              perFileMap = parseTsvOverrides(txt);
            } catch (_) {}
          }
        }
        let appliedCount = 0;
        const slotsForCompose = parsed.slots.map(s => {
          let uk = '';
          if (perFileMap && perFileMap.has(s.offset)) uk = perFileMap.get(s.offset);
          if (!uk && Object.prototype.hasOwnProperty.call(glossary, s.english)) {
            uk = glossary[s.english];
          }
          if (uk && uk.trim() && uk !== s.english) {
            uk = preserveStructure(s.english, uk);
            appliedCount++;
            return Object.assign({}, s, { ukText: uk });
          }
          return Object.assign({}, s, { ukText: s.english });
        });
        if (appliedCount === 0) {
          skippedNoTranslations++;
          processed++;
          sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel, skipped: 'no-translations' });
          continue;
        }
        const composed = composeMesOfs(slotsForCompose, {
          ofsLength: ofsBuf.length,
          dataLength: dataBuf.length,
          cellLengthByOffset: parsed.cellLengthByOffset
        }, codecLocal);
        const outDataPath = path.join(path.dirname(outPath), pairedDataName(path.basename(outPath)));
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, composed.ofsBuf);
        await fs.writeFile(outDataPath, composed.dataBuf);
        written++;
        totalReplacements += appliedCount;
        processed++;
        sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel });
        continue;
      }
      // ===== Звичайний шлях через worker =====
      const eng = await fs.readFile(engPath);
      const rus = await fs.readFile(rusPath);
      const engAb = eng.buffer.slice(eng.byteOffset, eng.byteOffset + eng.byteLength);
      const rusAb = rus.buffer.slice(rus.byteOffset, rus.byteOffset + rus.byteLength);

      const fileOpts = Object.assign({}, cls.extractOpts || {}, opts);
      const extResult = await runWorker(
        { op: 'extract', eng: engAb, rus: rusAb, opts: fileOpts },
        [engAb, rusAb]
      );

      // optional per-file overrides from TSV
      let perFileMap = null;
      if (tsvDir) {
        const tsvPath = path.join(tsvDir, rel) + '.tsv';
        if (fsSync.existsSync(tsvPath)) {
          try {
            const txt = await fs.readFile(tsvPath, 'utf8');
            perFileMap = parseTsvOverrides(txt);
          } catch (_) {}
        }
      }

      const replacements = [];
      for (const slot of extResult.slots) {
        let uk = '';
        if (perFileMap && perFileMap.has(slot.offset)) uk = perFileMap.get(slot.offset);
        if (!uk && Object.prototype.hasOwnProperty.call(glossary, slot.english)) {
          uk = glossary[slot.english];
        }
        if (uk && uk.trim() && uk !== slot.english) {
          uk = preserveStructure(slot.english, uk);
          replacements.push({ offset: slot.offset, oldLen: slot.byteLen, ukText: uk });
        }
      }

      if (replacements.length === 0) {
        skippedNoTranslations++;
        processed++;
        sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel, skipped: 'no-translations' });
        continue;
      }

      const eng2 = await fs.readFile(engPath);
      const eng2Ab = eng2.buffer.slice(eng2.byteOffset, eng2.byteOffset + eng2.byteLength);
      const cmp = await runWorker(
        { op: 'compose', eng: eng2Ab, replacements },
        [eng2Ab]
      );

      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, Buffer.from(cmp.bytes));

      written++;
      totalReplacements += cmp.applied || 0;
      if (cmp.errors && cmp.errors.length) {
        errors.push({ rel, count: cmp.errors.length, samples: cmp.errors.slice(0, 3) });
      }
    } catch (e) {
      errors.push({ rel, error: (e && e.message) || String(e) });
    }

    processed++;
    sendProgress({ phase: 'compose-all', done: processed, total, currentFile: rel });
  }

  return {
    ok: true,
    processed,
    written,
    skippedNoTranslations,
    skippedUnsafe,
    totalReplacements,
    errors
  };
});

function preserveStructure(originalEng, userUk) {
  if (!userUk || !originalEng) return userUk || '';
  let r = userUk;
  const lead = originalEng.match(/^[ \t]+/);
  if (lead && !/^[ \t]/.test(r)) r = lead[0] + r;
  const trail = originalEng.match(/[ \t]+$/);
  if (trail && !/[ \t]$/.test(r)) r = r + trail[0];
  return r;
}

function parseTsvOverrides(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length < 1) return null;
  const header = lines[0].split('\t');
  const idxOff = header.indexOf('offset');
  const idxUk = header.indexOf('ukrainian');
  if (idxOff < 0 || idxUk < 0) return null;
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const off = parseInt(cols[idxOff], 16);
    let uk = cols[idxUk] || '';
    uk = uk.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (Number.isFinite(off) && uk) map.set(off, uk);
  }
  return map;
}

ipcMain.handle('translate:getWorldsMap', async () => {
  try {
    const txt = await fs.readFile(path.join(__dirname, 'data', 'worlds.json'), 'utf8');
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
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Експортувати переклад у .txt',
    defaultPath: defaultName,
    filters: [
      { name: 'Текстові файли (*.txt)', extensions: ['txt'] },
      { name: 'Усі файли', extensions: ['*'] }
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
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Імпортувати переклад з .txt',
    properties: ['openFile'],
    filters: [
      { name: 'Текстові файли (*.txt)', extensions: ['txt'] },
      { name: 'Усі файли', extensions: ['*'] }
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

// =====================================================================
// Kerning editor: завантаження/збереження .knj + auto-find .dds
// =====================================================================
ipcMain.handle('kerning:openKnj', async () => {
  const settings = loadSettings();
  const r = await dialog.showOpenDialog(mainWindow, {
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
    saveSettings(Object.assign(loadSettings(), { lastKnjPath: r.filePaths[0] }));
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
  const r = await dialog.showOpenDialog(mainWindow, {
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
    return { ok: true, filePath: r.filePaths[0], data: ab };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
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
    const single = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'kh1sys_text.json'), 'utf8'));
    const ua = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'ukrainian.json'), 'utf8'));
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

// =====================================================================
// Auto-wrap by font metrics — використовує .knj kerning info, щоб
// автоматично вставити {lf} між словами де UK-переклад не вміщується
// в задану максимальну ширину (~440 px типово).
// =====================================================================
const codecForWrap = require('./shared/codec');
const WRAP_KERNING_OFFSET = 0x40080;
const WRAP_SPACE_PX = 10;
const WRAP_MAX_GLYPHS = 230;

function measureBytesWithKnj(bytes, knj) {
  let w = 0;
  for (const b of bytes) {
    if (b === 0x00) continue;
    if (b === 0x01) { w += WRAP_SPACE_PX; continue; }
    if (b === 0x02) continue; // {lf}
    const idx = b - 32;
    if (idx < 0 || idx >= WRAP_MAX_GLYPHS) continue;
    w += (knj[WRAP_KERNING_OFFSET + idx] || 0) * 2;
  }
  return w;
}

function safeEncode(text) {
  try { return codecForWrap.encode(text); }
  catch (_) { return new Uint8Array(0); }
}

function autoWrapText(text, maxWidth, knj) {
  if (!text || !knj) return text;
  // Зберігаємо існуючі {lf} як hard breaks
  const lines = text.split('{lf}');
  const out = [];
  const spaceW = measureBytesWithKnj(safeEncode(' '), knj);
  for (const line of lines) {
    // Розбиваємо на токени по пробілах, але зберігаємо {tokens}
    const words = line.split(/\s+/).filter(w => w.length > 0);
    if (!words.length) { out.push(line); continue; }
    let currLine = words[0];
    let currWidth = measureBytesWithKnj(safeEncode(currLine), knj);
    const wrapped = [];
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      const wWidth = measureBytesWithKnj(safeEncode(w), knj);
      const need = currWidth + spaceW + wWidth;
      if (need > maxWidth && currLine.length > 0) {
        wrapped.push(currLine);
        currLine = w;
        currWidth = wWidth;
      } else {
        currLine += ' ' + w;
        currWidth = need;
      }
    }
    wrapped.push(currLine);
    out.push(wrapped.join('{lf}'));
  }
  return out.join('{lf}');
}

ipcMain.handle('translate:measureMany', async (_e, payload) => {
  const texts = (payload && payload.texts) || [];
  const knjData = payload && payload.knjData;
  if (!knjData) return { error: 'no knj' };
  try {
    const knj = new Uint8Array(knjData);
    const widths = texts.map(t => {
      // Для багаторядкового тексту вертаємо max ширину рядка
      if (!t) return 0;
      const lines = String(t).split('{lf}');
      let mx = 0;
      for (const ln of lines) {
        const w = measureBytesWithKnj(safeEncode(ln), knj);
        if (w > mx) mx = w;
      }
      return mx;
    });
    return { ok: true, widths };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:autoWrap', async (_e, payload) => {
  const texts = (payload && payload.texts) || [];
  const knjData = payload && payload.knjData;
  const maxWidth = (payload && payload.maxWidth) || 440;
  if (!knjData) return { error: 'no knj' };
  try {
    const knj = new Uint8Array(knjData);
    const wrapped = texts.map(t => {
      try { return autoWrapText(String(t || ''), maxWidth, knj); }
      catch (_) { return t; }
    });
    return { ok: true, wrapped };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

// =====================================================================
// Adaptive auto-wrap — копіюємо структуру EN 1:1.
//   1) Розкладаємо EN та UK на (prefix, body, suffix), де prefix/suffix —
//      провідні/завершальні фігурні токени (керівні байти + {lf}), а body
//      — все, що містить видимий текст.
//   2) Префікс і суфікс беремо ВЛАСНЕ з EN (бо це формат гри/контролер
//      курсорів-діалогу — не переклад).
//   3) UK body «розгортаємо»: прибираємо існуючі {lf}, очищаємо пробіли
//      впритул до керівних токенів {0xXX}.
//   4) Беремо `N` = скільки {lf} було в EN body. Розставляємо в UK body
//      рівно стільки ж — у пропорційно близьких до EN позиціях, з
//      перевагою межам речення (.!?) і коми (,:;).
//      Якщо UK слів менше за N+1 — fallback: кожне слово на свій рядок.
// =====================================================================
function splitPrefSuf(text) {
  if (!text) return { prefix: '', body: '', suffix: '' };
  // Префікс: послідовні провідні `{...}` токени (без пробілів між ними).
  let prefixEnd = 0;
  while (prefixEnd < text.length && text[prefixEnd] === '{') {
    const close = text.indexOf('}', prefixEnd);
    if (close < 0) break;
    prefixEnd = close + 1;
  }
  // Суфікс: послідовні завершальні `{...}` токени (без пробілів між ними).
  let suffixStart = text.length;
  while (suffixStart > 0 && text[suffixStart - 1] === '}') {
    const open = text.lastIndexOf('{', suffixStart - 1);
    if (open < 0) break;
    suffixStart = open;
  }
  // Захист від оверлапу (короткі рядки на кшталт `{lf}` без видимого тексту).
  if (suffixStart < prefixEnd) {
    return { prefix: text.slice(0, prefixEnd), body: '', suffix: '' };
  }
  return {
    prefix: text.slice(0, prefixEnd),
    body: text.slice(prefixEnd, suffixStart),
    suffix: text.slice(suffixStart)
  };
}

function tokenizeWords(text) {
  // Слова, де токен `{...}` — частина слова (не точка розриву).
  const out = [];
  let cur = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      i++; continue;
    }
    if (ch === '{') {
      const close = text.indexOf('}', i);
      if (close < 0) { cur += text.slice(i); break; }
      cur += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur) out.push(cur);
  return out;
}

function cleanUkBody(body) {
  return body
    .replace(/\{lf\}/g, ' ')
    .replace(/\s+(\{0x[0-9A-Fa-f]{2}\})/g, '$1')
    .replace(/(\{0x[0-9A-Fa-f]{2}\})\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeBreaks(ukFlat, enWidths, knj) {
  const N = enWidths.length - 1; // кількість {lf} у EN body
  if (N <= 0) return ukFlat;
  const words = tokenizeWords(ukFlat);
  if (words.length <= N) return words.join('{lf}');

  const spaceW = measureBytesWithKnj(safeEncode(' '), knj);
  const wordW = words.map(w => measureBytesWithKnj(safeEncode(w), knj));
  const cum = [];
  let s = 0;
  for (let i = 0; i < words.length; i++) {
    if (i > 0) s += spaceW;
    s += wordW[i];
    cum.push(s);
  }
  const totalUk = cum[cum.length - 1] || 1;
  const totalEn = enWidths.reduce((a, b) => a + b, 0) || 1;

  // Цільові кумулятивні позиції (у px) для кожного {lf}.
  const targets = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += enWidths[i];
    targets.push((acc / totalEn) * totalUk);
  }

  const breakIdxs = [];
  let lo = 0;
  for (let k = 0; k < N; k++) {
    const tw = targets[k];
    const remain = N - k - 1;
    const hi = words.length - 2 - remain;
    let bestIdx = lo;
    let bestScore = Infinity;
    for (let i = lo; i <= hi; i++) {
      const stripped = words[i].replace(/\{[^{}]*\}/g, '');
      const lastChar = stripped.slice(-1);
      let punctBonus = 0;
      if (/[.!?]/.test(lastChar)) punctBonus = -25;
      else if (/[,;:]/.test(lastChar)) punctBonus = -8;
      const score = Math.abs(cum[i] - tw) + punctBonus;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
    breakIdxs.push(bestIdx);
    lo = bestIdx + 1;
  }

  const out = [];
  let last = 0;
  for (const bi of breakIdxs) {
    out.push(words.slice(last, bi + 1).join(' '));
    last = bi + 1;
  }
  out.push(words.slice(last).join(' '));
  return out.join('{lf}');
}

ipcMain.handle('translate:autoWrapAdaptive', async (_e, payload) => {
  const pairs = (payload && payload.pairs) || [];
  const knjData = payload && payload.knjData;
  if (!knjData) return { error: 'no knj' };
  try {
    const knj = new Uint8Array(knjData);
    const wrapped = pairs.map(p => {
      try {
        const en = String((p && p.en) || '');
        const uk = String((p && p.uk) || '');
        if (!uk) return uk;
        const enS = splitPrefSuf(en);
        const ukS = splitPrefSuf(uk);
        const ukBody = cleanUkBody(ukS.body || '');
        if (!ukBody) {
          // Тільки контрольні токени — повертаємо UK як є (нічого розставляти).
          return uk;
        }
        const enLines = enS.body.split('{lf}');
        const N = enLines.length - 1;
        let newBody;
        if (N <= 0) {
          newBody = ukBody;
        } else {
          const enWidths = enLines.map(ln =>
            measureBytesWithKnj(safeEncode(ln), knj)
          );
          newBody = placeBreaks(ukBody, enWidths, knj);
        }
        return enS.prefix + newBody + enS.suffix;
      } catch (_) { return p && p.uk; }
    });
    return { ok: true, wrapped };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
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
  const r = await dialog.showSaveDialog(mainWindow, {
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

// =====================================================================
// Auto-update (electron-updater) — для NSIS installer; portable отримує
// тільки повідомлення "є нова версія, скачай вручну".
// =====================================================================
function sendUpdate(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload || null);
  }
}

let updaterReady = false;
function setupAutoUpdater() {
  if (!autoUpdater || updaterReady) return;
  updaterReady = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => sendUpdate('update:checking'));
  autoUpdater.on('update-available', (info) => sendUpdate('update:available', {
    version: info && info.version,
    releaseDate: info && info.releaseDate,
    releaseNotes: info && info.releaseNotes,
    portable: isPortable,
    repo: 'https://github.com/LittleBitUA/KH1TextEditor/releases/latest'
  }));
  autoUpdater.on('update-not-available', () => sendUpdate('update:none'));
  autoUpdater.on('error', (err) => sendUpdate('update:error', { message: (err && err.message) || String(err) }));
  autoUpdater.on('download-progress', (p) => sendUpdate('update:progress', {
    percent: Math.round((p && p.percent) || 0),
    bytesPerSecond: (p && p.bytesPerSecond) || 0,
    transferred: (p && p.transferred) || 0,
    total: (p && p.total) || 0
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate('update:downloaded', {
    version: info && info.version
  }));
}

ipcMain.handle('app:checkForUpdates', async () => {
  if (!autoUpdater) return { ok: false, error: 'electron-updater не доступний у цьому збірці' };
  setupAutoUpdater();
  try {
    const r = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      portable: isPortable,
      version: r && r.updateInfo ? r.updateInfo.version : null,
      currentVersion: app.getVersion()
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('app:downloadUpdate', async () => {
  if (!autoUpdater) return { ok: false, error: 'updater не доступний' };
  if (isPortable) return { ok: false, error: 'portable cannot auto-update' };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('app:installUpdate', () => {
  if (!autoUpdater || isPortable) return { ok: false };
  try { autoUpdater.quitAndInstall(false, true); return { ok: true }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

ipcMain.handle('app:openExternal', async (_e, url) => {
  if (typeof url !== 'string') return { ok: false };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'unsupported protocol' };
  try { await shell.openExternal(url); return { ok: true }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

ipcMain.handle('app:setLanguage', (_e, lang) => {
  appLang = (lang === 'en') ? 'en' : 'uk';
  try {
    const s = loadSettings();
    s.language = appLang;
    saveSettings(s);
  } catch (_) {}
  buildMenu();
  return { ok: true, lang: appLang };
});

ipcMain.handle('app:about', () => ({
  name: 'Редактор тексту Kingdom Hearts 1',
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome
}));

function buildMenu() {
  const send = (channel) => () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel);
    }
  };

  const template = [
    {
      label: ml('file'),
      submenu: [
        { label: ml('import'), accelerator: 'CmdOrCtrl+O', click: send('menu:open') },
        { label: ml('export'), accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { type: 'separator' },
        { label: ml('modeEditor'), accelerator: 'CmdOrCtrl+1', click: send('menu:mode-editor') },
        { label: ml('modeTranslate'), accelerator: 'CmdOrCtrl+2', click: send('menu:mode-translate') },
        { label: ml('modeKerning'), accelerator: 'CmdOrCtrl+3', click: send('menu:mode-kerning') },
        { type: 'separator' },
        { label: ml('quit'), role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    {
      label: ml('edit'),
      submenu: [
        { label: ml('undo'), role: 'undo' },
        { label: ml('redo'), role: 'redo' },
        { type: 'separator' },
        { label: ml('cut'), role: 'cut' },
        { label: ml('copy'), role: 'copy' },
        { label: ml('paste'), role: 'paste' },
        { label: ml('selectAll'), role: 'selectAll' },
        { type: 'separator' },
        { label: ml('find'), accelerator: 'CmdOrCtrl+F', click: send('menu:find') },
        { label: ml('findNext'), accelerator: 'F3', click: send('menu:find-next') },
        { label: ml('replace'), accelerator: 'CmdOrCtrl+H', click: send('menu:replace') }
      ]
    },
    {
      label: ml('view'),
      submenu: [
        { label: ml('reload'), role: 'reload' },
        { label: ml('devTools'), role: 'toggleDevTools' },
        { type: 'separator' },
        { label: ml('zoomIn'), role: 'zoomIn' },
        { label: ml('zoomOut'), role: 'zoomOut' },
        { label: ml('resetZoom'), role: 'resetZoom' },
        { type: 'separator' },
        { label: ml('fullscreen'), role: 'togglefullscreen' }
      ]
    },
    {
      label: ml('help'),
      submenu: [
        { label: ml('checkUpdates'), click: send('menu:check-updates') },
        { type: 'separator' },
        { label: ml('about'), click: send('menu:about') }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#050b1f',
    title: 'Редактор тексту Kingdom Hearts 1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  try {
    const s = loadSettings();
    if (s && (s.language === 'en' || s.language === 'uk')) appLang = s.language;
  } catch (_) {}
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (workerInstance) {
    try { workerInstance.terminate(); } catch (_) {}
    workerInstance = null;
  }
});
