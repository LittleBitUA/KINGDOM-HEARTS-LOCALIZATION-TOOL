'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { Worker } = require('worker_threads');
const { writeFileAtomic, writeFileAtomicSync } = require('./shared/safe-fs');
const tsv = require('./shared/tsv');
const { preserveStructure } = require('./shared/text-structure');
const codec = require('./shared/codec');

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

// =====================================================================
// Worker pool — паралельне виконання codec-worker задач.
// Замість одного worker'а тримаємо POOL_SIZE workers і розподіляємо задачі
// round-robin. Кожен worker має своє pending-map. Це дозволяє buildGlossary
// та composeAll обробляти 4-8 файлів одночасно (CPU cores), що зменшує
// загальний час у кілька разів.
// =====================================================================
const POOL_SIZE = Math.max(2, Math.min(8, require('os').cpus().length));
let workerSeq = 0;
const workerPool = [];   // [{ worker, pending: Map<id, {resolve, reject}> }]
let workerRR = 0;        // round-robin counter

function rejectWorkerPending(slot, reason) {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  for (const { reject } of slot.pending.values()) reject(err);
  slot.pending.clear();
}

function makeWorkerSlot() {
  const w = new Worker(path.join(__dirname, 'workers', 'codec-worker.js'));
  const slot = { worker: w, pending: new Map() };
  w.on('message', (msg) => {
    const id = msg && msg.id;
    const p = slot.pending.get(id);
    if (!p) return;
    slot.pending.delete(id);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error || 'Помилка обробника'));
  });
  w.on('error', (err) => {
    rejectWorkerPending(slot, err);
    // позначити slot як «мертвий»; перестворимо на наступному виклику
    slot.dead = true;
  });
  w.on('exit', () => {
    rejectWorkerPending(slot, 'Обробник завершив роботу');
    slot.dead = true;
  });
  return slot;
}

function getWorkerSlot() {
  // Лінива ініціалізація pool'а на перший виклик.
  if (workerPool.length === 0) {
    for (let i = 0; i < POOL_SIZE; i++) workerPool.push(makeWorkerSlot());
  }
  // Перебудуй якщо якийсь slot помер.
  for (let i = 0; i < workerPool.length; i++) {
    if (workerPool[i].dead) workerPool[i] = makeWorkerSlot();
  }
  // Стратегія: round-robin серед slot'ів. Простіше за least-loaded і
  // на практиці добре розподіляє рівномірне навантаження (всі задачі ~однакові).
  const slot = workerPool[workerRR % workerPool.length];
  workerRR++;
  return slot;
}

function runWorker(payload, transferList) {
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    const slot = getWorkerSlot();
    slot.pending.set(id, { resolve, reject });
    try {
      slot.worker.postMessage(Object.assign({ id }, payload), transferList || []);
    } catch (e) {
      slot.pending.delete(id);
      reject(e);
    }
  });
}

const FILE_FILTERS_OPEN = [
  { name: 'Підтримувані файли (*.bin;*.binl;*.ard;*.ctdl)', extensions: ['bin', 'binl', 'ard', 'ctdl'] },
  { name: 'BIN файли (*.bin)', extensions: ['bin'] },
  { name: 'BINL файли (*.binl)', extensions: ['binl'] },
  { name: 'ARD файли (*.ard)', extensions: ['ard'] },
  { name: 'CTDL файли (*.ctdl)', extensions: ['ctdl'] },
  { name: 'Усі файли', extensions: ['*'] }
];

const FILE_FILTERS_SAVE = [
  { name: 'BIN файли (*.bin)', extensions: ['bin'] },
  { name: 'BINL файли (*.binl)', extensions: ['binl'] },
  { name: 'ARD файли (*.ard)', extensions: ['ard'] },
  { name: 'CTDL файли (*.ctdl)', extensions: ['ctdl'] },
  { name: 'Усі файли', extensions: ['*'] }
];

