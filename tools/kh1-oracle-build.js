'use strict';

// Будує вбудований еталон «неперекладних» рядків KH1 (data/kh1_oracle.json).
//
// Раніше для цього потрібна була тека RUS (інший переклад): рядок з ENG, який
// дослівно є у RUS-файлі, вважається неперекладним (службові ідентифікатори,
// {ColorGreen}{Key}{VarItem}…, debug-тексти). Щоб не залежати від чужих
// файлів, тут один раз обчислюємо ці рядки й зберігаємо їх у data/ — це
// оригінальні англійські/токенні байти з гри, жодного тексту з RUS.
//
//   node tools/kh1-oracle-build.js --eng <ENG dir> --rus <RUS dir> [--out data/kh1_oracle.json]
//
// Ключ — basename файла (у KH1 усі текстові файли мають унікальні імена,
// тому розкладка ENG (плоска чи remastered/…) не має значення).

const fs = require('fs');
const path = require('path');
const { classifyFile } = require('./lib/formats');
const { splitStrings, segmentSet } = require('./lib/extract');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
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
  const eng = arg('--eng'), rus = arg('--rus');
  const out = arg('--out', path.join(__dirname, '..', 'data', 'kh1_oracle.json'));
  if (!eng || !rus) {
    console.error('usage: node tools/kh1-oracle-build.js --eng <dir> --rus <dir> [--out file]');
    process.exit(2);
  }
  const files = {};
  const seen = new Map();
  let nFiles = 0, nSegs = 0;
  for (const rel of walk(eng, eng, [])) {
    const engPath = path.join(eng, rel);
    const cls = await classifyFile(engPath);
    if (!cls || (cls.kind !== 'binl' && cls.kind !== 'rawbin')) continue;
    const rusPath = path.join(rus, rel);
    if (!fs.existsSync(rusPath)) { console.warn('no reference for', rel); continue; }
    const base = path.basename(rel).toLowerCase();
    if (seen.has(base)) throw new Error('duplicate basename ' + base + ': ' + seen.get(base) + ' and ' + rel);
    seen.set(base, rel);
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
    if (preserved.size) { files[base] = [...preserved]; nSegs += preserved.size; }
    nFiles++;
  }
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
