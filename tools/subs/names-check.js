'use strict';
const WORK = require('path').join(__dirname, 'work');
// Незалежна перевірка якості пар: якщо в англійському рядку рівно одне відоме
// ім'я, воно має бути і в українському. Якщо там натомість стоїть ІНШЕ ім'я —
// пара точно хибна. Цей вимір не потребує готових перекладів, тож працює й
// там, де якорів немає.
const fs = require('fs');

const NAMES = {
  Sora: ['сор'], Riku: ['рік', 'ріку'], Kairi: ['кайр'], Donald: ['дональд'], Goofy: ['гуф', 'ґуф'],
  Pinocchio: ['пінок'], Geppetto: ['джепет', 'жепет'], Monstro: ['монстро'],
  Ariel: ['аріел'], Sebastian: ['себастьян'], Ursula: ['урсул'], Triton: ['тритон'], Flounder: ['флаундер', 'камбал'],
  Jack: ['джек'], Sally: ['саллі', 'салі'], Oogie: ['угі', 'оґі', 'огі'],
  Alice: ['аліс'], Cheshire: ['чешир'], Tarzan: ['тарзан'], Jane: ['джейн'], Clayton: ['клейтон'], Kerchak: ['керчак'],
  Aladdin: ['аладдін', 'аладін'], Jasmine: ['жасмін'], Jafar: ['джафар'], Genie: ['джин'], Abu: ['абу'], Iago: ['яго'],
  Peter: ['пітер'], Wendy: ['венді'], Hook: ['гук', 'крюк', 'гак'], Smee: ['смі'],
  Hercules: ['геркулес'], Phil: ['філ'], Cloud: ['клауд'], Hades: ['аїд', 'гадес'],
  Leon: ['леон'], Yuffie: ['юффі', 'юфі'], Aerith: ['аеріт'], Cid: ['сід'], Merlin: ['мерлін'],
  Maleficent: ['малефісент'], Ansem: ['ансем'], Beast: ['звір', 'чудовис'],
  Pooh: ["пух"], Piglet: ["порос", "ятачок"], Tigger: ["тигр"],
  Selphie: ['селфі'], Wakka: ['вакка', 'вака'], Tidus: ['тайдус', 'тідус'], Minnie: ['мінні'], Keyblade: ['ключ-меч', 'ключ меч']
};

const plain = (s) => String(s).replace(/\{[^{}]*\}/g, ' ');
const list = JSON.parse(fs.readFileSync(WORK + '/pairs2.json', 'utf8'));

const res = { A: { n: 0, ok: 0, bad: 0 }, B: { n: 0, ok: 0, bad: 0 }, C: { n: 0, ok: 0, bad: 0 } };
const bad = [];
for (const p of list) {
  const en = plain(p.en);
  const found = Object.keys(NAMES).filter(k => new RegExp('\\b' + k + '\\b', 'i').test(en));
  if (found.length !== 1) continue;
  const uklc = plain(p.uk).toLowerCase();
  const mine = NAMES[found[0]].some(v => uklc.includes(v));
  // чи стоїть натомість чуже ім'я?
  const other = Object.keys(NAMES).filter(k => k !== found[0] && NAMES[k].some(v => uklc.includes(v)));
  const r = res[p.tier];
  r.n++;
  if (mine) r.ok++;
  else if (other.length) { r.bad++; if (bad.length < 5) bad.push([p.tier, found[0], other[0], p.en, p.uk]); }
}
console.log("перевірка за іменами (лише рядки, де рівно одне відоме ім'я):");
for (const t of ['A', 'B', 'C']) {
  const r = res[t];
  const rest = r.n - r.ok - r.bad;
  console.log('   ' + t + ': перевірено ' + String(r.n).padStart(3) +
    " | ім'я на місці " + String(r.ok).padStart(3) +
    ' (' + (100 * r.ok / Math.max(1, r.n)).toFixed(0) + '%)' +
    " | стоїть ЧУЖЕ ім'я " + String(r.bad).padStart(3) +
    ' (' + (100 * r.bad / Math.max(1, r.n)).toFixed(0) + '%)' +
    ' | імені немає взагалі ' + String(rest).padStart(3));
}
console.log('');
console.log('приклади явно хибних пар:');
for (const [t, want, got, en, uk] of bad) {
  console.log('  ' + t + '  очікував ' + want + ', а в перекладі ' + got);
  console.log('      EN ' + JSON.stringify(plain(en).replace(/\s+/g, ' ').slice(0, 60)));
  console.log('      UA ' + JSON.stringify(plain(uk).replace(/\s+/g, ' ').slice(0, 60)));
}
