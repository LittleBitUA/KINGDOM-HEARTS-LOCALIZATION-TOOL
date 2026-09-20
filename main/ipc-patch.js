'use strict';

// Патч в один клік. DONE (+ збірка шрифтів UA) → staging-тека у розкладці
// KHPCPatchManager (<archive>/(original|remastered)/…, Re:CoM — Recom/…) →
//   patch:build — `KHPCPatchManager <staging>` → <Name>.<kh1|com|bbs|ddd>pcpatch
//                 поруч (файл для поширення: інші застосовують перетягуванням на exe);
//   patch:apply — `KHPCPatchManager <Name>.<ext>` — те саме, що перетягнути файл
//                 патчу на exe: менеджер переписує .pkg у грі й кладе оригінали
//                 у Image/dt/backup/ (довго: .pkg на кілька ГБ). Гра має бути закрита.
// Теку гри менеджер сам шукає лише на типових шляхах Steam/Epic на C:; інакше
// питає «drag your en/dt folder» у консолі (Console.ReadLine) — відповідаємо
// через stdin текою, де лежать .pkg цієї гри. Режим `<pkg> <folder>` НЕ підходить:
// він пише пропатчений .pkg у `<folder>_out`, а не в гру.

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsP = require('fs/promises');
const { spawn } = require('child_process');
const win = require('./window');
const { loadSettingsRaw, migrateIfNeeded } = require('./settings');
const { HED_PATHS, locateHed, resolveKhpcpmExe } = require('./ipc-setup');

const PATCH_NAMES = { 'kh1-final-mix': 'KH1-UA', 'kh-re-com': 'ReCoM-UA', 'kh-bbs-final-mix': 'BBS-UA', 'kh-ddd': 'DDD-UA' };
const PATCH_EXT = { 'kh1-final-mix': 'kh1pcpatch', 'kh-re-com': 'compcpatch', 'kh-bbs-final-mix': 'bbspcpatch', 'kh-ddd': 'dddpcpatch' };
// Службові файли, яким не місце у патчі.
// (.imz.<n>.png / .imz.json — робочі PNG вкладки «Текстури» поруч із .imz)
const SKIP_FILE = /\.(tsv|json|bak\.\d+|log|txt)$|\.imz\.\d+\.png$|^ua_glyphs\.json$|^preview\.png$|^ua_preview\.png$/i;
const SKIP_DIR = /^_/;   // build/_reports

function sendProgress(payload) { win.send('patch:progress', payload); }

function patchRoot(gameId) {
  return path.join(app.getPath('documents'), 'KH-Localization', 'PATCH', PATCH_NAMES[gameId] || String(gameId));
}
function patchName(gameId) { return PATCH_NAMES[gameId] || (String(gameId) + '-UA'); }
function stagingDirFor(gameId) { return path.join(patchRoot(gameId), patchName(gameId)); }
function patchFileFor(gameId) { return path.join(patchRoot(gameId), patchName(gameId) + '.' + (PATCH_EXT[gameId] || 'pcpatch')); }

function exePath() {
  const raw = migrateIfNeeded(loadSettingsRaw());
  return resolveKhpcpmExe(null, raw, raw.toolsDir);
}
function gameDirFor(gameId) {
  const raw = loadSettingsRaw();
  return (raw.gameDirectories && raw.gameDirectories[gameId]) || '';
}

// copyTree(src, dst) → { files, bytes }; пропускає службові файли/теки.
// top=true: теки верхнього рівня `<archive>.hed_out` (старі збірки) → `<archive>`.
async function copyTree(src, dst, stats, top) {
  const entries = await fsP.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dst, top ? e.name.replace(/\.hed_out$/i, '') : e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      await fsP.mkdir(to, { recursive: true });
      await copyTree(from, to, stats);
    } else if (e.isFile()) {
      if (SKIP_FILE.test(e.name)) continue;
      await fsP.mkdir(dst, { recursive: true });
      await fsP.copyFile(from, to);
      stats.files++;
      stats.bytes += (await fsP.stat(to)).size;
    }
  }
  return stats;
}

