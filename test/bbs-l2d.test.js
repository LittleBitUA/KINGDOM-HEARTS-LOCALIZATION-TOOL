'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseL2d, rebuildL2d } = require('../tools/lib/bbs-l2d');
const { parseArc, buildArc } = require('../tools/lib/bbs-arc');

// синтетичний .l2d: зовнішній заголовок 0x40 + секція LY2@ (таблиця 2 елементів, пул, імена, хвіст)
function makeL2d(strings) {
  const tab = 0x40, n = strings.length, pool = tab + n * 16;
  const poolBuf = Buffer.concat(strings.map(s => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.alloc(1)])));
  const poolSize = (poolBuf.length + 15) & ~15;
  const next = pool + poolSize, names = Buffer.from('layout_a\0\0\0\0\0\0\0\0', 'latin1'), end = next + names.length;
  const ly = Buffer.alloc(end + 16);
  ly.write('LY2@0001', 0, 'ascii'); ly.writeUInt32LE(n, 0x28); ly.writeUInt32LE(tab, 0x2c); ly.writeUInt32LE(n, 0x30); ly.writeUInt32LE(pool, 0x34); ly.writeUInt32LE(next, 0x38); ly.writeUInt32LE(end, 0x3c);
  let off = 0; strings.forEach((s, i) => { ly.writeUInt32LE(off, tab + i * 16); ly.writeUInt32LE(0xff808080, tab + i * 16 + 4); off += s.length + 1; });
  poolBuf.copy(ly, pool); names.copy(ly, next);
  const head = Buffer.alloc(0x40); head.write('L2D@0001', 0, 'ascii'); head.writeUInt32LE(0x40, 0x28); head.writeUInt32LE(0x40 + ly.length, 0x2c);
  return Buffer.concat([head, ly]);
}

test('bbs-l2d: parse → рядки і зсуви; rebuild без змін — побайтово той самий', () => {
  const buf = makeL2d(['Continue', 'Resume', 'Skip Scene']);
  const p = parseL2d(buf);
  assert.deepEqual(p.entries.map(e => e.raw.toString('latin1')), ['Continue', 'Resume', 'Skip Scene']);
  assert.ok(rebuildL2d(buf, new Map([[1, Buffer.from('Resume')]])).equals(buf));
});

test('bbs-l2d: переклад лягає у наявний пул, довжина файла НЕ змінюється', () => {
  // Розкладку не можна збільшувати: у контейнері .arc за нею йдуть текстури,
  // і будь-який зсув ламає їх у грі. Тому пул перезбирається на місці.
  const buf = makeL2d(['Continue', 'Resume', 'Skip Scene']);
  const uk = Buffer.from('Skip', 'latin1');
  const out = rebuildL2d(buf, new Map([[2, uk]]));
  assert.equal(out.length, buf.length);
  const p = parseL2d(out);
  assert.equal(p.entries[0].raw.toString('latin1'), 'Continue');
  assert.equal(p.entries[1].raw.toString('latin1'), 'Resume');
  assert.ok(p.entries[2].raw.equals(uk));
  // секція імен розкладок лишилася на місці
  assert.equal(out.subarray(p.ly + p.next, p.ly + p.next + 8).toString('latin1'), 'layout_a');
  assert.equal(out.readUInt32LE(0x2c), buf.readUInt32LE(0x2c));
});

test('bbs-l2d: однакові переклади зберігаються один раз', () => {
  const buf = makeL2d(['Continue', 'Resume', 'Skip Scene']);
  const same = Buffer.from('Далі', 'latin1');
  const out = rebuildL2d(buf, new Map([[1, same], [2, same]]));
  const p = parseL2d(out);
  assert.equal(out.length, buf.length);
  assert.equal(p.entries[1].poolOffset, p.entries[2].poolOffset);
  assert.ok(p.entries[1].raw.equals(same));
});

test('bbs-l2d: якщо переклад не влазить — файл лишається недоторканим', () => {
  const buf = makeL2d(['Continue', 'Resume', 'Skip Scene']);
  const huge = Buffer.from('x'.repeat(200), 'latin1');
  const out = rebuildL2d(buf, new Map([[2, huge]]));
  assert.ok(out.equals(buf));
});

test('bbs-arc: buildArc — той самий файл без змін, підміна запису з вирівнюванням 16 і link-записами', () => {
  const entries = [{ name: 'a.bin', data: Buffer.from('hello') }, { name: 'CT.ctd', link: 0xd0000000 }, { name: 'b.l2d', data: Buffer.alloc(33, 7) }];
  const base = 0x10 + 0x20 * entries.length; const head = Buffer.alloc(base); head.writeUInt32LE(0x435241, 0); head.writeInt16LE(1, 4); head.writeInt16LE(entries.length, 6);
  const body = []; let size = 0;
  entries.forEach((e, i) => { const o = 0x10 + i * 0x20; Buffer.from(e.name).copy(head, o + 0x10); if (e.link) { head.writeUInt32LE(e.link, o); return; }
    const pad = (16 - (base + size) % 16) % 16; if (pad) { body.push(Buffer.alloc(pad)); size += pad; } head.writeInt32LE(base + size, o + 4); head.writeInt32LE(e.data.length, o + 8); body.push(e.data); size += e.data.length; });
  const pad = (16 - (base + size) % 16) % 16; if (pad) body.push(Buffer.alloc(pad));
  const arc = Buffer.concat([head, ...body]);
  assert.ok(buildArc(arc, new Map()).equals(arc));
  const out = buildArc(arc, new Map([['b.l2d', Buffer.alloc(50, 9)]]));
  const p = parseArc(out);
  assert.equal(p.entries[0].data.toString(), 'hello'); assert.ok(p.entries[1].link); assert.equal(p.entries[2].len, 50); assert.equal(p.entries[2].off % 16, 0); assert.equal(out.length % 16, 0);
});
