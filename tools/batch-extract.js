#!/usr/bin/env node
'use strict';

/**
 * Рекурсивно обходить теку RUS_DIR, для кожного файлу шукає однойменний
 * файл у ENG_DIR і витягує translatable-рядки. Видає по одному .tsv у
 * OUT_DIR + загальний summary.tsv.
 *
 * Використання:
 *   node tools/batch-extract.js <RUS_DIR> <ENG_DIR> <OUT_DIR>
 *
 * Опції через env:
 *   MIN_LEN=3 HEADER=11 FOOTER=5
 *   MAX_BYTES=10485760  максимальний розмір файлу (10 МБ за замовчуванням)
 */

const fs = require('fs');
const path = require('path');
const { extract, slotsToTsv } = require('./lib/extract');

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Використання: node tools/batch-extract.js <RUS_DIR> <ENG_DIR> <OUT_DIR>');
  process.exit(1);
}

const RUS_DIR = path.resolve(args[0]);
const ENG_DIR = path.resolve(args[1]);
const OUT_DIR = path.resolve(args[2]);

const opts = {
  header: parseInt(process.env.HEADER || '11', 10),
  footer: parseInt(process.env.FOOTER || '5', 10),
  minLen: parseInt(process.env.MIN_LEN || '3', 10)
};
const MAX_BYTES = parseInt(process.env.MAX_BYTES || String(10 * 1024 * 1024), 10);

function* walk(dir, base = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = base ? path.join(base, e.name) : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(abs, rel);
    } else if (e.isFile()) {
      yield { rel, abs };
    }
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const summary = [];
let totalSlots = 0;
let totalTranslatable = 0;
let processed = 0;
let skippedNoEng = 0;
let skippedTooBig = 0;
let skippedHeader = 0;
let errors = 0;

console.error('Сканую RUS:', RUS_DIR);
console.error('Шукаю в  ENG:', ENG_DIR);
console.error('Вихід в OUT:', OUT_DIR);
console.error('---');

for (const { rel, abs: rusPath } of walk(RUS_DIR)) {
  const engPath = path.join(ENG_DIR, rel);
  if (!fs.existsSync(engPath)) {
    skippedNoEng++;
    continue;
  }

  const rusStat = fs.statSync(rusPath);
  const engStat = fs.statSync(engPath);
  if (rusStat.size > MAX_BYTES || engStat.size > MAX_BYTES) {
    skippedTooBig++;
    continue;
  }
  if (rusStat.size < opts.header + opts.footer || engStat.size < opts.header + opts.footer) {
    skippedHeader++;
    continue;
  }

  let result;
  try {
    const eng = fs.readFileSync(engPath);
    const rus = fs.readFileSync(rusPath);
    result = extract(eng, rus, opts);
  } catch (e) {
    errors++;
    summary.push({ rel, error: e.message });
    continue;
  }

  const outPath = path.join(OUT_DIR, rel + '.tsv');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, slotsToTsv(result.slots), 'utf8');

  processed++;
  totalSlots += result.slots.length;
  totalTranslatable += result.stats.translatable;

  summary.push({
    rel,
    engSize: engStat.size,
    rusSize: rusStat.size,
    engStrings: result.stats.engStrings,
    translatable: result.stats.translatable,
    preserved: result.stats.preserved
  });
}

const sumPath = path.join(OUT_DIR, '_summary.tsv');
const sumLines = ['file\teng_size\trus_size\teng_strings\ttranslatable\tpreserved\tnote'];
for (const s of summary) {
  if (s.error) {
    sumLines.push([s.rel, '', '', '', '', '', 'error: ' + s.error].join('\t'));
  } else {
    sumLines.push([s.rel, s.engSize, s.rusSize, s.engStrings, s.translatable, s.preserved, ''].join('\t'));
  }
}
fs.writeFileSync(sumPath, sumLines.join('\n') + '\n', 'utf8');

console.error('---');
console.error('Опрацьовано файлів:', processed);
console.error('Пропущено (немає в ENG):', skippedNoEng);
console.error('Пропущено (завеликий):', skippedTooBig);
console.error('Пропущено (замалий):', skippedHeader);
console.error('Помилок:', errors);
console.error('Всього translatable рядків:', totalTranslatable);
console.error('Summary:', sumPath);
