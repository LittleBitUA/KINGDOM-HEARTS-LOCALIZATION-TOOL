#!/usr/bin/env node
'use strict';

/**
 * Знаходить translatable-рядки в eng за допомогою ref як оракула.
 *
 * Використання:
 *   node tools/diff-extract.js <eng> <ref> [output.tsv]
 *
 * Опції через env:
 *   MIN_LEN=3 HEADER=11 FOOTER=5
 */

const fs = require('fs');
const path = require('path');
const { extract, slotsToTsv } = require('./lib/extract');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Використання: node tools/diff-extract.js <eng> <ref> [output.tsv]');
  process.exit(1);
}

const ENG_PATH = args[0];
const REF_PATH = args[1];
const OUT_PATH = args[2] || path.basename(ENG_PATH).replace(/\.[^.]+$/, '') + '_slots.tsv';

const eng = fs.readFileSync(ENG_PATH);
const ref = fs.readFileSync(REF_PATH);

const opts = {
  header: parseInt(process.env.HEADER || '11', 10),
  footer: parseInt(process.env.FOOTER || '5', 10),
  minLen: parseInt(process.env.MIN_LEN || '3', 10)
};

console.error('eng:', ENG_PATH, eng.length, 'байт');
console.error('ref:', REF_PATH, ref.length, 'байт');
console.error('header:', opts.header, '· footer:', opts.footer, '· min text length:', opts.minLen);

const { slots, stats } = extract(eng, ref, opts);

console.error('--- Результат ---');
console.error('  eng strings:', stats.engStrings);
console.error('  translatable:', stats.translatable);
console.error('  preserved:', stats.preserved);
console.error('  skipped: short=' + stats.skippedShort, '· no-text=' + stats.skippedNoText, '· empty=' + stats.skippedEmpty);

fs.writeFileSync(OUT_PATH, slotsToTsv(slots), 'utf8');
console.error('Записано:', OUT_PATH);
