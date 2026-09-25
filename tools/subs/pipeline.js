'use strict';
const WORK = require('path').join(__dirname, 'work');
// Субтитри → текст гри.
//
// І субтитри (файли 00..24), і скрипт GameFAQs ідуть у порядку сюжету, тож не
// треба вгадувати світ для кожного .srt — зшиваємо все в ОДНУ послідовність і
// вирівнюємо глобально. Порядок сам розводить сцени по світах.
//
// Опора — якорі двох родів:
//   1) переклад: український текст репліки майже збігається з ГОТОВИМ рядком
//      глосарія → репліка прив'язана до позиції у скрипті;
//   2) власна назва: у репліці згадано Себастьяна, і в скрипті є рівно кілька
//      реплік зі словом Sebastian. Не залежить від наявності перекладу, тож
//      працює й там, де глосарій порожній.
// З усіх кандидатів лишаємо найдовший ланцюг, що ЗРОСТАЄ і за номером репліки,
// і за позицією у скрипті. Сортування si за спаданням у межах одного ci дає
// не більше одного якоря на репліку.
//
// Готові переклади не чіпаємо — вони служать ЛИШЕ для перевірки.

const fs = require('fs');
const path = require('path');
const { readSrt, feat, sim } = require('./subs-align.js');
const { norm, load } = require('./gameidx.js');
const SUBS = 'E:/Localization/Kingdom Hearts Final Mix/Edited_Subs';
const GLOS = require('../lib/user-paths').glossaryPath();
const CYR = /[А-Яа-яЇїІіЄєҐґ]/;

const GAP = Number(process.env.GAP || 800);
const SIM = Number(process.env.SIM || 0.6);
const NFREQ = Number(process.env.NFREQ || 40);   // ім'я вважаємо придатним, якщо воно не надто часте
const MINW = 4;

const n2 = (x) => String(x).replace(/\{[^{}]*\}/g, ' ').toLowerCase()
  .replace(/[^а-яїієґa-z0-9 ]+/gi, ' ').replace(/\s+/g, ' ').trim();
const jacc = (a, b) => {
  const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / new Set([...A, ...B]).size;
};

const IDX = load();
const glos = JSON.parse(fs.readFileSync(GLOS, 'utf8')).entries || {};
const uk = Object.entries(glos).filter(([, v]) => v && CYR.test(v)).map(([k, v]) => ({ en: k, n: n2(v) }));
const inv = new Map();
uk.forEach((u, i) => {
  for (const w of new Set(u.n.split(' '))) {
    if (w.length < 3) continue;
    if (!inv.has(w)) inv.set(w, []);
    inv.get(w).push(i);
  }
});
const translated = new Set(uk.map(u => u.en));

// ── скрипт у порядку сюжету → рядки гри
const says = JSON.parse(fs.readFileSync(WORK + '/gf.json', 'utf8')).filter(l => l.kind === 'say');
const rowToScript = new Map();
says.forEach((s, si) => {
  const k = norm(s.text);
  s.rows = [];
  if (!k) return;
  if (IDX.byNorm[k]) {
    s.rows = [IDX.byNorm[k]];
  } else {
    // Скрипт зливає кілька екранів гри в один абзац — жадібно з'їдаємо
    // найдовший префікс, який є у грі, і так до кінця репліки.
    const w = k.split(' ');
    let i = 0; const got = [];
    while (i < w.length) {
      let best = -1;
      for (let j = w.length; j > i; j--) if (IDX.byNorm[w.slice(i, j).join(' ')]) { best = j; break; }
      if (best < 0) { got.length = 0; break; }
      got.push(IDX.byNorm[w.slice(i, best).join(' ')]);
      i = best;
    }
    s.rows = got;
  }
  for (const r of s.rows) if (!rowToScript.has(r.en)) rowToScript.set(r.en, si);
});

// ── усі репліки субтитрів у порядку файлів
const files = fs.readdirSync(SUBS).filter(x => /\.srt$/i.test(x)).sort();
const cues = [];
for (const f of files) for (const t of readSrt(path.join(SUBS, f))) cues.push({ f, t });
console.log('реплік субтитрів:', cues.length, '| реплік скрипта:', says.length,
  '| з них знайдено в грі:', says.filter(s => s.rows.length).length);

