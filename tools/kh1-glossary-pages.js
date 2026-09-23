'use strict';

// Перенесення глосарія KH1 на посторінковий розбір.
//
// Було: рядок різався по кожному байту 0x00, тому ключі виглядали як
// «Cannot carry any more{lf}{text_x}» — обрізок повідомлення з недогризеною
// командою. Стало: один рядок = одна сторінка, а службова обгортка (інтервал,
// зсув, тривалість показу) у ключ не входить узагалі.
//
// Скрипт бере наявний _glossary.json і будує новий:
//   1) точний збіг ключа;
//   2) ключ без обгортки (splitEdges);
//   3) складання нового рядка зі старих шматків — найдовший збіг зліва направо
//      (саме так і виглядали старі ключі: «Cannot carry any more» + «{item_name}.»).
// Старий файл зберігається як _glossary.json.before-pages.bak.
//
//   node tools/kh1-glossary-pages.js <PROGRESS-тека> <ENG-тека> [--apply]

const fs = require('fs');
const path = require('path');
const { splitEdges, nameTokens } = require('../shared/kh1-tokens');
const ops = require('./lib/translate-ops');

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// Старий ключ/значення → шматки без обгортки. Ключі, що перетинали межу
// сторінки, розбиваємо по {page} (нові рядки — посторінкові).
function piecesOf(key, value) {
  const out = [];
  const add = (k, v) => {
    const kb = splitEdges(nameTokens(k, 'dialog')).body;
    const vb = splitEdges(nameTokens(v, 'dialog')).body;
    if (kb && vb && kb !== vb) out.push([kb, vb]);
  };
  add(key, value);
  const kp = key.split('{page}'), vp = value.split('{page}');
  if (kp.length > 1 && kp.length === vp.length) for (let i = 0; i < kp.length; i++) add(kp[i], vp[i]);
  return out;
}

async function main() {
  const progressDir = process.argv[2];
  const engDir = process.argv[3];
  const apply = process.argv.includes('--apply');
  if (!progressDir || !engDir) {
    console.error('Використання: node tools/kh1-glossary-pages.js <PROGRESS> <ENG> [--apply]');
    process.exit(2);
  }
  const gPath = path.join(progressDir, '_glossary.json');
  const doc = JSON.parse(fs.readFileSync(gPath, 'utf8'));
  const oldG = doc.entries || {};

  const files = walk(engDir, engDir, []);
  const idx = await ops.buildGlossaryIndex(files, { engDir, safeMode: true, withOccurrences: false, concurrency: 8 });
  const newKeys = idx.entries.map(e => e.english);

  // словник шматків, найдовші — першими
  const pieces = new Map();
  for (const [k, v] of Object.entries(oldG)) for (const [pk, pv] of piecesOf(k, v)) if (!pieces.has(pk)) pieces.set(pk, pv);
  const byLen = [...pieces.keys()].sort((a, b) => b.length - a.length);

  const out = Object.create(null);
  const used = new Set();
  let exact = 0, edges = 0, assembled = 0, partial = 0;
  for (const key of newKeys) {
    if (Object.prototype.hasOwnProperty.call(oldG, key)) {
      const v = splitEdges(nameTokens(oldG[key], 'dialog')).body;
      if (v && v !== key) { out[key] = v; used.add(key); exact++; }
      continue;
    }
    const body = splitEdges(key).body;
    if (pieces.has(key)) { out[key] = pieces.get(key); used.add(key); edges++; continue; }
    if (body !== key && pieces.has(body)) { out[key] = pieces.get(body); used.add(body); edges++; continue; }
    // Складання: найдовший збіг зліва направо. Старі шматки різалися рівно по
    // межах команд, тож і підставляти їх можна лише на такій межі — інакше
    // «Defender» замінилося б усередині англійського речення («Захисникs»).
    let res = key, hit = false;
    for (const pk of byLen) {
      if (!pk || pk.length < 3) continue;
      let at = res.indexOf(pk);
      while (at >= 0) {
        const okStart = at === 0 || res[at - 1] === '}';
        const okEnd = at + pk.length === res.length || res[at + pk.length] === '{';
        if (okStart && okEnd) {
          res = res.slice(0, at) + pieces.get(pk) + res.slice(at + pk.length);
          hit = true;
          used.add(pk);
          at = res.indexOf(pk, at + pieces.get(pk).length);
        } else {
          at = res.indexOf(pk, at + 1);
        }
      }
    }
    if (hit && res !== key) {
      out[key] = res;
      assembled++;
      // лишилася англійська? рядок треба переглянути
      if (/[A-Za-z]{3,}/.test(res.replace(/\{[^{}]*\}/g, ''))) partial++;
    }
  }

  const unused = [...pieces.keys()].filter(k => !used.has(k));
  console.log('нових рядків у глосарії:', newKeys.length);
  console.log('перенесено:', Object.keys(out).length,
    '(точний ключ ' + exact + ', без обгортки ' + edges + ', складанням ' + assembled + ')');
  console.log('складених, де ще лишилась англійська (варто переглянути):', partial);
  console.log('старих записів, які нікуди не лягли:', unused.length);
  unused.slice(0, 20).forEach(k => console.log('   ', JSON.stringify(k.slice(0, 80))));

  if (process.argv.includes('--samples')) {
    const ks = Object.keys(out);
    const mid = Math.floor(ks.length / 2);
    console.log('\nприклади перенесених рядків:');
    for (const k of ks.slice(0, 8).concat(ks.slice(mid, mid + 6))) {
      console.log('   EN', JSON.stringify(k.slice(0, 110)));
      console.log('   UK', JSON.stringify(out[k].slice(0, 110)));
    }
  }
  const outFlag = process.argv.indexOf('--out');
  if (outFlag > 0 && process.argv[outFlag + 1]) {
    fs.writeFileSync(process.argv[outFlag + 1], JSON.stringify({ version: 1, entries: out }, null, 2), 'utf8');
    console.log('\nзаписано копію:', process.argv[outFlag + 1]);
  }
  if (!apply) { console.log('\n(це прогін без запису; додай --apply, щоб зберегти)'); return; }
  const bak = gPath + '.before-pages.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(gPath, bak);
  fs.writeFileSync(gPath, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), entries: out }, null, 2), 'utf8');
  console.log('\nзаписано', gPath, '\nстарий файл:', bak);
}

main().catch(e => { console.error(e); process.exit(1); });