ipcMain.handle('file:open', async (_e, opts) => {
  // decodeMode: 'smart' (default) | 'overlay' | 'base' — див. shared/codec.js
  const decodeMode = (opts && ['smart', 'overlay', 'base'].includes(opts.decodeMode)) ? opts.decodeMode : 'smart';
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
    const r = await runWorker({ op: 'decode', bytes: ab, decodeMode }, [ab]);
    return {
      canceled: false,
      decodeMode,
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

// Дир-ключі специфічні для гри (різні теки для KH1 та BBS).
const GAME_DIR_KEYS = ['engDir', 'rusDir', 'outDir', 'tsvDir', 'lastFile'];

// === Стандартна структура воркспейса ===
// При старті створюємо ці теки (якщо не існують) і пропонуємо як defaults
// у Settings, поки користувач не перевизначить власними шляхами.
//
// Базова root-тека: ~/Documents/KH-Localization/   (можна замінити, зберігається у settings.localizationRoot)
//   KH-Localization/
//     KH1/
//       ENG/        — engDir
//       MYFILES/    — rusDir (історична назва "RUS"; тепер це reference-файли користувача)
//       PROGRESS/   — tsvDir
//       DONE/       — outDir (готові перекладені файли)
//     BBS/
//       ENG/        — engDir
//       PROGRESS/   — tsvDir
//       DONE/       — outDir
const DEFAULT_LOC_ROOT = path.join(app.getPath('documents'), 'KH-Localization');
const GAME_DIR_LAYOUT = {
  'kh1-final-mix': {
    base: 'KH1',
    dirs: { engDir: 'ENG', rusDir: 'MYFILES', tsvDir: 'PROGRESS', outDir: 'DONE' }
  },
  'kh-bbs-final-mix': {
    base: 'BBS',
    dirs: { engDir: 'ENG', tsvDir: 'PROGRESS', outDir: 'DONE' }
  },
  'kh-re-com': {
    base: 'ReCoM',
    // FILES виконує роль engDir: туди copy-step кладе оригінальні
    // UK_*.ctdl з розпакованого Recom.hed_out зі збереженням ієрархії,
    // і Translate-режим читає звідти список файлів. Окрема ENG-тека
    // не потрібна, бо джерело тексту вже UK_-файли (gameLang = en).
    dirs: { engDir: 'FILES', tsvDir: 'PROGRESS', outDir: 'DONE' }
  }
};

function ensureLocalizationDirs(root) {
  for (const info of Object.values(GAME_DIR_LAYOUT)) {
    for (const sub of Object.values(info.dirs)) {
      const p = path.join(root, info.base, sub);
      try { fsSync.mkdirSync(p, { recursive: true }); } catch (_) {}
    }
  }
}

function getDefaultsForGame(gameId, root) {
  const info = GAME_DIR_LAYOUT[gameId];
  if (!info) return {};
  const out = {};
  for (const [k, sub] of Object.entries(info.dirs)) {
    out[k] = path.join(root, info.base, sub);
  }
  return out;
}

// Єдина точка запису settings-файла: атомарно + 3 бекапи.
function writeSettingsRaw(obj) {
  writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(obj, null, 2), { encoding: 'utf8', backups: 3 });
}

function loadSettingsRaw() {
  try {
    return JSON.parse(fsSync.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

// Migrate flat schema (старий формат до v2.21) → games.kh1-final-mix.*
function migrateIfNeeded(raw) {
  if (raw.games) return raw;
  const games = {};
  const flatDirs = {};
  for (const k of GAME_DIR_KEYS) {
    if (raw[k]) flatDirs[k] = raw[k];
  }
  if (Object.keys(flatDirs).length) {
    games['kh1-final-mix'] = flatDirs;
  }
  // Усе інше (language/theme/lastKnjPath/lastDdsPath) лишається як global.
  const out = Object.assign({}, raw);
  for (const k of GAME_DIR_KEYS) delete out[k];
  out.games = games;
  return out;
}

// loadSettings(gameId?) — повертає merged:
//   globals + DEFAULTS-from-layout + persisted-game-scoped (override)
// Якщо gameId не вказано, повертає лише global keys (без dirs).
function loadSettings(gameId) {
  const raw = migrateIfNeeded(loadSettingsRaw());
  const globals = Object.assign({}, raw);
  delete globals.games;
  const root = raw.localizationRoot || DEFAULT_LOC_ROOT;
  if (!gameId) {
    const kh1 = (raw.games && raw.games['kh1-final-mix']) || {};
    const defaults = getDefaultsForGame('kh1-final-mix', root);
    return Object.assign(globals, defaults, kh1);
  }
  const gameSettings = (raw.games && raw.games[gameId]) || {};
  const defaults = getDefaultsForGame(gameId, root);
  // defaults перекриваються тим, що користувач сам вибрав
  return Object.assign(globals, defaults, gameSettings);
}

// saveSettings(partial, gameId?) — мерджить partial у відповідне місце.
// Поля з GAME_DIR_KEYS → games[gameId]. Усе інше → top level.
function saveSettings(partial, gameId) {
  const raw = migrateIfNeeded(loadSettingsRaw());
  const out = Object.assign({}, raw);
  out.games = Object.assign({}, raw.games || {});

  for (const [k, v] of Object.entries(partial || {})) {
    if (GAME_DIR_KEYS.includes(k)) {
      const gid = gameId || 'kh1-final-mix';
      out.games[gid] = Object.assign({}, out.games[gid] || {}, { [k]: v });
    } else {
      out[k] = v;
    }
  }

  try {
    writeSettingsRaw(out);
  } catch (e) {
    console.error('settings: write failed:', e && e.message);
  }
  return loadSettings(gameId);
}

// .binl магічна сигнатура: ASCII "EvMsg" перші 5 байт
const BINL_MAGIC = Buffer.from([0x45, 0x76, 0x4D, 0x73, 0x67]);
// .ard магічна сигнатура (KGR + NUL) — контейнер, не редагується напряму
const ARD_MAGIC = Buffer.from([0x4B, 0x47, 0x52, 0x00]);

const { parsePair: parseMesOfs, composePair: composeMesOfs, isMesOfsName, pairedDataName } = require('./tools/lib/mes-ofs');
const { parseEv, composeEv, isEvName } = require('./tools/lib/ev-format');
const { parseCtd, composeCtd, MAGIC: CTD_MAGIC } = require('./tools/lib/ctd-format');
const ctdCodec = require('./tools/lib/ctd-codec');
const bbsFont = require('./tools/lib/bbs-font');
// Re:Chain of Memories CTDL — інший формат, але ділить magic '@CTD' з BBS.
// Розрізняємо за розширенням файлу: .ctdl → Re:CoM, .ctd → BBS.
const { parseCtdl, composeCtdl, MAGIC: CTDL_MAGIC } = require('./tools/lib/recom-ctdl-format');
const recomCodec = require('./tools/lib/recom-ctdl-codec');

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
  // .ctd — Birth By Sleep dialogue/menu container з message-table + text-блоком.
  // Magic '@CTD' (0x44544340 LE) перевіряємо нижче в byte-sniffing блоці,
  // але швидку перевірку за розширенням робимо перед відкриттям файлу.
  try {
    const fd = fsSync.openSync(absPath, 'r');
    const buf = Buffer.alloc(256);
    const n = fsSync.readSync(fd, buf, 0, 256, 0);
    fsSync.closeSync(fd);
    // BBS .ctd і Re:CoM .ctdl ділять однаковий magic '@CTD' (0x44544340 LE).
    // Розрізняємо за РОЗШИРЕННЯМ файлу: .ctdl → Re:CoM (інший layout header),
    // .ctd → BBS. Перевіряємо .ctdl першим, щоб BBS-парсер не зачепив його.
    if (n >= 4 && ext === '.ctdl' && buf.readUInt32LE(0) === CTDL_MAGIC) {
      return { kind: 'ctdl', magic: '@CTD', extractOpts: null, isTranslatable: true };
    }
    if (n >= 4 && buf.readUInt32LE(0) === CTD_MAGIC) {
      return { kind: 'ctd', magic: '@CTD', extractOpts: null, isTranslatable: true };
    }
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
// Якщо gameId не передано — KH1 як legacy fallback.
ipcMain.handle('translate:getSettings', (_e, gameId) => loadSettings(gameId || null));

// translate:saveSettings(partial, gameId?) — partial мерджиться. Поля dirs (engDir
// /rusDir/etc) йдуть у games[gameId]; глобальні (theme/language/etc) — на верх.
ipcMain.handle('translate:saveSettings', (_e, payload, gameId) => {
  // Backward compat: якщо payload — це повний об'єкт settings, поведінка та сама.
  return saveSettings(payload || {}, gameId || null);
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
    if (cls.kind === 'ctd') {
      // BBS dialogue/menu container — кожне message → translatable slot.
      // offset = message id (unique 32-bit per file), щоб compose міг знайти
      // правильний слот за payload.replacements[i].offset.
      const buf = await fs.readFile(engPath);
      const parsed = parseCtd(buf);
      const uiSlots = parsed.messages.map((m, i) => ({
        index: i,
        offset: m.id,                  // id як ключ (unique per file)
        absOffset: m.textOffset,
        byteLen: m._origByteLen,
        // english показуємо у канонічній OpenKh-формі (без 2-х байтів
        // F1/F2/F5 unknowns) — щоб UI співпадав з тим що бачать у OpenKh
        // CTD Editor і з ключами імпортованого глосарія.
        english: ctdCodec.glossaryKey(m.text),
        // зберігаємо повний текст для відновлення 2-х байтів при compose
        _fullText: m.text,
        ukText: ''
      }));
      return {
        slots: uiSlots,
        stats: {
          ctd: true,
          fileId: parsed.header.fileId,
          messageCount: parsed.messages.length,
          layoutCount: parsed.layouts.count,
          fileSize: buf.length
        },
        engSize: buf.length,
        rusSize: 0
      };
    }
    if (cls.kind === 'ctdl') {
      // Re:CoM CTDL — кожен text entry стає translatable slot. Як ключ
      // (offset) використовуємо index entry (унікальний всередині файлу).
      const buf = await fs.readFile(engPath);
      const parsed = parseCtdl(buf);
      const uiSlots = parsed.entries.map((e, i) => ({
        index: i,
        offset: e.index,                       // index entry як стабільний ключ
        absOffset: e.absoluteOffset,
        byteLen: e.originalLength,
        english: recomCodec.glossaryKey(e.text),
        _fullText: e.text,
        ukText: ''
      }));
      return {
        slots: uiSlots,
        stats: {
          ctdl: true,
          textboxCount: parsed.textboxes.length,
          entryCount: parsed.entries.length,
          fileSize: buf.length
        },
        engSize: buf.length,
        rusSize: 0
      };
    }
    if (cls.kind === 'ev') {
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

ipcMain.handle('translate:compose', async (_e, payload) => {
  const engPath = payload && payload.engPath;
  const replacements = (payload && payload.replacements) || [];
  const outPath = payload && payload.outPath;
  if (!engPath || !outPath) return { error: 'Не вказано шляхи' };
  try {
    // Спеціальна гілка: mesofs парне записування ofs+data.
    const ext = path.extname(engPath).toLowerCase();
    const cls = classifyFile(engPath, ext);
    if (cls.kind === 'ctd') {
      // CTD compose — застосовуємо UK-переклади до message.text за id.
      // Все інше (header, layouts, message-table структура) лишається
      // ідентичним; composeCtd сам перерахує textOffsets під нові довжини.
      const buf = await fs.readFile(engPath);
      const parsed = parseCtd(buf);
      const ukById = new Map();
      for (const r of replacements) {
        if (r && typeof r.offset === 'number' && r.ukText && r.ukText.length) {
          ukById.set(r.offset, r.ukText);
        }
      }
      let applied = 0;
      for (const m of parsed.messages) {
        if (ukById.has(m.id)) {
          // Restore 2-х байтів F1/F2/F5 у UK-перекладі (UI зберігає uk у
          // canonical-form, бо english теж так показується).
          let uk = ukById.get(m.id);
          uk = ctdCodec.restore2ndBytes(uk, m.text);
          m.text = uk;
          applied++;
        }
      }
      const composed = composeCtd(parsed);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, composed);
      return {
        ok: true,
        outPath,
        byteLength: composed.length,
        applied,
        skipped: parsed.messages.length - applied,
        errors: [],
        ctd: { messageCount: parsed.messages.length, sizeDiff: composed.length - buf.length }
      };
    }
    if (cls.kind === 'ctdl') {
      // Re:CoM CTDL compose — replacement.offset = entry index.
      const buf = await fs.readFile(engPath);
      const parsed = parseCtdl(buf);
      const repMap = new Map();
      for (const r of replacements) {
        if (r && typeof r.offset === 'number' && r.ukText && r.ukText.length) {
          repMap.set(r.offset, r.ukText);
        }
      }
      const composed = composeCtdl(parsed, repMap);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, composed);
      return {
        ok: true,
        outPath,
        byteLength: composed.length,
        applied: repMap.size,
        skipped: parsed.entries.length - repMap.size,
        errors: [],
        ctdl: { entryCount: parsed.entries.length, sizeDiff: composed.length - buf.length }
      };
    }
    if (cls.kind === 'ev') {
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

// ---- Glossary ----
const { readGlossary, saveGlossary } = require('./tools/lib/glossary');
const { importFile: importTranslationsFile } = require('./tools/lib/import-translations');
const setupTools = require('./tools/lib/setup-tools');

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('translate:progress', payload);
  }
}

// ---- Setup-onboarding -----------------------------------------------
//
// Окремий progress-channel `setup:progress` (щоб не плутати з translate-progress
// у composeAll/glossary-build).
function sendSetupProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:progress', payload);
  }
}

// .hed-файли для розпакування через KHPCPatchManager. Перший — preferred-
// шлях відносно game-root, інші — fallback-патерни (регулярки case-insensitive
// на basename). Якщо точний шлях не знайдено, робимо рекурсивний пошук
// у `<gameDir>` за патерном.
const HED_PATHS = {
  'kh-re-com': {
    // gameDir вже вказує на корінь Re:CoM, тому шлях стартує з Image/.
    rel: 'Image/en/Recom.hed',
    namePattern: /^recom\.hed$/i
  }
  // 'kh1-final-mix' / 'kh-bbs-final-mix' — додамо коли підтвердимо точні шляхи
};

// Рекурсивно копіює файли з srcRoot у dstRoot, зберігаючи відносну ієрархію.
// Копіює лише ті, чий basename матчить namePattern (regex). onProgress
// викликається після кожного скопійованого файла зі { copied, lastRel }.
async function _copyMatchingFiles(srcRoot, dstRoot, namePattern, onProgress) {
  const stats = { copied: 0, skippedExisting: 0, scanned: 0, errors: [] };
  const stack = [{ rel: '' }];
  while (stack.length) {
    const { rel } = stack.pop();
    const absDir = path.join(srcRoot, rel);
    let entries;
    try { entries = fsSync.readdirSync(absDir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        stack.push({ rel: childRel });
      } else if (e.isFile()) {
        stats.scanned++;
        if (!namePattern.test(e.name)) continue;
        const srcAbs = path.join(srcRoot, childRel);
        const dstAbs = path.join(dstRoot, childRel);
        try {
          await fs.mkdir(path.dirname(dstAbs), { recursive: true });
          // Перезаписуємо безумовно — це первинна синхронізація з гри.
          await fs.copyFile(srcAbs, dstAbs);
          stats.copied++;
          if (typeof onProgress === 'function' && (stats.copied % 5 === 0 || stats.copied < 5)) {
            try { onProgress({ copied: stats.copied, lastRel: childRel }); } catch (_) {}
          }
        } catch (err) {
          stats.errors.push(childRel + ': ' + (err.message || err));
        }
      }
    }
  }
  return stats;
}

// Швидкий лічильник файлів у dir + перших двох рівнях підпапок.
// Використовується як проксі для прогресу unpack'у.
function _countFilesShallow(rootDir) {
  let n = 0;
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 2) continue;
    let entries;
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      if (e.isFile()) n++;
      else if (e.isDirectory() && depth < 2) {
        stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
      }
      if (n > 100000) return n;
    }
  }
  return n;
}

// Рекурсивний пошук файла за patterned basename. Обмежено depth=6 і
// max-files=50000, щоб не зависнути на гігантських теках.
function findFileByPattern(rootDir, namePattern, maxDepth) {
  const stack = [{ dir: rootDir, depth: 0 }];
  let visited = 0;
  const matches = [];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > (maxDepth || 6)) continue;
    let entries;
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      visited++;
      if (visited > 50000) return matches;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Skip well-known noisy folders
        if (/^(\.git|node_modules|\$RECYCLE\.BIN|System Volume Information)$/i.test(e.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile() && namePattern.test(e.name)) {
        matches.push(full);
      }
    }
  }
  return matches;
}

// Дефолти для setup-екрана: пропонуємо ~/Documents/KH-Localization як
// корінь, а tools — підпапка в ньому. Користувач може все перевизначити.
function getSetupDefaults() {
  const root = path.join(app.getPath('documents'), 'KH-Localization');
  return {
    toolsDir: path.join(root, 'tools'),
    textAssetsDir: root
  };
}

// Повертає поточний стан setup'а: чи завершений + поточні шляхи.
ipcMain.handle('setup:status', async () => {
  const raw = migrateIfNeeded(loadSettingsRaw());
  const defaults = getSetupDefaults();
  // Backwards compat: до v2.23.x не було setupCompleted — користувачі вже
  // мали налаштовані теки. Не змушуємо їх проходити setup повторно.
  let completed = raw.setupCompleted === true;
  if (!('setupCompleted' in raw)) {
    const hasLegacy = !!(raw.localizationRoot ||
      (raw.games && Object.values(raw.games).some(g => g && (g.engDir || g.rusDir || g.outDir || g.tsvDir))));
    if (hasLegacy) completed = true;
  }
  // Перевіряємо чи валідні шляхи (були не видалені після setup'а).
  const toolsDir = raw.toolsDir || '';
  const textAssetsDir = raw.textAssetsDir || '';
  const gameDirectories = raw.gameDirectories || {};
  const activeGame = raw.activeGame || '';
  const validity = {
    toolsDir: toolsDir ? fsSync.existsSync(toolsDir) : false,
    textAssetsDir: textAssetsDir ? fsSync.existsSync(textAssetsDir) : false,
    gameDirectories: {}
  };
  for (const [gid, dir] of Object.entries(gameDirectories)) {
    validity.gameDirectories[gid] = dir ? fsSync.existsSync(dir) : false;
  }
  return {
    completed,
    activeGame,
    gameDirectories,
    toolsDir,
    textAssetsDir,
    defaults,
    validity,
    tools: raw.tools || {}
  };
});

// Скидає setupCompleted щоб користувач міг повторно пройти onboarding.
// НЕ видаляє раніше завантажені інструменти і не чіпає шляхи — лише
// прапорець, щоб renderer показав setup-screen на наступному запуску
// (або негайно, якщо renderer вирішить).
ipcMain.handle('setup:reset', async () => {
  const raw = migrateIfNeeded(loadSettingsRaw());
  raw.setupCompleted = false;
  try {
    writeSettingsRaw(raw);
  } catch (e) {
    return { error: 'Не вдалося оновити налаштування: ' + (e.message || e) };
  }
  return { ok: true };
});

// Запуск повного setup-flow. payload:
//   { activeGame, gameDirectories: {gameId:path}, toolsDir, textAssetsDir,
//     skipDownload?: boolean }
// Прогрес йде через 'setup:progress' з фазами:
//   'check' / 'tools-dir' / 'fetch-openkh' / 'download-openkh' /
//   'fetch-khpcpm' / 'download-khpcpm' / 'persist' / 'done' / 'error'
ipcMain.handle('setup:run', async (_e, payload) => {
  payload = payload || {};
  const activeGame = String(payload.activeGame || '').trim();
  const gameDirectories = payload.gameDirectories || {};
  const toolsDir = String(payload.toolsDir || '').trim();
  const textAssetsDir = String(payload.textAssetsDir || '').trim();
  const skipDownload = !!payload.skipDownload;

  // ----- Перевірка вхідних даних -----
  // activeGame опційна — користувач може налаштувати теки одразу для
  // кількох ігор; конкретна обирається при натисканні картки на home-екрані.
  // Достатньо мати хоча б одну гру з директорією.
  sendSetupProgress({ phase: 'check', key: 'spCheck' });
  const filledGames = Object.entries(gameDirectories || {})
    .filter(([_id, p]) => typeof p === 'string' && p.trim());
  if (!filledGames.length) {
    const msg = 'Вкажи директорію хоча б однієї гри';
    sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
    return { error: msg };
  }
  // Якщо активна гра обрана — її дир ОБОВ'ЯЗКОВО має бути в списку.
  if (activeGame && !gameDirectories[activeGame]) {
    const msg = 'Active game ' + activeGame + ' has no directory';
    sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
    return { error: msg };
  }
  if (!toolsDir) {
    const msg = 'tools directory is empty';
    sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
    return { error: msg };
  }
  if (!textAssetsDir) {
    const msg = 'text-assets directory is empty';
    sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
    return { error: msg };
  }

  // ----- Створення tools-теки -----
  sendSetupProgress({ phase: 'tools-dir', key: 'spToolsDir' });
  try {
    await fs.mkdir(toolsDir, { recursive: true });
    await fs.mkdir(textAssetsDir, { recursive: true });
  } catch (e) {
    const msg = e.message || String(e);
    sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
    return { error: msg };
  }

  // Гарантуємо, що localizationRoot узгоджений з textAssetsDir для
  // GAME_DIR_LAYOUT (щоб ENG/PROGRESS/DONE створювались правильно).
  try { ensureLocalizationDirs(textAssetsDir); } catch (_) {}

  const downloadResults = { openkh: null, khpcpm: null };
  const downloadErrors = [];

  if (!skipDownload) {
    // ----- OpenKH -----
    try {
      sendSetupProgress({ phase: 'fetch-openkh', key: 'spFetchOpenKh' });
      const rel = await setupTools.fetchLatestRelease('OpenKH', 'OpenKh');
      // Шукаємо asset, який містить "OpenKH" і має .zip розширення;
      // не source-archive (source-code-zip має name 'Source code (zip)' з url-pattern '/zipball/').
      const asset = setupTools.pickAsset(rel.assets, a =>
        /openkh/i.test(a.name) && /\.zip$/i.test(a.name)
      );
      if (!asset) {
        throw new Error('У релізі OpenKH ' + rel.tag + ' немає підходящого .zip');
      }
      const destPath = path.join(toolsDir, asset.name);
      sendSetupProgress({
        phase: 'download-openkh',
        key: 'spDownloadOpenKh', params: { name: asset.name, tag: rel.tag },
        downloaded: 0, total: asset.size, percent: 0
      });
      const result = await setupTools.downloadFile(asset.url, destPath, (p) => {
        sendSetupProgress({
          phase: 'download-openkh',
          key: 'spDownloadOpenKh', params: { name: asset.name, tag: rel.tag },
          downloaded: p.downloaded, total: p.total, percent: p.percent
        });
      });
      // Розпакування у tools/openkh/. Якщо тека вже існує і zip раніше був
      // розпакований (тобто було alreadyExisted) — пропускаємо extraction
      // тільки якщо там уже є файли.
      const extractDir = path.join(toolsDir, 'openkh');
      let needExtract = true;
      try {
        const items = await fs.readdir(extractDir);
        if (items.length && result.alreadyExisted) needExtract = false;
      } catch (_) { /* теки нема — буде створена при extract */ }
      if (needExtract) {
        sendSetupProgress({ phase: 'download-openkh', key: 'spExtractOpenKh' });
        await fs.mkdir(extractDir, { recursive: true });
        await setupTools.extractZip(result.destPath, extractDir);
        // Сплющити якщо у zip була єдина коренева папка (`openkh/`) —
        // інакше виходить tools/openkh/openkh/...
        await setupTools.flattenIfSingleSubdir(extractDir);
      }
      downloadResults.openkh = {
        tag: rel.tag,
        assetName: asset.name,
        zipPath: result.destPath,
        extractedTo: extractDir,
        bytes: result.bytes,
        alreadyExisted: result.alreadyExisted
      };
    } catch (e) {
      downloadErrors.push('OpenKH: ' + (e.message || e));
      sendSetupProgress({ phase: 'error', key: 'spError', params: { msg: 'OpenKH: ' + (e.message || e) } });
    }

    // ----- KHPCPatchManager -----
    try {
      sendSetupProgress({ phase: 'fetch-khpcpm', key: 'spFetchKhpcpm' });
      const rel = await setupTools.fetchLatestRelease('AntonioDePau', 'KHPCPatchManager');
      const asset = setupTools.pickAsset(rel.assets, a =>
        /khpcpatchmanager/i.test(a.name) && /\.exe$/i.test(a.name)
      );
      if (!asset) {
        throw new Error('У релізі KHPCPatchManager ' + rel.tag + ' немає .exe');
      }
      const destPath = path.join(toolsDir, asset.name);
      sendSetupProgress({
        phase: 'download-khpcpm',
        key: 'spDownloadKhpcpm', params: { name: asset.name, tag: rel.tag },
        downloaded: 0, total: asset.size, percent: 0
      });
      const result = await setupTools.downloadFile(asset.url, destPath, (p) => {
        sendSetupProgress({
          phase: 'download-khpcpm',
          key: 'spDownloadKhpcpm', params: { name: asset.name, tag: rel.tag },
          downloaded: p.downloaded, total: p.total, percent: p.percent
        });
      });
      downloadResults.khpcpm = {
        tag: rel.tag,
        assetName: asset.name,
        path: result.destPath,
        bytes: result.bytes,
        alreadyExisted: result.alreadyExisted
      };
    } catch (e) {
      downloadErrors.push('KHPCPatchManager: ' + (e.message || e));
      sendSetupProgress({ phase: 'error', key: 'spError', params: { msg: 'KHPCPatchManager: ' + (e.message || e) } });
    }
  }

  // ----- Збереження конфігурації -----
  sendSetupProgress({ phase: 'persist', key: 'spPersist' });
  try {
    const raw = migrateIfNeeded(loadSettingsRaw());
    raw.setupCompleted = true;
    raw.activeGame = activeGame;
    raw.gameDirectories = Object.assign({}, raw.gameDirectories || {}, gameDirectories);
    raw.toolsDir = toolsDir;
    raw.textAssetsDir = textAssetsDir;
    raw.localizationRoot = textAssetsDir;
    raw.tools = Object.assign({}, raw.tools || {});
    if (downloadResults.openkh) raw.tools.openkh = downloadResults.openkh;
    if (downloadResults.khpcpm) raw.tools.khpcpm = downloadResults.khpcpm;
    writeSettingsRaw(raw);
  } catch (e) {
    const msg = e.message || String(e);
    sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
    return { error: msg };
  }

  // ----- Запуск KHPCPatchManager для розпакування ресурсів активної гри -----
  // KHPCPatchManager — GUI-утиліта (Windows Forms): передаємо .hed як
  // аргумент і запускаємо detached, щоб setup не блокувався очікуванням
  // закриття її вікна. Користувач сам бачить вікно tool'а і працює з ним.
  let unpackInfo = null;
  if (activeGame && HED_PATHS[activeGame] && downloadResults.khpcpm) {
    try {
      const gameRoot = gameDirectories[activeGame];
      const cfg = HED_PATHS[activeGame];
      let hedAbs = path.join(gameRoot, cfg.rel);
      // Якщо preferred-шлях не існує, пробуємо рекурсивний пошук за patternом.
      if (!fsSync.existsSync(hedAbs)) {
        const found = findFileByPattern(gameRoot, cfg.namePattern, 6);
        if (found.length === 1) {
          hedAbs = found[0];
          sendSetupProgress({
            phase: 'unpack-game',
            key: 'spHedFoundAuto', params: { path: hedAbs }
          });
        } else if (found.length > 1) {
          // Беремо перший, але повідомляємо.
          hedAbs = found[0];
          sendSetupProgress({
            phase: 'unpack-game',
            key: 'spHedFoundMany', params: { n: found.length, path: hedAbs }
          });
        }
      }
      const exePath = downloadResults.khpcpm.path;

      if (!fsSync.existsSync(hedAbs)) {
        const expected = path.join(gameRoot, cfg.rel);
        unpackInfo = {
          skipped: true,
          reason: '.hed not found in ' + gameRoot + ' (expected: ' + expected + ')'
        };
        sendSetupProgress({
          phase: 'unpack-game',
          key: 'spHedNotFound', params: { dir: gameRoot, expected }
        });
      } else if (!fsSync.existsSync(exePath)) {
        unpackInfo = { skipped: true, reason: 'KHPCPatchManager not found: ' + exePath };
        sendSetupProgress({ phase: 'unpack-game', key: 'spExeMissing', params: { path: exePath } });
      } else {
        const { spawn } = require('child_process');
        const exeDir = path.dirname(exePath);
        const resourcesDir = path.join(exeDir, 'resources');

        // Крок 1: KHPCPatchManager при ПЕРШОМУ запуску створює `resources/`
        // папку поряд з exe — без неї подальші розпакування не працюють.
        // Запускаємо exe без аргументів і чекаємо появи теки (до 10с),
        // потім кілимо процес. Пропускаємо якщо resources/ уже існує.
        if (!fsSync.existsSync(resourcesDir)) {
          sendSetupProgress({ phase: 'unpack-game', key: 'spUnpackInit' });
          const init = spawn(exePath, [], {
            cwd: exeDir,
            detached: false,
            stdio: 'ignore',
            windowsHide: true
          });
          init.on('error', () => {});
          // Polling до 10 секунд
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 500));
            if (fsSync.existsSync(resourcesDir)) break;
          }
          try { init.kill(); } catch (_) {}
          // На випадок якщо init так і не створив теку
          if (!fsSync.existsSync(resourcesDir)) {
            sendSetupProgress({ phase: 'unpack-game', key: 'spUnpackInitFail' });
            unpackInfo = { skipped: true, reason: 'KHPCPatchManager did not create resources/' };
            downloadErrors.push('Unpack: ' + unpackInfo.reason);
          }
        }

        // Крок 2: розпакування. KHPCPatchManager при отриманні .hed як
        // аргумента працює у фоні (без видимого UI). Блокуємо setup до
        // завершення процесу і показуємо живий прогрес з його stdout/stderr,
        // плюс таймер минулого часу і лічильник створених файлів.
        if (!unpackInfo) {
          sendSetupProgress({
            phase: 'unpack-game',
            key: 'spUnpacking',
            params: { file: path.basename(hedAbs), sec: 0, filesPart: '', linePart: '' }
          });
          const start = Date.now();
          // Папка, у яку KHPCPatchManager пише розпаковані файли (поряд з .hed,
          // зазвичай <hed-name>_out або similar). Лічимо рекурсивно файли у
          // батьківській теці .hed для приблизної оцінки.
          const watchDir = path.dirname(hedAbs);
          const baseFileCount = _countFilesShallow(watchDir);
          let lastTickFiles = baseFileCount;
          let lastLine = '';

          const tickTimer = setInterval(() => {
            const elapsed = Math.round((Date.now() - start) / 1000);
            const cur = _countFilesShallow(watchDir);
            const delta = Math.max(0, cur - baseFileCount);
            if (cur !== lastTickFiles || elapsed % 2 === 0) {
              lastTickFiles = cur;
              const filesPart = delta ? ' · +' + delta : '';
              const linePart = lastLine ? ' · ' + lastLine.slice(0, 120) : '';
              sendSetupProgress({
                phase: 'unpack-game',
                key: 'spUnpacking',
                params: { file: path.basename(hedAbs), sec: elapsed, filesPart, linePart }
              });
            }
          }, 1000);

          await new Promise((resolve, reject) => {
            const child = spawn(exePath, [hedAbs], {
              cwd: exeDir,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true
            });
            const consumeLine = (s) => {
              const trimmed = s.toString().split(/\r?\n/).filter(Boolean).pop();
              if (trimmed) lastLine = trimmed;
            };
            child.stdout && child.stdout.on('data', consumeLine);
            child.stderr && child.stderr.on('data', consumeLine);
            child.on('error', (err) => {
              clearInterval(tickTimer);
              reject(err);
            });
            child.on('close', (code) => {
              clearInterval(tickTimer);
              if (code === 0) resolve({ code });
              else reject(new Error('KHPCPatchManager exit ' + code +
                                    (lastLine ? ': ' + lastLine : '')));
            });
          });

          const elapsed = Math.round((Date.now() - start) / 1000);
          const newCount = Math.max(0, _countFilesShallow(watchDir) - baseFileCount);
          unpackInfo = { ok: true, hed: hedAbs, exe: exePath, elapsedSec: elapsed, newFiles: newCount };
          sendSetupProgress({
            phase: 'unpack-game',
            key: 'spUnpackDone', params: { sec: elapsed, count: newCount }
          });
        }
      }

      // Post-unpack: копіюємо оригінальні UK_*.ctdl файли з розпакованої
      // <gameDir>/Image/en/<base>.hed_out у <textAssetsDir>/ReCoM/FILES,
      // зберігаючи ієрархію.
      if (unpackInfo && unpackInfo.ok && activeGame === 'kh-re-com') {
        try {
          const hedDir = path.dirname(unpackInfo.hed);
          const hedBase = path.basename(unpackInfo.hed, path.extname(unpackInfo.hed));
          const unpackOutDir = path.join(hedDir, hedBase + '.hed_out');
          const filesDst = path.join(textAssetsDir, GAME_DIR_LAYOUT['kh-re-com'].base, 'FILES');
          if (!fsSync.existsSync(unpackOutDir)) {
            sendSetupProgress({
              phase: 'copy-files',
              key: 'spCopyOutMissing', params: { path: unpackOutDir }
            });
            unpackInfo.copyFiles = { skipped: true, reason: 'no _out dir' };
          } else {
            sendSetupProgress({
              phase: 'copy-files',
              key: 'spCopyStart', params: { dst: filesDst }
            });
            await fs.mkdir(filesDst, { recursive: true });
            const filter = /^UK_.*\.ctdl?$/i;
            const copyResult = await _copyMatchingFiles(unpackOutDir, filesDst, filter, (p) => {
              sendSetupProgress({
                phase: 'copy-files',
                key: 'spCopyProgress', params: { n: p.copied, lastRel: p.lastRel || '' }
              });
            });
            unpackInfo.copyFiles = copyResult;
            sendSetupProgress({
              phase: 'copy-files',
              key: 'spCopyDone', params: { n: copyResult.copied, dst: filesDst }
            });
          }
        } catch (e) {
          const msg = 'CopyFiles: ' + (e.message || e);
          sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
          downloadErrors.push(msg);
        }
      }
    } catch (e) {
      unpackInfo = { error: e.message || String(e) };
      const msg = 'Unpack: ' + (e.message || e);
      sendSetupProgress({ phase: 'error', key: 'spError', params: { msg } });
      downloadErrors.push(msg);
    }
  }

  sendSetupProgress({ phase: 'done', key: 'spDone' });
  return {
    ok: true,
    activeGame,
    gameDirectories,
    toolsDir,
    textAssetsDir,
    tools: downloadResults,
    unpack: unpackInfo,
    warnings: downloadErrors,
    skippedDownload: skipDownload
  };
});

