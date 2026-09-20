'use strict';

// Будує вбудований еталон «неперекладних» рядків KH1 (data/kh1_oracle.json).
//
// Раніше для цього потрібна була тека RUS (інший переклад): рядок з ENG, який
// дослівно є у RUS-файлі, вважається неперекладним (службові ідентифікатори,
// {ColorGreen}{Key}{VarItem}…, debug-тексти). Щоб не залежати від чужих
// файлів, тут один раз обчислюємо ці рядки й зберігаємо їх у data/ — це
// оригінальні англійські/токенні байти з гри, жодного тексту з RUS.
//
//   node tools/kh1-oracle-build.js --eng <ENG dir> --rus <RUS dir> [--rus <ще одна>] [--out data/kh1_oracle.json]
//
// ENG — робоча розкладка (<archive>/<шлях> або плоска kh1_first). Reference для
// кожного файла шукається у кожній --rus теці як: <rel>, <kh1OutRel(rel)>
// (розкладка гри: kh1_second/remastered/al01.ard/…), <rel без префікса архіву>.
// Ключ — basename файла; якщо однакові імена є у кількох архівах (US_allarea.nam),
// множини сегментів об'єднуються.

const fs = require('fs');
const path = require('path');
const { classifyFile } = require('./lib/formats');
const { splitStrings, segmentSet } = require('./lib/extract');
const { kh1OutRel, kh1StripArchive } = require('../shared/text-structure');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function args(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  return out;
}
function findReference(rusDirs, rel) {
  for (const d of rusDirs) {
    for (const cand of [rel, kh1OutRel(rel), kh1StripArchive(rel)]) {
      const p = path.join(d, cand);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
// Ті самі первинні фільтри, що в extract(): довжина ≥ minLen і є друковані байти.
function hasTextContent(bytes) {
  let n = 0;
  for (const b of bytes) if ((b >= 0x21 && b <= 0x79) || b === 0x01) n++;
  return n >= 2;
}

async function main() {
  const eng = arg('--eng'), rusDirs = args('--rus');
  const out = arg('--out', path.join(__dirname, '..', 'data', 'kh1_oracle.json'));
  if (!eng || !rusDirs.length) {
    console.error('usage: node tools/kh1-oracle-build.js --eng <dir> --rus <dir> [--rus <dir>] [--out file]');
    process.exit(2);
  }
  const files = {};
  let nFiles = 0, nSegs = 0, noRef = 0;
  for (const rel of walk(eng, eng, [])) {
    const engPath = path.join(eng, rel);
    const cls = await classifyFile(engPath);
    if (!cls || (cls.kind !== 'binl' && cls.kind !== 'rawbin')) continue;
    const rusPath = findReference(rusDirs, rel);
    if (!rusPath) { noRef++; continue; }
    const base = path.basename(rel).toLowerCase();
    const o = cls.extractOpts || {};
    const segs = splitStrings(fs.readFileSync(engPath),
      o.header != null ? o.header : 11, o.footer != null ? o.footer : 5);
    const refSegs = segmentSet(fs.readFileSync(rusPath));
    const minLen = o.minLen != null ? o.minLen : 3;
    const preserved = new Set();
    for (const s of segs) {
      if (s.bytes.length < minLen || !hasTextContent(s.bytes)) continue;
      const str = s.bytes.toString('latin1');
      if (refSegs.has(str)) preserved.add(str);
    }
    if (preserved.size) {
      const merged = new Set(files[base] || []);
      for (const x of preserved) merged.add(x);
      nSegs += merged.size - (files[base] ? files[base].length : 0);
      files[base] = [...merged];
    }
    nFiles++;
  }
  if (noRef) console.warn('files without reference:', noRef);
  const doc = {
    format: 'kh1-preserved-segments',
    version: 1,
    note: 'ENG segments (latin1) that a reference translation left untouched — treated as untranslatable. Original game bytes only.',
    files
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n', 'utf8');
  console.log('files scanned:', nFiles, '| files with preserved:', Object.keys(files).length, '| segments:', nSegs, '→', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
