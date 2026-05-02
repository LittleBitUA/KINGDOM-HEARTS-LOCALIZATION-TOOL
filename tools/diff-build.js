#!/usr/bin/env node
'use strict';

/**
 * Бере оригінальний eng-файл + заповнений TSV (з колонкою ukrainian)
 * і записує новий файл з українським текстом, вставленим у позначені offset-и.
 *
 * Використання:
 *   node tools/diff-build.js <eng> <slots.tsv> [out.binl]
 *
 * Опції через env:
 *   HEADER=11 FOOTER=5     розмір заголовка/хвоста (для перевірки що offset валідні)
 *   STRICT=1               падати на першій помилці кодування (інакше — лишити eng-байти і йти далі)
 */

const fs = require('fs');
const path = require('path');
const { encode } = require('../shared/codec');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Використання: node tools/diff-build.js <eng> <slots.tsv> [out.binl]');
  process.exit(1);
}

const ENG_PATH = args[0];
const TSV_PATH = args[1];
const OUT_PATH = args[2] || path.basename(ENG_PATH).replace(/\.[^.]+$/, '') + '_uk' + path.extname(ENG_PATH);

const STRICT = process.env.STRICT === '1';

const eng = fs.readFileSync(ENG_PATH);
const tsv = fs.readFileSync(TSV_PATH, 'utf8');

// ---- розпарсити TSV ----
const lines = tsv.split(/\r?\n/);
if (lines.length < 1) {
  console.error('Порожній TSV.');
  process.exit(1);
}
const header = lines[0].split('\t');
const idxOffset = header.indexOf('offset');
const idxBytes = header.indexOf('bytes');
const idxUk = header.indexOf('ukrainian');
if (idxOffset < 0 || idxBytes < 0 || idxUk < 0) {
  console.error('TSV має містити колонки: offset, bytes, ukrainian. Знайдено:', header);
  process.exit(1);
}

const replacements = [];
let totalRows = 0;
let emptyUk = 0;
let parseFails = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const cols = line.split('\t');
  totalRows++;

  const offHex = cols[idxOffset];
  const len = parseInt(cols[idxBytes], 10);
  let uk = cols[idxUk] || '';
  if (!uk) { emptyUk++; continue; }

  // де-екранування \n \t
  uk = uk.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

  const off = parseInt(offHex, 16);
  if (!Number.isFinite(off) || !Number.isFinite(len)) {
    parseFails++;
    if (STRICT) { console.error('Битий рядок ' + (i + 1) + ': ' + line); process.exit(1); }
    continue;
  }

  replacements.push({ offset: off, oldLen: len, ukText: uk, lineNo: i + 1 });
}

replacements.sort((a, b) => a.offset - b.offset);

// перевірка перетинів
for (let i = 1; i < replacements.length; i++) {
  const prev = replacements[i - 1];
  const cur = replacements[i];
  if (cur.offset < prev.offset + prev.oldLen) {
    console.error('Перетин offset ' + cur.offset + ' з попереднім [' + prev.offset + ', +' + prev.oldLen + ']');
    if (STRICT) process.exit(1);
  }
}

// ---- зібрати новий файл: chunks з eng + закодовані заміни ----
const out = [];
let cursor = 0;
let encodeErrors = 0;
let written = 0;

for (const r of replacements) {
  if (r.offset > cursor) {
    out.push(eng.subarray(cursor, r.offset));
  } else if (r.offset < cursor) {
    console.error('Offset ' + r.offset + ' позаду курсора ' + cursor + ' — пропущено.');
    continue;
  }

  let bytes;
  try {
    bytes = encode(r.ukText);
  } catch (e) {
    encodeErrors++;
    console.error('Рядок ' + r.lineNo + ' (offset 0x' + r.offset.toString(16).toUpperCase() + '): ' + e.message);
    if (STRICT) process.exit(1);
    // лишаємо оригінальні eng-байти
    out.push(eng.subarray(r.offset, r.offset + r.oldLen));
    cursor = r.offset + r.oldLen;
    continue;
  }

  out.push(bytes);
  cursor = r.offset + r.oldLen;
  written++;
}

if (cursor < eng.length) {
  out.push(eng.subarray(cursor));
}

const finalBuf = Buffer.concat(out);
fs.writeFileSync(OUT_PATH, finalBuf);

console.error('--- Результат ---');
console.error('Всього рядків у TSV:', totalRows);
console.error('Заповнено українською:', totalRows - emptyUk);
console.error('Записано замін:', written);
console.error('Помилок кодування:', encodeErrors);
console.error('Помилок парсингу:', parseFails);
console.error('Розмір eng:', eng.length, '· uk:', finalBuf.length, '· delta:', finalBuf.length - eng.length);
console.error('Вихід:', OUT_PATH);
