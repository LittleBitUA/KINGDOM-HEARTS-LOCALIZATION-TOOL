'use strict';

// Setup / onboarding: завантаження OpenKH + KHPCPatchManager, розпакування
// ресурсів гри, копіювання UK_*.ctdl у workspace.

const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const win = require('./window');
const setupTools = require('../tools/lib/setup-tools');
const {
  GAME_DIR_LAYOUT, ensureLocalizationDirs,
  writeSettingsRaw, loadSettingsRaw, migrateIfNeeded
} = require('./settings');
const { dl } = require('./menu');

// ---- Setup-onboarding -----------------------------------------------
//
// Окремий progress-channel `setup:progress` (щоб не плутати з translate-progress
// у composeAll/glossary-build).
function sendSetupProgress(payload) {
  win.send('setup:progress', payload);
}

// .hed-файли для розпакування через KHPCPatchManager. Перший — preferred-
// шлях відносно game-root, інші — fallback-патерни (регулярки case-insensitive
// на basename). Якщо точний шлях не знайдено, робимо рекурсивний пошук
// у `<gameDir>` за патерном.
// Які .hed-архіви розпаковувати через KHPCPatchManager і що з них копіювати
// у робочу теку тексту. heds[i].rel — preferred-шлях відносно кореня гри;
// namePattern — fallback для рекурсивного пошуку. copy.filter(rel) отримує
// шлях відносно <base>.hed_out ('/'-розділювачі); copy.withPrefix — чи
// зберігати '<base>.hed_out/' у шляху призначення (так роблять Python-набори
// BBS/DDD; Re:CoM — без префікса, як text_uniq.txt).
const HED_PATHS = {
  'kh-re-com': {
    heds: [{ rel: 'Image/dt/Recom.hed', alt: ['Image/en/Recom.hed'], namePattern: /^recom\.hed$/i }],
    copy: { subdir: 'FILES', withPrefix: false, filter: (rel) => /(^|\/)UK_[^/]*\.ctdl?$/i.test(rel) }
  },
  'kh-bbs-final-mix': {
    heds: [
      { rel: 'Image/dt/bbs_first.hed', namePattern: /^bbs_first\.hed$/i },
      { rel: 'Image/dt/bbs_fourth.hed', namePattern: /^bbs_fourth\.hed$/i }
    ],
    copy: { subdir: 'ENG', withPrefix: true, filter: (rel) => /^original\/message\/en\/.*\.ctd$/i.test(rel) }
  },
  'kh-ddd': {
    heds: [{ rel: 'Image/dt/kh3d_first.hed', namePattern: /^kh3d_first\.hed$/i }],
    copy: { subdir: 'ENG', withPrefix: true, filter: (rel) => /^original\/message\/en\/.*\.ctd$/i.test(rel) }
  }
  // 'kh1-final-mix' — додамо коли підтвердимо точні шляхи
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
        const relPosix = childRel.split(path.sep).join('/');
        const ok = (typeof namePattern === 'function') ? namePattern(relPosix, e.name) : namePattern.test(e.name);
        if (!ok) continue;
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

// Знайти .hed: preferred rel → alt rel → рекурсивний пошук за patternом.
function locateHed(gameRoot, hed) {
  const candidates = [hed.rel].concat(hed.alt || []).map(r => path.join(gameRoot, r));
  for (const c of candidates) if (fsSync.existsSync(c)) return c;
  const found = findFileByPattern(gameRoot, hed.namePattern, 6);
  if (found.length === 1) {
    sendSetupProgress({ phase: 'unpack-game', key: 'spHedFoundAuto', params: { path: found[0] } });
    return found[0];
  }
  if (found.length > 1) {
    sendSetupProgress({ phase: 'unpack-game', key: 'spHedFoundMany', params: { n: found.length, path: found[0] } });
    return found[0];
  }
  return null;
}

// KHPCPatchManager при ПЕРШОМУ запуску створює resources/ поряд з exe — без
// неї розпакування не працює. Запускаємо без аргументів, чекаємо до 10с,
// кілимо. Повертає рядок помилки або null.
async function ensurePatchManagerResources(exePath) {
  const { spawn } = require('child_process');
  const exeDir = path.dirname(exePath);
  const resourcesDir = path.join(exeDir, 'resources');
  if (fsSync.existsSync(resourcesDir)) return null;
  sendSetupProgress({ phase: 'unpack-game', key: 'spUnpackInit' });
  const init = spawn(exePath, [], { cwd: exeDir, detached: false, stdio: 'ignore', windowsHide: true });
  init.on('error', () => {});
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (fsSync.existsSync(resourcesDir)) break;
  }
  try { init.kill(); } catch (_) {}
  if (!fsSync.existsSync(resourcesDir)) {
    sendSetupProgress({ phase: 'unpack-game', key: 'spUnpackInitFail' });
    return 'KHPCPatchManager did not create resources/';
  }
  return null;
}

