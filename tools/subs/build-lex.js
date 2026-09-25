'use strict';
const WORK = require('path').join(__dirname, 'work');
// Словник рівня слів із ТВОЇХ готових пар: 1669 рядків «англійська → українська».
// Якщо слово heart і слово серц регулярно трапляються в одних і тих самих парах
// і рідко поодинці — це переклад. Міра Дайса, без жодних зовнішніх даних.
const fs = require('fs');
const GLOS = require('../lib/user-paths').glossaryPath();
const CYR = /[А-Яа-яЇїІіЄєҐґ]/;

const STOP_EN = new Set('the a an and or but of to in on at is are was were be been it its this that for with you your i me my we our they he she his her him them do does did not no so if as from all what who how why when there here just now get got can could will would have has had am re ve ll s t'.split(' '));
const STOP_UK = new Set('і й та але або що це той цей до в на за з із зі як так ні не бо для про від у о а ж бы би вже ще де коли хто чому ми ви вони він вона воно я ти мене тебе його її їх мій твій наш ваш є був була були бути тут там дуже все всі'.split(' '));

// Грубе відкидання закінчень: беремо основу слова.
const stemEn = (w) => w.replace(/(ing|ed|es|s)$/, '').slice(0, 6);
const stemUk = (w) => w.slice(0, 5);

const words = (s, uk) => {
  const t = String(s).replace(/\{[^{}]*\}/g, ' ').toLowerCase()
    .replace(uk ? /[^а-яїієґ' ]+/g : /[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (const w of t) {
    if (w.length < 3) continue;
    if (uk) { if (STOP_UK.has(w)) continue; out.add(stemUk(w)); }
    else { if (STOP_EN.has(w)) continue; out.add(stemEn(w)); }
  }
  return out;
};

const glos = JSON.parse(fs.readFileSync(GLOS, 'utf8')).entries || {};
const rows = Object.entries(glos).filter(([, v]) => v && CYR.test(v));
console.log('пар для навчання:', rows.length);

const cE = new Map(), cU = new Map(), cEU = new Map();
for (const [en, u] of rows) {
  const E = words(en, false), U = words(u, true);
  for (const e of E) cE.set(e, (cE.get(e) || 0) + 1);
  for (const x of U) cU.set(x, (cU.get(x) || 0) + 1);
  for (const e of E) for (const x of U) {
    const k = e + '\u0000' + x;
    cEU.set(k, (cEU.get(k) || 0) + 1);
  }
}

const lex = {};
let kept = 0;
for (const [k, c] of cEU) {
  if (c < 3) continue;
  const [e, u] = k.split('\u0000');
  const d = 2 * c / (cE.get(e) + cU.get(u));
  if (d < 0.30) continue;
  if (!lex[e] || lex[e][1] < d) { lex[e] = [u, Number(d.toFixed(3)), c]; kept++; }
}
fs.writeFileSync(WORK + '/lex.json', JSON.stringify(lex), 'utf8');
console.log('англійських основ зі знайденим відповідником:', Object.keys(lex).length, '| розглянуто:', kept);
const top = Object.entries(lex).sort((a, b) => b[1][2] - a[1][2]).slice(0, 25);
console.log('');
console.log('найчастіші (основа → основа, міра, скільки разів разом):');
for (const [e, v] of top) console.log('   ' + e.padEnd(8) + ' → ' + v[0].padEnd(8) + ' ' + v[1] + '  x' + v[2]);
