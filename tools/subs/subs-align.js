'use strict';
// Вирівнювання українських субтитрів (.srt) на англійський текст гри.
// Мови різні, тож звіряємось за тим, що переклад зберігає:
//   * кількість переносів рядка,  * знаки ? ! … , —,  * цифри,
//   * власні назви (латиниця → кирилиця транслітерацією),  * довжину.
// Далі — класичне вирівнювання послідовностей (Нідлман–Вунш) з пропусками.

const fs = require('fs');
const path = require('path');
const ROOT = 'E:/Localization/Kingdom Hearts Final Mix';
const { classifyFile } = require(ROOT + '/tools/lib/formats/classify.js');
const { parseFile } = require(ROOT + '/tools/lib/formats/index.js');

// ---------------------------------------------------------------- субтитри
function readSrt(file) {
  const t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const out = [];
  for (const block of t.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l, i) => !(i === 0 && /^\d+$/.test(l)) && !/-->/.test(l));
    const text = lines.join('\n').trim();
    if (text) out.push(text);
  }
  return out;
}

// ------------------------------------------------------------- ознаки рядка
const stripTok = (s) => s.replace(/\{[^{}]*\}/g, m => (/^\{lf\}$/.test(m) ? '\n' : ''));

// Латиниця → кирилиця (груба транслітерація власних назв).
const TR = [['sh', 'ш'], ['ch', 'ч'], ['th', 'т'], ['ph', 'ф'], ['ck', 'к'], ['ee', 'і'], ['oo', 'у'],
  ['ya', 'я'], ['yu', 'ю'], ['ye', 'є'], ['yi', 'ї'], ['j', 'дж'], ['x', 'кс'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'ґ'], ['h', 'х'],
  ['i', 'і'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'],
  ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['y', 'и'], ['z', 'з']];
function translit(w) {
  let s = w.toLowerCase(), out = '';
  outer: while (s.length) {
    for (const [a, b] of TR) if (s.startsWith(a)) { out += b; s = s.slice(a.length); continue outer; }
    s = s.slice(1);
  }
  return out;
}
// Схожість двох коротких слів (спільний префікс / відстань Левенштейна ≤2).
function near(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  let same = 0;
  while (same < n && a[same] === b[same]) same++;
  return same >= Math.max(3, Math.floor(Math.min(a.length, b.length) * 0.6));
}

function feat(text, isUk) {
  const t = stripTok(text);
  const bare = t.replace(/\s+/g, ' ').trim();
  const words = (isUk ? bare.match(/[А-ЯЇІЄҐ][а-яїієґ']{2,}/g) : bare.match(/\b[A-Z][a-z]{2,}\b/g)) || [];
  return {
    len: bare.replace(/\s/g, '').length,
    breaks: (t.match(/\n/g) || []).length,
    q: (bare.match(/\?/g) || []).length,
    ex: (bare.match(/!/g) || []).length,
    dots: (bare.match(/…|\.\.\./g) || []).length,
    comma: (bare.match(/,/g) || []).length,
    digits: (bare.match(/\d/g) || []).join(''),
    names: words.map(w => isUk ? w.toLowerCase() : translit(w))
  };
}

// Схожість 0..1
function sim(a, b) {
  let s = 0, w = 0;
  const add = (v, weight) => { s += v * weight; w += weight; };
  add(a.breaks === b.breaks ? 1 : Math.max(0, 1 - Math.abs(a.breaks - b.breaks) * 0.6), 2);
  add(a.q === b.q ? 1 : 0.2, 1.5);
  add(a.ex === b.ex ? 1 : 0.3, 1);
  add(a.dots === b.dots ? 1 : 0.4, 1);
  add(Math.max(0, 1 - Math.abs(a.comma - b.comma) * 0.4), 0.7);
  add(a.digits === b.digits ? 1 : 0, a.digits || b.digits ? 1.5 : 0.01);
  const r = b.len && a.len ? b.len / a.len : 0;
  add(Math.exp(-Math.pow((r - 1.12) / 0.45, 2)), 2.5);
  // власні назви
  let hit = 0;
  for (const x of a.names) if (b.names.some(y => near(x, y))) hit++;
  const nmax = Math.max(a.names.length, b.names.length);
  add(nmax ? hit / nmax : 0.5, nmax ? 2.5 : 0.2);
  return s / w;
}

// ------------------------------------------------------- вирівнювання (NW)
const GAP = -0.45;
// semiGlobal: пропуски на початку і в кінці англійської послідовності безкоштовні —
// так сцена знаходиться всередині великого файла.
function align(en, uk, semiGlobal) {
  const fe = en.map(x => feat(x, false));
  const fu = uk.map(x => feat(x, true));
  const n = en.length, m = uk.length;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const P = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { D[i][0] = semiGlobal ? 0 : D[i - 1][0] + GAP; P[i][0] = 1; }
  for (let j = 1; j <= m; j++) { D[0][j] = D[0][j - 1] + GAP; P[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = D[i - 1][j - 1] + (sim(fe[i - 1], fu[j - 1]) - 0.42);
      const up = D[i - 1][j] + GAP;
      const left = D[i][j - 1] + GAP;
      let best = diag, p = 0;
      if (up > best) { best = up; p = 1; }
      if (left > best) { best = left; p = 2; }
      D[i][j] = best; P[i][j] = p;
    }
  }
  const pairs = [];
  let i = n, j = m;
  if (semiGlobal) { let best = -1e9; for (let k = 0; k <= n; k++) if (D[k][m] >= best) { best = D[k][m]; i = k; } }
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && P[i][j] === 0) { pairs.push([i - 1, j - 1, sim(fe[i - 1], fu[j - 1])]); i--; j--; }
    else if (i > 0 && (j === 0 || P[i][j] === 1)) { pairs.push([i - 1, -1, 0]); i--; }
    else { pairs.push([-1, j - 1, 0]); j--; }
  }
  pairs.reverse();
  const end = semiGlobal ? i : n;
  void end;
  return { pairs, score: D[i][m] / Math.max(1, m) };
}

module.exports = { readSrt, align, feat, sim };

// ------------------------------------------------------------------- CLI
if (require.main === module) {
  (async () => {
    const srt = process.argv[2];
    const game = process.argv[3];
    const from = Number(process.argv[4] || 0);
    const uk = readSrt(srt);
    const p = await parseFile(game, { cls: classifyFile(game, path.extname(game).toLowerCase()) });
    const en = p.slots.slice(from, from + Math.round(uk.length * 1.6)).map(s => s.english);
    const r = align(en, uk);
    let matched = 0, sum = 0;
    for (const [a, b, s] of r.pairs) if (a >= 0 && b >= 0) { matched++; sum += s; }
    console.log('субтитрів', uk.length, '| рядків гри', en.length, '| зіставлено', matched, '| середня схожість', (sum / matched).toFixed(3));
    console.log('');
    for (const [a, b, s] of r.pairs.slice(0, Number(process.argv[5] || 30))) {
      const mark = a >= 0 && b >= 0 ? (s > 0.75 ? '  ' : s > 0.6 ? ' ?' : ' ??') : ' ✗';
      console.log(mark, (a >= 0 ? '#' + (from + a) : '—').padStart(6), JSON.stringify((a >= 0 ? en[a] : '').slice(0, 58)).padEnd(62),
        (b >= 0 ? '→ ' + JSON.stringify(uk[b].replace(/\n/g, ' ⏎ ').slice(0, 58)) : '→ —'));
    }
  })();
}
