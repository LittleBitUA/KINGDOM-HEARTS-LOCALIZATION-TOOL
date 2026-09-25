'use strict';

// Шляхи користувача для допоміжних скриптів з tools/.
//
// Раніше вони були прописані в коді рядком, що прив'язувало інструменти до
// однієї машини. Тепер беремо їх із налаштувань застосунку (ті самі теки, що
// видно в UI), а перевизначити можна змінними середовища:
//
//   KH_GLOSSARY — повний шлях до _glossary.json
//   KH_TSV_DIR  — тека PROGRESS (де лежить глосарій)
//   KH_ENG_DIR  — тека ENG
//   KH_REF_DIR  — тека референсних файлів
//   KH_UNPACK   — тека з розпакованими ресурсами гри

const fs = require('fs');
const path = require('path');

// Тека даних застосунку; друга назва — та, що була до перейменування.
const APP_DIRS = ['KINGDOM HEARTS LOCALIZATION TOOL', 'KH1 Text Editor'];
const SETTINGS_FILE = 'translate-settings.json';

function appDataRoot() {
  return process.env.APPDATA
    || (process.platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library', 'Application Support')
      : path.join(process.env.HOME || '', '.config'));
}

function settingsPath() {
  const root = appDataRoot();
  for (const dir of APP_DIRS) {
    const p = path.join(root, dir, SETTINGS_FILE);
    if (fs.existsSync(p)) return p;
  }
  return path.join(root, APP_DIRS[0], SETTINGS_FILE);
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

// gameDir(key, gameId?) — значення теки з налаштувань; null, якщо не задано.
function gameDir(key, gameId) {
  const s = readSettings();
  const games = s.games || {};
  if (gameId) return (games[gameId] && games[gameId][key]) || s[key] || null;
  for (const gid of Object.keys(games)) {
    if (games[gid] && games[gid][key]) return games[gid][key];
  }
  return s[key] || null;
}

function required(value, hint) {
  if (value) return value;
  throw new Error('Не знайдено шлях: ' + hint + '. Задай його змінною середовища або налаштуй теку у застосунку.');
}

function glossaryPath(gameId) {
  if (process.env.KH_GLOSSARY) return process.env.KH_GLOSSARY;
  const dir = process.env.KH_TSV_DIR || gameDir('tsvDir', gameId);
  return path.join(required(dir, 'тека PROGRESS (tsvDir)'), '_glossary.json');
}

function engDir(gameId) {
  return required(process.env.KH_ENG_DIR || gameDir('engDir', gameId), 'тека ENG');
}

function refDir(gameId) {
  return required(process.env.KH_REF_DIR || gameDir('refDir', gameId), 'тека референсних файлів');
}

function unpackDir() {
  return required(process.env.KH_UNPACK, 'тека з розпакованими ресурсами (KH_UNPACK)');
}

module.exports = { settingsPath, readSettings, gameDir, glossaryPath, engDir, refDir, unpackDir };
