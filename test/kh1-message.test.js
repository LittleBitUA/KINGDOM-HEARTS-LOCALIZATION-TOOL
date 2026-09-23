'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { cmdLen, splitSlots, walkFits } = require('../shared/kh1-message');
const codec = require('../shared/codec');
const { extract } = require('../tools/lib/extract');
const { buildBinl } = require('./helpers/synth');

test('kh1-message: довжини команд збігаються з рендерером гри (FUN_140171e80)', () => {
  assert.equal(cmdLen(0x00, 0), 1);
  assert.equal(cmdLen(0x04, 0), 1);          // кінець сторінки
  assert.equal(cmdLen(0x05, 0x54), 3);       // {wait} — u16 завжди 3 байти
  assert.equal(cmdLen(0x07, 0x0C), 3);
  assert.equal(cmdLen(0x09, 0xC8), 2);       // іконка кнопки
  assert.equal(cmdLen(0x0A, 0x00), 4);       // міжрядковий інтервал
  assert.equal(cmdLen(0x0A, 0x02), 2);
  assert.equal(cmdLen(0x0B, 0x00), 4);       // зсув X
  assert.equal(cmdLen(0x0B, 0x01), 4);
  assert.equal(cmdLen(0x0B, 0x10), 4);
  assert.equal(cmdLen(0x0B, 0x20), 2);
  assert.equal(cmdLen(0x0D, 0x01), 4);
  assert.equal(cmdLen(0x14, 0), 1);          // 0x13…0x17 — не в switch, default +1
  assert.equal(cmdLen(0x19, 0x40), 2);       // двобайтовий гліф
  assert.equal(cmdLen(0x41, 0), 1);
});

test('kh1-message: 0x00 усередині команди не ріже повідомлення', () => {
  // {line_spacing 0,0}{yshift 12}Hi{wait 84} | {text_dx 4}Bye
  const buf = Buffer.from([
    0x0A, 0x00, 0x00, 0x00, 0x07, 0x0C, 0x00, 0x48, 0x49, 0x05, 0x54, 0x00, 0x00,
    0x0B, 0x00, 0x04, 0x00, 0x42, 0x59, 0x00
  ]);
  assert.ok(walkFits(buf, 0, buf.length));
  const slots = splitSlots(buf, 0, buf.length);
  // Наївний поділ по 0x00 дав би 8 «рядків» замість двох повідомлень.
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map(s => [s.start, s.end, s.term]), [[0, 12, 0], [13, 19, 0]]);
});

test('kh1-message: 0x04 відкриває нову сторінку всередині повідомлення', () => {
  const buf = Buffer.from([0x48, 0x49, 0x04, 0x42, 0x59, 0x00]);
  assert.deepEqual(splitSlots(buf, 0, buf.length).map(s => s.term), [0x04, 0x00]);
});

test('kh1-message: слот глосарія — сторінка без службової обгортки', () => {
  const eng = buildBinl(['{0x0A,0x00,0x00,0x00}{0x07,0x0C,0x00}Wake up!{0x05,0x54,0x00}']);
  const r = extract(eng, Buffer.alloc(0), { header: 11, footer: 5 });
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].english, 'Wake up!');
  assert.equal(r.slots[0].prefix, '{line_spacing 0,0}{yshift 12}');
  assert.equal(r.slots[0].suffix, '{wait 84}');
  // Обгортка + тіло = рівно ті самі байти, що були у файлі.
  const back = codec.encode(r.slots[0].prefix + r.slots[0].english + r.slots[0].suffix);
  assert.deepEqual([...back], [...eng.subarray(r.slots[0].offset, r.slots[0].offset + r.slots[0].byteLen)]);
});