// runExe(exe, args, cwd, onLine, stdinText?, finishRe?)
//   stdinText — відповідь на консольний запит менеджера (тека гри). Патч він застосовує
//   у ФОНОВОМУ потоці, а головний одразу чекає ще один Console.ReadLine() («натисни
//   Enter») — якщо закрити stdin, той ReadLine повертає EOF, процес виходить і вбиває
//   фон до запису .pkg. Тому stdin тримаємо відкритим, а Enter шлемо лише після
//   рядка finishRe («Done!» / помилка).
function runExe(exe, args, cwd, onLine, stdinText, finishRe) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, stdio: [stdinText ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    if (stdinText) {
      child.stdin.on('error', () => {});
      if (finishRe) child.stdin.write(stdinText); else child.stdin.end(stdinText);
    }
    let last = '', finished = false, killTimer = null;
    const consume = (b) => {
      for (const t of b.toString().split(/\r?\n/)) {
        const line = t.trim(); if (!line) continue;
        last = line; onLine(line);
        if (finishRe && !finished && finishRe.test(line)) {
          finished = true;
          try { child.stdin.end('\r\n'); } catch (_) {}
          killTimer = setTimeout(() => { try { child.kill(); } catch (_) {} }, 15000);
        }
      }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', reject);
    child.on('close', (code) => { if (killTimer) clearTimeout(killTimer); (code === 0 || finished) ? resolve(last) : reject(new Error('KHPCPatchManager exit ' + code + (last ? ': ' + last : ''))); });
  });
}

async function topDirs(dir) {
  let entries;
  try { entries = await fsP.readdir(dir, { withFileTypes: true }); } catch (_) { return []; }
  return entries.filter(e => e.isDirectory() && !SKIP_DIR.test(e.name)).map(e => e.name);
}

// patch:status(gameId) → що вже є: staging, файл патчу, збірка шрифтів.
ipcMain.handle('patch:status', async (_e, payload) => {
  const gameId = String((payload && payload.gameId) || '');
  const fontsBuildDir = payload && payload.fontsBuildDir;
  const staging = stagingDirFor(gameId), file = patchFileFor(gameId);
  const st = (p) => { try { const s = fs.statSync(p); return { exists: true, mtime: s.mtimeMs, size: s.size }; } catch (_) { return { exists: false }; } };
  const fontsArchives = fontsBuildDir ? await topDirs(fontsBuildDir) : [];
  return {
    ok: true, stagingDir: staging, patchPath: file, patchName: patchName(gameId), ext: PATCH_EXT[gameId] || 'pcpatch',
    staging: st(staging), patch: st(file),
    fontsBuild: { dir: fontsBuildDir || '', exists: fontsArchives.length > 0, archives: fontsArchives },
    exe: exePath(), gameDir: gameDirFor(gameId)
  };
});

// patch:build({ gameId, doneDir, fontsBuildDir?, includeFonts })
ipcMain.handle('patch:build', async (_e, payload) => {
  const p = payload || {};
  const gameId = String(p.gameId || '');
  if (!PATCH_NAMES[gameId]) return { ok: false, error: 'Невідома гра: ' + gameId };
  if (!p.doneDir || !fs.existsSync(p.doneDir)) return { ok: false, error: 'Теки DONE нема: ' + (p.doneDir || '') };
  const exe = exePath();
  if (!exe) return { ok: false, error: 'KHPCPatchManager.exe не знайдено — запусти Setup (він завантажить інструменти)' };
  const root = patchRoot(gameId), staging = stagingDirFor(gameId), file = patchFileFor(gameId);
  const log = [];
  const line = (t) => { log.push(t); sendProgress({ phase: 'build', line: t + '\n' }); };
  try {
    await fsP.rm(staging, { recursive: true, force: true });
    await fsP.mkdir(staging, { recursive: true });
    line('DONE → ' + staging);
    const stats = await copyTree(p.doneDir, staging, { files: 0, bytes: 0 }, true);
    const doneFiles = stats.files;
    if (p.includeFonts && p.fontsBuildDir && fs.existsSync(p.fontsBuildDir)) {
      line('Шрифти UA → ' + staging);
      await copyTree(p.fontsBuildDir, staging, stats, true);
    }
    if (!stats.files) return { ok: false, error: 'У DONE немає файлів для патчу — спершу «Зібрати ВСІ файли»' };
    const archives = await topDirs(staging);
    line('Архіви: ' + archives.join(', ') + ' · файлів: ' + stats.files + ' (DONE ' + doneFiles + ', шрифти ' + (stats.files - doneFiles) + ')');
    await fsP.rm(file, { force: true });
    line('KHPCPatchManager ' + path.basename(staging));
    // Менеджер завжди пише MyPatch.<ext> у cwd — перейменовуємо у <Name>.<ext>.
    const myPatch = path.join(root, 'MyPatch.' + (PATCH_EXT[gameId] || 'pcpatch'));
    await fsP.rm(myPatch, { force: true });
    await runExe(exe, [staging], root, line);
    if (fs.existsSync(myPatch)) await fsP.rename(myPatch, file);
    if (!fs.existsSync(file)) return { ok: false, error: 'KHPCPatchManager не створив ' + path.basename(file), log };
    const size = (await fsP.stat(file)).size;
    line('Готово: ' + file + ' (' + Math.round(size / 1024) + ' KB)');
    return { ok: true, patchPath: file, stagingDir: staging, archives, files: stats.files, fontsFiles: stats.files - doneFiles, bytes: stats.bytes, size, log };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e), log };
  }
});

