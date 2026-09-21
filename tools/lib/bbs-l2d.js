'use strict';

// BBS .l2d (Layout 2D, 'L2D@0001') — розкладки меню з ВБУДОВАНИМ текстом (пауза
// Continue/Resume/Skip Scene, camp Command Decks/Items/…, вибір режиму гри тощо).
// Текст лежить у секції 'LY2@' (завжди остання у файлі):
//   LY2@ +0x28: n текстових елементів, +0x2c: зсув таблиці елементів (16 B кожен:
//   u32 зсув рядка у пулі, RGBA, прапорці), +0x34: зсув пулу рядків (NUL-terminated,
//   кодування гри — cp932 + кирилиця на 0x83xx, як у .ctd), +0x38: наступна секція
//   (імена розкладок), +0x3c: кінець даних LY2@ (далі — хвіст-вирівнювання).
//   Зовнішній заголовок: +0x28 зсув LY2@, +0x2c повна довжина файла.
// Змінені рядки дописуються в кінець пулу, секції після нього зсуваються на дельту
// (вирівняну до 16), правляться обидва заголовки; без змін файл лишається побайтово.

const MAGIC_L2D = Buffer.from('L2D@');
const MAGIC_LY2 = Buffer.from('LY2@');

function parseL2d(buf) {
  if (buf.length < 0x40 || !buf.subarray(0, 4).equals(MAGIC_L2D)) throw new Error('not an L2D@ file');
  const ly = buf.readUInt32LE(0x28);
  if (ly + 0x40 > buf.length || !buf.subarray(ly, ly + 4).equals(MAGIC_LY2)) throw new Error('LY2@ section not found');
  const h = (o) => buf.readUInt32LE(ly + o);
  const n = h(0x28), tab = h(0x2c), pool = h(0x34), next = h(0x38), end = h(0x3c);
  const poolBuf = buf.subarray(ly + pool, ly + next);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const off = buf.readUInt32LE(ly + tab + i * 16);
    let e = poolBuf.indexOf(0, off); if (e < 0) e = poolBuf.length;
    entries.push({ index: i, poolOffset: off, raw: poolBuf.subarray(off, e) });
  }
  return { ly, n, tab, pool, next, end, entries };
}

// rebuildL2d(buf, rawByIndex: Map<index, Buffer>) → новий буфер. Незмінені рядки лишаються на
// своїх зсувах (пул може містити нереференсовані/дублетні байти — не чіпаємо), змінені
// дописуються в кінець пулу (однакові — один зсув); секції після пулу зсуваються на дельту.
function rebuildL2d(buf, rawByIndex) {
  const p = parseL2d(buf);
  const changed = p.entries.filter((e) => rawByIndex.has(e.index) && !rawByIndex.get(e.index).equals(e.raw));
  if (!changed.length) return Buffer.from(buf);
  const ly = p.ly;
  const oldPool = p.next - p.pool;
  // хвостові нулі старого пулу — вирівнювання, їх можна перевикористати
  let used = oldPool; while (used > 0 && buf[ly + p.pool + used - 1] === 0) used--;
  used = Math.min(oldPool, used + 1);                                   // один NUL після останнього рядка
  const parts = [buf.subarray(ly + p.pool, ly + p.pool + used)]; let size = used;
  const offOf = new Map(); const offsets = new Map();
  for (const e of changed) {
    const raw = rawByIndex.get(e.index); const key = raw.toString('hex');
    if (!offOf.has(key)) { offOf.set(key, size); parts.push(raw, Buffer.alloc(1)); size += raw.length + 1; }
    offsets.set(e.index, offOf.get(key));
  }
  const newPool = Math.max(oldPool, (size + 15) & ~15);
  const delta = newPool - oldPool;
  const out = Buffer.alloc(buf.length + delta);
  buf.copy(out, 0, 0, ly + p.pool);
  Buffer.concat(parts).copy(out, ly + p.pool);
  buf.copy(out, ly + p.next + delta, ly + p.next);
  for (const [i, off] of offsets) out.writeUInt32LE(off, ly + p.tab + i * 16);
  out.writeUInt32LE(p.next + delta, ly + 0x38);
  out.writeUInt32LE(p.end + delta, ly + 0x3c);
  out.writeUInt32LE(buf.length + delta, 0x2c);
  return out;
}

module.exports = { parseL2d, rebuildL2d };