// Розпакувати один .hed: KHPCPatchManager з .hed як аргументом працює у фоні.
// Блокуємо до завершення, показуємо живий прогрес (таймер + лічильник файлів).
async function unpackOneHed(exePath, hedAbs) {
  const { spawn } = require('child_process');
  const exeDir = path.dirname(exePath);
  sendSetupProgress({ phase: 'unpack-game', key: 'spUnpacking', params: { file: path.basename(hedAbs), sec: 0, filesPart: '', linePart: '' } });
  const start = Date.now();
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
      sendSetupProgress({ phase: 'unpack-game', key: 'spUnpacking', params: {
        file: path.basename(hedAbs), sec: elapsed,
        filesPart: delta ? ' · +' + delta : '', linePart: lastLine ? ' · ' + lastLine.slice(0, 120) : ''
      } });
    }
  }, 3000);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(exePath, [hedAbs], { cwd: exeDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const consumeLine = (b) => { const t = b.toString().split(/\r?\n/).filter(Boolean).pop(); if (t) lastLine = t; };
      child.stdout && child.stdout.on('data', consumeLine);
      child.stderr && child.stderr.on('data', consumeLine);
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error('KHPCPatchManager exit ' + code + (lastLine ? ': ' + lastLine : ''))));
    });
  } finally {
    clearInterval(tickTimer);
  }
  const elapsed = Math.round((Date.now() - start) / 1000);
  const newCount = Math.max(0, _countFilesShallow(watchDir) - baseFileCount);
  sendSetupProgress({ phase: 'unpack-game', key: 'spUnpackDone', params: { sec: elapsed, count: newCount } });
  return { ok: true, hed: hedAbs, exe: exePath, elapsedSec: elapsed, newFiles: newCount };
}

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
    const gameRoot = gameDirectories[activeGame];
    const cfg = HED_PATHS[activeGame];
    const exePath = downloadResults.khpcpm.path;
    unpackInfo = { ok: true, heds: [], copyFiles: { copied: 0, skippedExisting: 0, scanned: 0, errors: [] } };
    try {
      if (!fsSync.existsSync(exePath)) {
        unpackInfo = { skipped: true, reason: 'KHPCPatchManager not found: ' + exePath };
        sendSetupProgress({ phase: 'unpack-game', key: 'spExeMissing', params: { path: exePath } });
      } else {
        const initErr = await ensurePatchManagerResources(exePath);
        if (initErr) {
          unpackInfo = { skipped: true, reason: initErr };
          downloadErrors.push('Unpack: ' + initErr);
        }
      }
      if (!unpackInfo.skipped) {
        const filesDst = path.join(textAssetsDir, GAME_DIR_LAYOUT[activeGame].base, cfg.copy.subdir);
        for (const hed of cfg.heds) {
          const hedAbs = locateHed(gameRoot, hed);
          if (!hedAbs) {
            const expected = path.join(gameRoot, hed.rel);
            unpackInfo.heds.push({ rel: hed.rel, skipped: true, reason: 'not found' });
            sendSetupProgress({ phase: 'unpack-game', key: 'spHedNotFound', params: { dir: gameRoot, expected } });
            continue;
          }
          const r = await unpackOneHed(exePath, hedAbs);
          unpackInfo.heds.push(r);
          // Копіюємо оригінальні текстові файли з <base>.hed_out у робочу теку.
          const hedBase = path.basename(hedAbs, path.extname(hedAbs));
          const unpackOutDir = path.join(path.dirname(hedAbs), hedBase + '.hed_out');
          if (!fsSync.existsSync(unpackOutDir)) {
            sendSetupProgress({ phase: 'copy-files', key: 'spCopyOutMissing', params: { path: unpackOutDir } });
            continue;
          }
          const dst = cfg.copy.withPrefix ? path.join(filesDst, hedBase + '.hed_out') : filesDst;
          sendSetupProgress({ phase: 'copy-files', key: 'spCopyStart', params: { dst } });
          await fs.mkdir(dst, { recursive: true });
          const cr = await _copyMatchingFiles(unpackOutDir, dst, cfg.copy.filter, (p) => {
            sendSetupProgress({ phase: 'copy-files', key: 'spCopyProgress', params: { n: p.copied, lastRel: p.lastRel || '' } });
          });
          unpackInfo.copyFiles.copied += cr.copied;
          unpackInfo.copyFiles.scanned += cr.scanned;
          unpackInfo.copyFiles.errors.push(...cr.errors);
          sendSetupProgress({ phase: 'copy-files', key: 'spCopyDone', params: { n: cr.copied, dst } });
        }
        unpackInfo.hed = unpackInfo.heds.map(h => h.hed).filter(Boolean).join('; ');
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
  const r = await dialog.showOpenDialog(win.get(), {
    title: title || dl('pickDir'),
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
