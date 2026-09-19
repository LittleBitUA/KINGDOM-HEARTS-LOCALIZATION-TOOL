'use strict';

// Settings: global + per-game dirs, міграція старої flat-схеми, дефолтна
// структура тек локалізації (~/Documents/KH-Localization/<GAME>/…).

const { app } = require('electron');
const path = require('path');
const fsSync = require('fs');
const { writeFileAtomicSync } = require('../shared/safe-fs');

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

module.exports = {
  SETTINGS_PATH, GAME_DIR_KEYS, DEFAULT_LOC_ROOT, GAME_DIR_LAYOUT,
  ensureLocalizationDirs, getDefaultsForGame,
  writeSettingsRaw, loadSettingsRaw, migrateIfNeeded, loadSettings, saveSettings
};
