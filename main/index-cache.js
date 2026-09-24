'use strict';

// Кеш індексу глосарія: список унікальних перекладних рядків гри, зібраний
// при вході в гру (translate:buildGlossary). Лежить у
// <userData>/index-cache/<key>.json — key залежить від теки ENG, версії
// застосунку й safeMode, тож його можна обчислити й без списку файлів.
// Це дає головному екрану справжній відсоток перекладу без повторного
// розбору архівів.
//
// Ключ навмисно містить версію застосунку (формати можуть змінитися разом із
// нею), але через це після кожного оновлення кеш «зникав» би для головного
// екрана, доки користувач не відкриє гру. Тому поруч тримаємо `_map.json`:
// тека ENG → останній відомий файл кешу. Для відсотка цього досить.
//
// INDEX_CACHE_VERSION піднімати, коли змінюються ключі/слоти у format-handler'ах.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

const INDEX_CACHE_VERSION = 6;   // 4: іменовані токени KH1; 5: рядки лише з команд розкладки не текст; 6: слот = сторінка, обгортка поза ключем

function indexCacheDir() {
  return path.join(app.getPath('userData'), 'index-cache');
}

function indexCacheKey(engDir, safeMode) {
  return crypto.createHash('sha1')
    .update([INDEX_CACHE_VERSION, app.getVersion(), String(engDir).toLowerCase(), safeMode ? 1 : 0].join('|'))
    .digest('hex');
}

function indexCacheFile(engDir, safeMode) {
  return path.join(indexCacheDir(), indexCacheKey(engDir, safeMode) + '.json');
}

const mapFile = () => path.join(indexCacheDir(), '_map.json');
const mapKey = (engDir, safeMode) => String(engDir).toLowerCase() + '|' + (safeMode ? 1 : 0);

function readMap() {
  try { return JSON.parse(fs.readFileSync(mapFile(), 'utf8')) || {}; } catch (_) { return {}; }
}

// Запам'ятати, який файл кешу відповідає цій теці ENG (викликається після запису).
function rememberIndexCache(engDir, safeMode, file) {
  try {
    const m = readMap();
    m[mapKey(engDir, safeMode)] = { file: path.basename(file), savedAt: new Date().toISOString() };
    fs.mkdirSync(indexCacheDir(), { recursive: true });
    fs.writeFileSync(mapFile(), JSON.stringify(m, null, 2), 'utf8');
  } catch (_) { /* кеш — не критичний ресурс */ }
}

// Знайти кеш для теки ENG: спершу точний ключ, далі — останній відомий.
function findIndexCache(engDir, safeMode) {
  const exact = indexCacheFile(engDir, safeMode);
  if (fs.existsSync(exact)) return exact;
  const rec = readMap()[mapKey(engDir, safeMode)];
  if (rec && rec.file) {
    const p = path.join(indexCacheDir(), rec.file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = {
  INDEX_CACHE_VERSION, indexCacheDir, indexCacheKey, indexCacheFile,
  rememberIndexCache, findIndexCache
};
