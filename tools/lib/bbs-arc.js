'use strict';

// BBS (PC HD) .arc-контейнер — той самий формат, що читає tools/py/bbs/arc.py:
//   0x00 'ARC' (24 біти) | 0x04 version i16, count i16 | 0x08 u8 i32, uc i32
//   0x10 + i*0x20: dirhash u32, off i32, len i32, unused u32, name[16]
// dirhash != 0 — посилання (link) без власних даних.

const fs = require('fs');
const path = require('path');

function parseArc(buf) {
  if (buf.length < 0x10 || (buf.readUInt32LE(0) & 0xFFFFFF) !== 0x435241) {
    throw new Error('not an ARC container');
  }
  const version = buf.readInt16LE(4);
  const count = buf.readInt16LE(6);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = 0x10 + i * 0x20;
    if (o + 0x20 > buf.length) break;
    const dirhash = buf.readUInt32LE(o);
    const off = buf.readInt32LE(o + 4);
    const len = buf.readInt32LE(o + 8);
    const raw = buf.subarray(o + 0x10, o + 0x20);
    const nul = raw.indexOf(0);
    const name = raw.subarray(0, nul < 0 ? 16 : nul).toString('utf8');
    entries.push({ i, dirhash, off, len, name, link: dirhash !== 0,
      data: dirhash === 0 && off >= 0 && len >= 0 && off + len <= buf.length ? buf.subarray(off, off + len) : null });
  }
  return { version, count, entries };
}

// Розпакувати .arc у теку (лише записи з даними). Повертає список імен.
function unpackArc(arcPath, outDir) {
  const arc = parseArc(fs.readFileSync(arcPath));
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const e of arc.entries) {
    if (!e.data || !e.name || /[\\/]/.test(e.name)) continue;
    fs.writeFileSync(path.join(outDir, e.name), e.data);
    written.push(e.name);
  }
  return written;
}

module.exports = { parseArc, unpackArc };