// Простий passthrough на pickDirectory для onboarding (щоб preload-API
// було симетричним).
ipcMain.handle('setup:pickDir', async (_e, title) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Виберіть теку',
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

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
  // rusDir є опціональною — KH1 має і engDir, і rusDir; BBS лише engDir.
  const rusDir = (payload && payload.rusDir) || engDir;
  const files = (payload && payload.files) || [];
  const opts = (payload && payload.opts) || {};
  const safeMode = payload && payload.safeMode !== false;
  if (!engDir || !files.length) return { error: 'Не задано теки/файли' };

  const map = new Map();
  let processed = 0;
  let skipped = 0;
  let skippedUnsafe = 0;
  const total = files.length;

  // Helper для додавання slot'а у map (thread-safe для main process бо single-threaded JS).
  function addSlot(rel, slot) {
    const key = slot.english;
    let entry = map.get(key);
    if (!entry) { entry = { count: 0, occurrences: [] }; map.set(key, entry); }
    entry.count++;
    entry.occurrences.push({ rel, offset: slot.offset, byteLen: slot.byteLen, index: slot.index });
  }

  // Обробка ОДНОГО файлу. Повертає Promise. Виконується паралельно з іншими
  // через Promise.all batch.
  async function processOne(rel) {
    const engPath = path.join(engDir, rel);
    const rusPath = path.join(rusDir, rel);
    if (!fsSync.existsSync(engPath) || !fsSync.existsSync(rusPath)) {
      skipped++;
      return { rel, status: 'missing' };
    }
    const ext = path.extname(rel).toLowerCase();
    const cls = classifyFile(engPath, ext);
    if (safeMode && !cls.isTranslatable) {
      skippedUnsafe++;
      return { rel, status: 'unsafe' };
    }
    try {
      if (cls.kind === 'ctd') {
        const buf = await fs.readFile(engPath);
        const parsed = parseCtd(buf);
        for (let i = 0; i < parsed.messages.length; i++) {
          const m = parsed.messages[i];
          // Зберігаємо ключ у канонічній формі (drop 2-х байтів F1/F2/F5
          // unknowns) щоб збігся з OpenKh-style HTML-glossary при імпорті.
          addSlot(rel, {
            offset: m.id,
            byteLen: m._origByteLen,
            index: i,
            english: ctdCodec.glossaryKey(m.text)
          });
        }
        return { rel, status: 'ok' };
      }
      if (cls.kind === 'ctdl') {
        const buf = await fs.readFile(engPath);
        const parsed = parseCtdl(buf);
        for (let i = 0; i < parsed.entries.length; i++) {
          const e = parsed.entries[i];
          addSlot(rel, {
            offset: e.index,
            byteLen: e.originalLength,
            index: i,
            english: recomCodec.glossaryKey(e.text)
          });
        }
        return { rel, status: 'ok' };
      }
      if (cls.kind === 'ev') {
        const evBuf = await fs.readFile(engPath);
        const parsed = parseEv(evBuf, codec);
        for (const slot of parsed.slots) {
          if (!slot.translatable) continue;
          addSlot(rel, slot);
        }
        return { rel, status: 'ok' };
      }
      if (cls.kind === 'mesofs') {
        const dataPath = cls.extractOpts && cls.extractOpts.dataPath;
        if (!dataPath || !fsSync.existsSync(dataPath)) {
          skipped++;
          return { rel, status: 'no-pair' };
        }
        const ofsBuf = await fs.readFile(engPath);
        const dataBuf = await fs.readFile(dataPath);
        const parsed = parseMesOfs(ofsBuf, dataBuf, codec);
        const seen = new Set();
        for (const slot of parsed.slots) {
          if (seen.has(slot.offset)) continue;
          seen.add(slot.offset);
          addSlot(rel, slot);
        }
        return { rel, status: 'ok' };
      }
      // Worker-шлях для binl/rawbin (use multi-worker pool — паралельно).
      const eng = await fs.readFile(engPath);
      const rus = await fs.readFile(rusPath);
      const engAb = eng.buffer.slice(eng.byteOffset, eng.byteOffset + eng.byteLength);
      const rusAb = rus.buffer.slice(rus.byteOffset, rus.byteOffset + rus.byteLength);
      const fileOpts = Object.assign({}, cls.extractOpts || {}, opts);
      const r = await runWorker({ op: 'extract', eng: engAb, rus: rusAb, opts: fileOpts }, [engAb, rusAb]);
      for (const slot of r.slots) addSlot(rel, slot);
      return { rel, status: 'ok' };
    } catch (e) {
      skipped++;
      return { rel, status: 'error', error: e && e.message };
    }
  }

  // Паралельна обробка пакетами по POOL_SIZE * 2 (overlap I/O і CPU).
  const BATCH = POOL_SIZE * 2;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(processOne));
    for (const r of results) {
      processed++;
      sendProgress({ phase: 'glossary-build', done: processed, total, currentFile: r.rel,
        skipped: r.status !== 'ok' ? r.status : undefined });
    }
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