// ── якорі за перекладом
const cand = [];
let nTrans = 0;
cues.forEach((c, ci) => {
  const n = n2(c.t);
  if (n.split(' ').length < MINW) return;
  const pool = new Map();
  for (const w of new Set(n.split(' '))) {
    if (w.length < 3) continue;
    for (const i of (inv.get(w) || [])) pool.set(i, 1);
  }
  let bs = 0, bi = -1;
  for (const i of pool.keys()) { const s = jacc(n, uk[i].n); if (s > bs) { bs = s; bi = i; } }
  if (bs >= 0.7 && bi >= 0 && rowToScript.has(uk[bi].en)) {
    cand.push({ ci, si: rowToScript.get(uk[bi].en), kind: 'T' });
    nTrans++;
  }
});

// ── якорі за власними назвами
const NAMES = JSON.parse(fs.readFileSync(__dirname + '/names.json', 'utf8'));
const RE = {};
for (const k of Object.keys(NAMES)) RE[k] = new RegExp('\\b' + k + '\\b', 'i');
const sayNames = says.map(s => Object.keys(NAMES).filter(k => RE[k].test(s.text)));
const freq = new Map();
for (const ns of sayNames) for (const n of new Set(ns)) freq.set(n, (freq.get(n) || 0) + 1);
const byName = new Map();
sayNames.forEach((m, si) => {
  if (m.length !== 1) return;
  if (!byName.has(m[0])) byName.set(m[0], []);
  byName.get(m[0]).push(si);
});
let nName = 0;
cues.forEach((c, ci) => {
  const low = c.t.toLowerCase();
  const ns = Object.keys(NAMES).filter(k => NAMES[k].some(v => low.includes(v)) && (freq.get(k) || 0) > 0 && (freq.get(k) || 0) <= NFREQ);
  if (ns.length !== 1) return;
  const hits = byName.get(ns[0]) || [];
  if (!hits.length) return;
  for (const si of hits) cand.push({ ci, si, kind: 'N' });
  nName++;
});
console.log('якорів за перекладом:', nTrans, '| реплік з однозначним ім\u02BCям:', nName,
  '| усього кандидатів:', cand.length);