// patch:apply({ gameId }) — staging/<archive> → <archive>.pkg гри.
ipcMain.handle('patch:apply', async (_e, payload) => {
  const p = payload || {};
  const gameId = String(p.gameId || '');
  const cfg = HED_PATHS[gameId];
  if (!cfg) return { ok: false, error: 'Невідома гра: ' + gameId };
  const staging = stagingDirFor(gameId);
  const archives = await topDirs(staging);
  if (!archives.length) return { ok: false, error: 'Спершу «Зібрати патч» — staging порожній: ' + staging };
  const exe = exePath();
  if (!exe) return { ok: false, error: 'KHPCPatchManager.exe не знайдено' };
  const gameDir = gameDirFor(gameId);
  if (!gameDir || !fs.existsSync(gameDir)) return { ok: false, error: 'Теку гри не задано (Setup)' };
  // <archive> → .pkg через відомі .hed цієї гри
  const plan = [];
  for (const arc of archives) {
    const hed = cfg.heds.find(h => path.basename(h.rel).toLowerCase() === (arc + '.hed').toLowerCase());
    const hedAbs = hed ? locateHed(gameDir, hed, true) : null;
    const pkg = hedAbs ? hedAbs.replace(/\.hed$/i, '.pkg') : null;
    if (!pkg || !fs.existsSync(pkg)) return { ok: false, error: 'У грі не знайдено архів ' + arc + '.pkg для теки патчу «' + arc + '»' };
    plan.push({ arc, pkg, folder: path.join(staging, arc) });
  }
  // dryRun — лише план (що у який .pkg піде), без запису.
  if (p.dryRun) return { ok: true, dryRun: true, plan, exe };
  const file = patchFileFor(gameId);
  if (!fs.existsSync(file)) return { ok: false, error: 'Спершу «Зібрати патч» — нема ' + file };
  // усі .pkg однієї гри лежать в одній теці (Image/dt або Image/en) — її й віддаємо менеджеру
  const imageDirs = [...new Set(plan.map(x => path.dirname(x.pkg)))];
  if (imageDirs.length !== 1) return { ok: false, error: 'Архіви патчу лежать у різних теках гри: ' + imageDirs.join(' | ') };
  const imageDir = imageDirs[0];
  const log = [];
  const line = (t) => { log.push(t); sendProgress({ phase: 'apply', line: t + '\n' }); };
  const applied = [];
  const before = Object.fromEntries(plan.map(x => [x.arc, fs.statSync(x.pkg).mtimeMs]));
  try {
    const t0 = Date.now();
    line('▶ KHPCPatchManager ' + path.basename(file) + ' → ' + imageDir);
    // менеджер спитає теку гри лише якщо не знайде її сам; відповідь чекає у stdin
    await runExe(exe, [file], path.dirname(exe), line, imageDir + '\r\n', /^(Done!|Could not find any folder|There was an error|Error:)/);
    const sec = Math.round((Date.now() - t0) / 1000);
    for (const { arc, pkg } of plan) {
      const changed = fs.statSync(pkg).mtimeMs !== before[arc];
      applied.push({ arc, pkg, sec, changed });
      line((changed ? '✓ ' : '• ') + arc + (changed ? '' : ' — .pkg не змінився'));
    }
    if (!applied.some(a => a.changed)) return { ok: false, error: 'KHPCPatchManager завершився, але жоден .pkg у ' + imageDir + ' не змінився — дивись лог', applied, log };
    const backup = path.join(imageDir, 'backup');
    return { ok: true, applied, backupDir: fs.existsSync(backup) ? backup : '', log };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e), applied, log };
  }
});

module.exports = { PATCH_NAMES, PATCH_EXT, patchRoot, stagingDirFor, patchFileFor };