ipcMain.handle('translate:importTranslations', async (_e, opts) => {
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

ipcMain.handle('translate:composeAll', async (_e, payload) => {
  const engDir = payload && payload.engDir;
  // rusDir опціональний (BBS не має). Якщо не задано — fallback на engDir,
  // бо нижче по коду для деяких операцій (rel-walk) використовується rusDir.
  const rusDir = (payload && payload.rusDir) || engDir;
  const outDir = payload && payload.outDir;
  const tsvDir = payload && payload.tsvDir; // optional, для per-file overrides
  const files = (payload && payload.files) || [];
  const glossary = (payload && payload.glossary) || {};
  const opts = (payload && payload.opts) || {};
  const safeMode = payload && payload.safeMode !== false;

  if (!engDir || !outDir || !files.length) {
    return { error: 'Не задано теки/файли' };
  }

  let processed = 0;
  let written = 0;
  let skippedNoTranslations = 0;
  let skippedUnsafe = 0;
  let totalReplacements = 0;
  const errors = [];
  const total = files.length;

  // Helper: обробка одного файлу (повертає Promise — для batch-паралелізації).
  async function processOne(rel) {
    const engPath = path.join(engDir, rel);
    const rusPath = path.join(rusDir, rel);
    const outPath = path.join(outDir, rel);

    if (!fsSync.existsSync(engPath) || !fsSync.existsSync(rusPath)) {
      return { rel, status: 'missing' };
    }

    const ext = path.extname(rel).toLowerCase();
    const cls = classifyFile(engPath, ext);

    if (safeMode && !cls.isTranslatable) {
      skippedUnsafe++;
      return { rel, status: 'unsafe' };
    }

    try {
      // ===== Спецгілка для .ctd (BBS) =====
      if (cls.kind === 'ctd') {
        const buf = await fs.readFile(engPath);
        const parsed = parseCtd(buf);
        let perFileMap = null;
        if (tsvDir) {
          const tsvPath = path.join(tsvDir, rel) + '.tsv';
          if (fsSync.existsSync(tsvPath)) {
            try {
              const txt = await fs.readFile(tsvPath, 'utf8');
              perFileMap = tsv.overridesByOffset(txt);
            } catch (_) {}
          }
        }
        let appliedCount = 0;
        for (const m of parsed.messages) {
          let uk = '';
          if (perFileMap && perFileMap.has(m.id)) uk = perFileMap.get(m.id);
          if (!uk) {
            // Glossary lookup по канонічному ключу (drop 2-byte F1/F2/F5 params).
            const key = ctdCodec.glossaryKey(m.text);
            if (Object.prototype.hasOwnProperty.call(glossary, key)) {
              uk = glossary[key];
              // Відновити втрачені 2-і байти F1/F2/F5 у UK-перекладі,
              // використовуючи оригінальний EN-текст як reference (порядок збережено).
              uk = ctdCodec.restore2ndBytes(uk, m.text);
            }
          }
          if (uk && uk.trim() && uk !== m.text) {
            m.text = uk;
            appliedCount++;
          }
        }
        if (appliedCount === 0) {
          skippedNoTranslations++;
          return { rel, status: 'no-translations' };
        }
        const composed = composeCtd(parsed);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, composed);
        written++;
        totalReplacements += appliedCount;
        return { rel, status: 'ok' };
      }
      // ===== Спецгілка для .ctdl (Re:CoM) =====
      if (cls.kind === 'ctdl') {
        const buf = await fs.readFile(engPath);
        const parsed = parseCtdl(buf);
        let perFileMap = null;
        if (tsvDir) {
          const tsvPath = path.join(tsvDir, rel) + '.tsv';
          if (fsSync.existsSync(tsvPath)) {
            try {
              const txt = await fs.readFile(tsvPath, 'utf8');
              perFileMap = tsv.overridesByOffset(txt);
            } catch (_) {}
          }
        }
        const repMap = new Map();
        let appliedCount = 0;
        for (let i = 0; i < parsed.entries.length; i++) {
          const e = parsed.entries[i];
          let uk = '';
          if (perFileMap && perFileMap.has(e.index)) uk = perFileMap.get(e.index);
          if (!uk) {
            const key = recomCodec.glossaryKey(e.text);
            if (Object.prototype.hasOwnProperty.call(glossary, key)) {
              uk = glossary[key];
            }
          }
          if (uk && uk.trim() && uk !== e.text) {
            repMap.set(i, uk);
            appliedCount++;
          }
        }
        if (appliedCount === 0) {
          skippedNoTranslations++;
          return { rel, status: 'no-translations' };
        }
        const composed = composeCtdl(parsed, repMap);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, composed);
        written++;
        totalReplacements += appliedCount;
        return { rel, status: 'ok' };
      }
      // ===== Спецгілка для .ev/.evdl =====
      if (cls.kind === 'ev') {
        const evBuf = await fs.readFile(engPath);
        const parsed = parseEv(evBuf, codec);
        let perFileMap = null;
        if (tsvDir) {
          const tsvPath = path.join(tsvDir, rel) + '.tsv';
          if (fsSync.existsSync(tsvPath)) {
            try {
              const txt = await fs.readFile(tsvPath, 'utf8');
              perFileMap = tsv.overridesByOffset(txt);
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
          return { rel, status: 'no-translations' };
        }
        const composed = composeEv(evBuf, slotsForCompose, codec);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, composed.buf);
        written++;
        totalReplacements += appliedCount;
        return { rel, status: 'ok' };
      }
      // ===== Спецгілка для *_mes_ofs.bin =====
      if (cls.kind === 'mesofs') {
        const dataPath = cls.extractOpts && cls.extractOpts.dataPath;
        if (!dataPath || !fsSync.existsSync(dataPath)) {
          errors.push({ rel, error: 'mesofs: pair _mes_data.bin not found' });
          return { rel, status: 'no-pair' };
        }
        const ofsBuf = await fs.readFile(engPath);
        const dataBuf = await fs.readFile(dataPath);
        const parsed = parseMesOfs(ofsBuf, dataBuf, codec);
        let perFileMap = null;
        if (tsvDir) {
          const tsvPath = path.join(tsvDir, rel) + '.tsv';
          if (fsSync.existsSync(tsvPath)) {
            try {
              const txt = await fs.readFile(tsvPath, 'utf8');
              perFileMap = tsv.overridesByOffset(txt);
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
          return { rel, status: 'no-translations' };
        }
        const composed = composeMesOfs(slotsForCompose, {
          ofsLength: ofsBuf.length,
          dataLength: dataBuf.length,
          cellLengthByOffset: parsed.cellLengthByOffset
        }, codec);
        const outDataPath = path.join(path.dirname(outPath), pairedDataName(path.basename(outPath)));
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, composed.ofsBuf);
        await fs.writeFile(outDataPath, composed.dataBuf);
        written++;
        totalReplacements += appliedCount;
        return { rel, status: 'ok' };
      }
      // ===== Звичайний шлях через worker pool (паралельно з іншими файлами) =====
      const eng = await fs.readFile(engPath);
      const rus = await fs.readFile(rusPath);
      const engAb = eng.buffer.slice(eng.byteOffset, eng.byteOffset + eng.byteLength);
      const rusAb = rus.buffer.slice(rus.byteOffset, rus.byteOffset + rus.byteLength);
      const fileOpts = Object.assign({}, cls.extractOpts || {}, opts);
      const extResult = await runWorker(
        { op: 'extract', eng: engAb, rus: rusAb, opts: fileOpts },
        [engAb, rusAb]
      );
      let perFileMap = null;
      if (tsvDir) {
        const tsvPath = path.join(tsvDir, rel) + '.tsv';
        if (fsSync.existsSync(tsvPath)) {
          try {
            const txt = await fs.readFile(tsvPath, 'utf8');
            perFileMap = tsv.overridesByOffset(txt);
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
        return { rel, status: 'no-translations' };
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
      return { rel, status: 'ok' };
    } catch (e) {
      errors.push({ rel, error: (e && e.message) || String(e) });
      return { rel, status: 'error' };
    }
  }

  // Паралельна обробка пакетами (POOL_SIZE * 2 для overlap I/O і CPU).
  const BATCH = POOL_SIZE * 2;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(processOne));
    for (const r of results) {
      processed++;
      sendProgress({ phase: 'compose-all', done: processed, total, currentFile: r.rel,
        skipped: r.status !== 'ok' ? r.status : undefined });
    }
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
// ===== BBS Font Editor IPC =====
// Load: користувач вибирає теку розпакованого FontEn.arc → повертаємо
// список фонтів. Дані самих entries беруться окремим викликом per-font.

ipcMain.handle('bbsfont:pickArcDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Вкажіть теку з розпакованим FontEn.arc (мають бути .inf/.cod/.mtx файли)',
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? { canceled: true } : { ok: true, dir: r.filePaths[0] };
});

ipcMain.handle('bbsfont:pickHdDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
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
  try { return codec.encode(text); }
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
    repo: 'https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest'
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
  try { saveSettings({ language: appLang }); } catch (_) {}
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
    backgroundColor: '#050505',
    title: 'Kingdom Hearts Ukrainian Localization Hub',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    frame: false,                    // Власний title bar (KH-style)
    titleBarStyle: 'hidden',
    thickFrame: false,               // прибрати Win11 accent-color border
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Dev-допомога: KH_DEBUG=1 дзеркалить console renderer'а у термінал і
  // відкриває DevTools — щоб бачити помилки без GUI.
  if (process.env.KH_DEBUG) {
    mainWindow.webContents.on('console-message', (_ev, level, message, line, sourceId) => {
      const lvl = ['debug', 'info', 'warn', 'error'][level] || level;
      console.log('[renderer:' + lvl + '] ' + message + ' (' + path.basename(String(sourceId)) + ':' + line + ')');
    });
    mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.openDevTools({ mode: 'detach' }));
  }

  // Відкривати на максимум за замовчуванням (за запитом користувача).
  mainWindow.maximize();

  // Notify renderer про зміни window state (для max/restore icon swap).
  const sendWinState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('win:state', {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen()
    });
  };
  mainWindow.on('maximize', sendWinState);
  mainWindow.on('unmaximize', sendWinState);
  mainWindow.on('enter-full-screen', sendWinState);
  mainWindow.on('leave-full-screen', sendWinState);
  // Перед закриттям даємо renderer'у скинути незбережений TSV/глосарій
  // (autosave має дебаунс 1.5с — інакше останні правки губляться).
  // Renderer відповідає через 'app:close-ready'; таймаут — страховка, щоб
  // вікно не «зависло» якщо renderer впав.
  let closeReady = false;
  mainWindow.on('close', (e) => {
    if (closeReady || !mainWindow || mainWindow.isDestroyed()) return;
    e.preventDefault();
    const finish = () => {
      if (closeReady) return;
      closeReady = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    };
    const timer = setTimeout(finish, 3000);
    ipcMain.once('app:close-ready', () => { clearTimeout(timer); finish(); });
    try { mainWindow.webContents.send('app:before-close'); }
    catch (_) { clearTimeout(timer); finish(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// IPC: window controls для custom title bar.
ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('win:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('win:close', () => mainWindow && mainWindow.close());
ipcMain.handle('win:isMaximized', () => mainWindow && mainWindow.isMaximized());

app.whenReady().then(() => {
  try {
    const s = loadSettings();
    if (s && (s.language === 'en' || s.language === 'uk')) appLang = s.language;
    // Авто-створення стандартної структури тек локалізації.
    // Якщо користувач не вказав власний `localizationRoot` у settings —
    // використовується ~/Documents/KH-Localization/.
    const root = (s && s.localizationRoot) || DEFAULT_LOC_ROOT;
    ensureLocalizationDirs(root);
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
  // Завершити всіх workers у pool'і
  for (const slot of workerPool) {
    if (slot && slot.worker) {
      try { slot.worker.terminate(); } catch (_) {}
    }
  }
  workerPool.length = 0;
});