// ── словник рівня слів, зібраний із твоїх готових пар (build-lex.js)
const LEX = JSON.parse(fs.readFileSync(WORK + '/lex.json', 'utf8'));
const STOP_EN = new Set('the a an and or but of to in on at is are was were be been it its this that for with you your i me my we our they he she his her him them do does did not no so if as from all what who how why when there here just now get got can could will would have has had am re ve ll'.split(' '));
const stemsEn = (s) => {
  const out = [];
  for (const w of String(s).replace(/\{[^{}]*\}/g, ' ').toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/)) {
    if (w.length < 3 || STOP_EN.has(w)) continue;
    const st = w.replace(/(ing|ed|es|s)$/, '').slice(0, 6);
    if (LEX[st]) out.push(LEX[st][0]);
  }
  return out;
};
const stemsUk = (s) => new Set(String(s).replace(/\{[^{}]*\}/g, ' ').toLowerCase()
  .replace(/[^а-яїієґ' ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3).map(w => w.slice(0, 5)));

// Оцінка пари: скільки англійських слів, для яких словник знає відповідник,
// справді присутні в українському тексті. Де словник мовчить — покладаємось
// на форму (довжина, переноси, розділові знаки).
function score(en, ukText, fe, fu) {
  const form = sim(fe, fu);
  const want = stemsEn(en);
  if (want.length < 2) return form;
  const have = stemsUk(ukText);
  let hit = 0;
  for (const w of want) if (have.has(w)) hit++;
  const lex = hit / want.length;
  return 0.6 * lex + 0.4 * form;
}

// Вирівнювання Нідлмана–Вунша з цією оцінкою.
function alignLex(se, cu, fe, fu) {
  const n = se.length, m = cu.length, G = -0.25, BASE = 0.42;
  const S = new Array(n);
  for (let i = 0; i < n; i++) {
    S[i] = new Float64Array(m);
    for (let j = 0; j < m; j++) S[i][j] = score(se[i], cu[j], fe[i], fu[j]) - BASE;
  }
  const D = [], P = [];
  for (let i = 0; i <= n; i++) { D.push(new Float64Array(m + 1)); P.push(new Int8Array(m + 1)); }
  for (let i = 1; i <= n; i++) { D[i][0] = D[i - 1][0] + G; P[i][0] = 1; }
  for (let j = 1; j <= m; j++) { D[0][j] = D[0][j - 1] + G; P[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const d = D[i - 1][j - 1] + S[i - 1][j - 1], u = D[i - 1][j] + G, l = D[i][j - 1] + G;
    if (d >= u && d >= l) { D[i][j] = d; P[i][j] = 0; }
    else if (u >= l) { D[i][j] = u; P[i][j] = 1; }
    else { D[i][j] = l; P[i][j] = 2; }
  }
  const out = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const p = i && j ? P[i][j] : (i ? 1 : 2);
    if (p === 0) { out.push([i - 1, j - 1, S[i - 1][j - 1] + BASE]); i--; j--; }
    else if (p === 1) i--;
    else j--;
  }
  return out.reverse();
}

// ── найдовший ланцюг, що зростає і за ci, і за si (≤1 якір на репліку)
cand.sort((a, b) => a.ci - b.ci || b.si - a.si);
function lis(a) {
  const tail = [], idx = [], prev = new Array(a.length).fill(-1);
  for (let i = 0; i < a.length; i++) {
    let lo = 0, hi = tail.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tail[m] < a[i].si) lo = m + 1; else hi = m; }
    tail[lo] = a[i].si; idx[lo] = i; prev[i] = lo > 0 ? idx[lo - 1] : -1;
  }
  const out = []; let k = idx[tail.length - 1];
  while (k >= 0) { out.push(a[k]); k = prev[k]; }
  return out.reverse();
}
const anchors = cand.length ? lis(cand) : [];
const kinds = anchors.reduce((m, a) => (m[a.kind] = (m[a.kind] || 0) + 1, m), {});
console.log('узгоджених за порядком якорів:', anchors.length, '(за перекладом', kinds.T || 0, ', за іменем', kinds.N || 0, ')');

// ── вирівнювання між якорями
const pairs = new Map();
const transCue = new Set(anchors.filter(a => a.kind === 'T').map(a => a.ci));
const segs = [];
let pc = 0, ps = 0;
for (const a of anchors.concat([{ ci: cues.length, si: says.length }])) {
  segs.push([pc, a.ci, ps, a.si, a]);
  pc = a.ci + 1; ps = a.si + 1;
}
for (const [c0, c1, s0, s1, a] of segs) {
  if (a.ci < cues.length) pairs.set(a.ci, a.si);
  if (c1 <= c0 || s1 <= s0) continue;
  if (c1 - c0 > GAP || s1 - s0 > GAP) continue;   // надто широкий проміжок — не вгадуємо
  const cu = cues.slice(c0, c1).map(x => x.t);
  const se = says.slice(s0, s1).map(x => x.text);
  const fe = se.map(x => feat(x, false)), fu = cu.map(x => feat(x, true));
  for (const [x, y, s] of alignLex(se, cu, fe, fu)) {
    if (s < SIM) continue;
    pairs.set(c0 + y, s0 + x);
  }
}
console.log('зіставлено реплік:', pairs.size, '(' + (100 * pairs.size / cues.length).toFixed(1) + '%)');

// ── КОНТРОЛЬ: рангова перевірка на вже перекладених рядках.
// Беремо рядок гри, який уже має твій переклад, і питаємо: чи саме та репліка,
// яку ми йому призначили, найбільш схожа на твій переклад серед сусідніх ±5?
// Випадково влучило б близько 9%. Якорі за ПЕРЕКЛАДОМ не рахуємо — вони й
// стали якорями через цей збіг, тож нічого не доводять. Якорі за іменами
// рахуємо: вони здобуті незалежно від глосарія.
let tot = 0, top1 = 0, top3 = 0;
for (const [ci, si] of pairs) {
  if (transCue.has(ci)) continue;
  const s = says[si];
  if (s.rows.length !== 1) continue;
  const en = s.rows[0].en;
  if (!translated.has(en)) continue;
  const mine = n2(glos[en]);
  if (mine.split(' ').length < 3) continue;
  const scores = [];
  for (let d = -5; d <= 5; d++) {
    const j = ci + d;
    if (j < 0 || j >= cues.length) continue;
    scores.push([d, jacc(mine, n2(cues[j].t))]);
  }
  scores.sort((x, y) => y[1] - x[1]);
  if (!scores.length || scores[0][1] === 0) continue;
  tot++;
  if (scores[0][0] === 0) top1++;
  if (scores.slice(0, 3).some(x => x[0] === 0)) top3++;
}
console.log('');
console.log('КОНТРОЛЬ (рангова перевірка, вікно ±5 реплік, без якорів за перекладом):');
console.log('   перевірок:', tot, '| наша репліка найсхожіша:', top1,
  '(' + (100 * top1 / Math.max(1, tot)).toFixed(1) + '%) | у трійці:', top3,
  '(' + (100 * top3 / Math.max(1, tot)).toFixed(1) + '%) | випадково було б ~9% / ~27%');

// ── нові пари (лише неперекладені рядки)
const anchorPos = anchors.map(a => a.ci).sort((a, b) => a - b);
const distA = (ci) => anchorPos.reduce((m, a) => Math.min(m, Math.abs(a - ci)), 1e9);
const uniq = new Map();
for (const [ci, si] of pairs) {
  const s = says[si];
  if (s.rows.length !== 1) continue;
  const en = s.rows[0].en;
  if (translated.has(en) || uniq.has(en)) continue;
  const d = distA(ci);
  uniq.set(en, {
    en, uk: cues[ci].t, src: cues[ci].f, file: s.rows[0].f, slot: s.rows[0].i, who: s.who,
    tier: d <= 10 ? 'A' : d <= 40 ? 'B' : 'C'
  });
}
const list = [...uniq.values()].sort((a, b) =>
  (a.tier + a.src + String(a.slot).padStart(5, '0')).localeCompare(b.tier + b.src + String(b.slot).padStart(5, '0')));
const cnt = { A: 0, B: 0, C: 0 };
for (const o of list) cnt[o.tier]++;
console.log('нових пар (рядок гри без перекладу):', list.length,
  '| поряд із якорем A:', cnt.A, '| середньо B:', cnt.B, '| далеко C:', cnt.C);

const short = (f) => f.replace(/^Kingdom Hearts - /, '').replace(/ UA\.srt$/, '');
const bySrc = new Map();
for (const o of list) {
  if (!bySrc.has(o.src)) bySrc.set(o.src, { A: 0, B: 0, C: 0 });
  bySrc.get(o.src)[o.tier]++;
}
console.log('');
console.log('по файлах субтитрів:');
for (const [f, c] of [...bySrc].sort()) {
  console.log('   ' + short(f).padEnd(42) + 'A ' + String(c.A).padStart(3) +
    '  B ' + String(c.B).padStart(3) + '  C ' + String(c.C).padStart(3));
}

const rep = ['# Субтитри → текст гри (на твою перевірку)', '',
  'Готові переклади НЕ чіпалися — нижче лише рядки гри, у яких перекладу ще немає.',
  'A = поряд із перевіреним якорем, B = середньо, C = далеко від якорів, дивитись уважно.', ''];
let cur = '';
for (const o of list) {
  const h = o.tier + '  ' + short(o.src);
  if (h !== cur) { rep.push('', '== ' + h + ' =='); cur = h; }
  rep.push('  [' + path.basename(o.file) + ' #' + o.slot + ']  ' + JSON.stringify(o.en));
  rep.push('        → ' + JSON.stringify(o.uk.replace(/\n/g, '{lf}')));
}
fs.writeFileSync(WORK + '/pairs2.json', JSON.stringify(list, null, 1), 'utf8');
fs.writeFileSync(WORK + '/subs-review.txt', rep.join('\n'), 'utf8');
console.log('');
console.log('файл на перевірку:', WORK + '/subs-review.txt');
