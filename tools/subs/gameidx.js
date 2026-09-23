'use strict';
const WORK = require('path').join(__dirname, 'work');
// Кеш усіх рядків гри: нормалізований текст -> оригінал, і список файлів.
const fs = require('fs');
const path = require('path');
const ROOT = 'E:/Localization/Kingdom Hearts Final Mix';
const { classifyFile } = require(ROOT + '/tools/lib/formats/classify.js');
const { parseFile } = require(ROOT + '/tools/lib/formats/index.js');
const ENG = 'C:/Users/bidlov/Documents/KH-Localization/KH1/ENG';
const OUT = WORK + '/gameidx.json';

const norm = (s) => String(s)
  .replace(/\{lf\}/g, ' ').replace(/\{[^{}]*\}/g, ' ')
  .replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2014\u2013\u30FC\uFF0D]/g, '-').replace(/\u2026/g, '...')
  .toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function walk(d, b, o) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, b, o); else o.push(path.relative(b, p).split(path.sep).join('/'));
  }
  return o;
}

async function build() {
  const byNorm = {};
  const files = {};
  for (const rel of walk(ENG, ENG, [])) {
    const abs = path.join(ENG, rel);
    const cls = classifyFile(abs, path.extname(abs).toLowerCase());
    if (!cls.isTranslatable) continue;
    let p;
    try { p = await parseFile(abs, { cls }); } catch (_) { continue; }
    if (!p.slots.length) continue;
    files[rel] = p.slots.map(s => s.english);
    p.slots.forEach((s, i) => {
      const k = norm(s.english);
      if (k.length >= 4 && !byNorm[k]) byNorm[k] = { en: s.english, f: rel, i };
    });
  }
  fs.writeFileSync(OUT, JSON.stringify({ byNorm, files }), 'utf8');
  return { byNorm, files };
}

function load() {
  if (fs.existsSync(OUT)) return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  return null;
}

module.exports = { norm, build, load, walk, ENG };
if (require.main === module) build().then(x => console.log('файлів:', Object.keys(x.files).length, '| унікальних рядків:', Object.keys(x.byNorm).length));
