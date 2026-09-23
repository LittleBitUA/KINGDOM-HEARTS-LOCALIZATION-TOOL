'use strict';
// Шукає в .text інструкції, що беруть адресу заданого глобала:
//   lea r64, [rip+disp32]   — 48/4C 8D /r, mod=00 rm=101
//   mov r64, [rip+disp32]   — 48/4C 8B /r, mod=00 rm=101
// Це надійніше за Ghidra, коли проєкт зібрано з іншої збірки exe.
const fs = require('fs');

const EXE = process.argv[2];
const targets = process.argv.slice(3).map(x => Number(BigInt(x)));
const b = fs.readFileSync(EXE);
const peOff = b.readUInt32LE(0x3c);
const nSec = b.readUInt16LE(peOff + 6);
const optSize = b.readUInt16LE(peOff + 20);
const imgBase = Number(b.readBigUInt64LE(peOff + 24 + 24));
const secs = [];
for (let i = 0; i < nSec; i++) {
  const o = peOff + 24 + optSize + i * 40;
  secs.push({
    name: b.slice(o, o + 8).toString().replace(/\0+$/, ''),
    va: b.readUInt32LE(o + 12), rsize: b.readUInt32LE(o + 16), raw: b.readUInt32LE(o + 20)
  });
}
const text = secs.find(s => s.name === '.text');
const f2v = (f) => { for (const s of secs) if (f >= s.raw && f < s.raw + s.rsize) return imgBase + s.va + (f - s.raw); return null; };

const near = (v) => targets.some(t => v >= t - 0x80 && v <= t + 0x200);
const found = [];
const end = text.raw + text.rsize;
for (let f = text.raw; f + 7 <= end; f++) {
  const b0 = b[f];
  if (b0 !== 0x48 && b0 !== 0x4C) continue;
  const b1 = b[f + 1];
  if (b1 !== 0x8D && b1 !== 0x8B) continue;
  const modrm = b[f + 2];
  if ((modrm & 0xC7) !== 0x05) continue;
  const disp = b.readInt32LE(f + 3);
  const va = f2v(f + 7) + disp;
  if (!near(va)) continue;
  found.push({ at: f2v(f), kind: b1 === 0x8D ? 'lea' : 'mov', target: va });
}
console.log('інструкцій, що беруть адресу:', found.length);
for (const x of found.slice(0, 40)) {
  console.log('   0x' + x.at.toString(16) + '  ' + x.kind + ' → 0x' + x.target.toString(16) +
    (targets.includes(x.target) ? '   (точний збіг)' : ''));
}
