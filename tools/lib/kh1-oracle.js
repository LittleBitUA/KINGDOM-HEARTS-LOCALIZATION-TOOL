'use strict';

// Вбудований еталон неперекладних рядків KH1 (data/kh1_oracle.json, див.
// tools/kh1-oracle-build.js). Замінює теку RUS: extract() вважає ці
// 0x00-розмежені сегменти службовими й не робить з них слотів.

const fs = require('fs');
const path = require('path');

const ORACLE_PATH = path.join(__dirname, '..', '..', 'data', 'kh1_oracle.json');
let _cache;

function load() {
  if (_cache !== undefined) return _cache;
  try {
    const doc = JSON.parse(fs.readFileSync(ORACLE_PATH, 'utf8'));
    _cache = (doc && doc.files) || {};
  } catch (_) {
    _cache = {};
  }
  return _cache;
}

// Масив latin1-рядків для файла (за basename, без урахування регістру) або [].
function preservedFor(filePath) {
  if (!filePath) return [];
  const base = path.basename(String(filePath)).toLowerCase();
  const list = load()[base];
  return Array.isArray(list) ? list : [];
}

module.exports = { preservedFor, load, ORACLE_PATH };
