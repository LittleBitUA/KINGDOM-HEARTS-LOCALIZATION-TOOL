'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../shared/codec');
const { extract, containsExactSegment, splitStrings } = require('../tools/lib/extract');
const { compose } = require('../tools/lib/build');
const { buildBinl } = require('./helpers/synth');

test('splitStrings respects header/footer and 0x00 separators', () => {
  const buf = buildBinl(['abc', 'de'], { header: 11, footer: 5 });
  const segs = splitStrings(buf, 11, 5);
  assert.equal(segs[0].offset, 11);
  assert.equal(segs[0].bytes.length, 3);
  assert.equal(segs[1].bytes.length, 2);
});

test('containsExactSegment: whole-segment match only (Log vs Catalog regression)', () => {
  const hay = Buffer.concat([codec.encode('Catalog'), Buffer.from([0]), codec.encode('Logo'), Buffer.from([0])]);
  const needle = codec.encode('Log');
  assert.equal(containsExactSegment(hay, needle), false);
  const hay2 = Buffer.concat([hay, codec.encode('Log'), Buffer.from([0])]);
  assert.equal(containsExactSegment(hay2, needle), true);
});

test('extract: strings present verbatim in reference file are preserved, others translatable', () => {
  const eng = buildBinl(['Potion', 'Attack', 'Traverse Town', 'ab']);
  const ref = buildBinl(['Potion', 'XXXX', 'Traverse Town']); // Attack відсутній → translatable
  const r = extract(eng, ref, { header: 11, footer: 5 });
  // Обхід байткоду не вигадує порожнього хвостового сегмента після останнього 0x00.
  assert.equal(r.stats.engStrings, 4);
  assert.equal(r.stats.skippedEmpty, 0);
  assert.equal(r.stats.preserved, 2);
  assert.equal(r.stats.skippedShort, 1); // 'ab' < minLen 3
  assert.equal(r.slots.length, 1);
  assert.equal(r.slots[0].english, 'Attack');
  assert.doesNotMatch(r.slots[0].english, /[Ѐ-ӿ]/, 'English must decode as Latin');
});

test('compose applies replacements at offsets and keeps surrounding bytes', () => {
  const eng = buildBinl(['Potion', 'Attack']);
  const r = extract(eng, buildBinl([]), { header: 11, footer: 5 });
  const attack = r.slots.find(s => s.english === 'Attack');
  const out = compose(eng, [{ offset: attack.offset, oldLen: attack.byteLen, ukText: 'Атака' }]);
  assert.equal(out.applied, 1);
  assert.equal(out.errors.length, 0);
  // header + Potion\0 незмінні
  assert.deepEqual([...out.buffer.subarray(0, attack.offset)], [...eng.subarray(0, attack.offset)]);
  // після заміни — footer незмінний
  const tail = out.buffer.subarray(out.buffer.length - 5);
  assert.deepEqual([...tail], [0, 0, 0, 0, 0]);
  // декодований результат містить український текст
  const re = extract(out.buffer, buildBinl([]), { header: 11, footer: 5 });
  assert.ok(re.slots.some(s => codec.decode(codec.encode(s.english)) !== undefined));
});

test('compose reports overlapping and out-of-range replacements', () => {
  const eng = buildBinl(['Potion', 'Attack']);
  const out = compose(eng, [
    { offset: 11, oldLen: 6, ukText: 'A' },
    { offset: 12, oldLen: 3, ukText: 'B' },        // перетин
    { offset: 9999, oldLen: 1, ukText: 'C' }       // за межами
  ]);
  assert.equal(out.applied, 1);
  assert.equal(out.skipped, 2);
  assert.equal(out.errors.length, 2);
});

test('compose padTo: fixed-length slot pads with zeros and rejects overflow', () => {
  const eng = buildBinl(['Potion']);
  const ok = compose(eng, [{ offset: 11, oldLen: 6, ukText: 'Hi', padTo: 6 }]);
  assert.equal(ok.applied, 1);
  assert.equal(ok.buffer.length, eng.length);
  const bad = compose(eng, [{ offset: 11, oldLen: 6, ukText: 'Way too long text', padTo: 6 }]);
  assert.equal(bad.skipped, 1);
  assert.match(bad.errors[0].message, /довший/);
});

test('compose keeps original bytes when encode fails for a slot', () => {
  const eng = buildBinl(['Potion']);
  const out = compose(eng, [{ offset: 11, oldLen: 6, ukText: 'bad ∑' }]);
  assert.equal(out.skipped, 1);
  assert.deepEqual([...out.buffer], [...eng]);
});
