'use strict';

// Звірка JS-портів із еталонними Python-інструментами (DropDistanceHD/*/tools).
// Вектори у test/fixtures/*.json згенеровано самими .py-скриптами
// (scratch: dump_tables.py) — encode/decode мають збігатись байт-у-байт.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bbs = require('../tools/lib/bbs-codec');
const com = require('../tools/lib/recom-ctdl-codec');
const comFmt = require('../tools/lib/recom-ctdl-format');
const ddd = require('../tools/lib/ddd-ctd');
const ctdFmt = require('../tools/lib/ctd-format');

function checkByteCodec(name, codec, vectors) {
  for (const v of vectors) {
    if (v.text !== undefined) {
      if (v.error) { assert.throws(() => codec.encode(v.text), name + ' should reject ' + JSON.stringify(v.text)); continue; }
      assert.equal(codec.encode(v.text).toString('hex'), v.hex, name + ' encode ' + JSON.stringify(v.text));
    }
    assert.equal(codec.decode(Buffer.from(v.hex, 'hex')), v.decoded, name + ' decode ' + v.hex);
  }
}

test('bbs-codec matches bbstext.py vectors', () => {
  checkByteCodec('bbs', bbs, require('./fixtures/bbs-codec.json'));
});

test('bbs-codec: Cyrillic lives on katakana codes 0x83xx, strict on unknown chars', () => {
  const enc = bbs.encode('Цей світ');
  assert.equal(enc[0], 0x83);
  assert.equal(bbs.decode(enc), 'Цей світ');
  assert.throws(() => bbs.encode('a 😀 b'), /😀/);
  const r = bbs.encodeDetailed('a😀b', { lenient: true });
  assert.equal(r.bytes[1], 0x3F);
  assert.equal(r.unmapped.length, 1);
  // старий синтаксис застосунку / OpenKh — сирі байти
  assert.deepEqual([...bbs.encode('{0xF1,0xAE}{:unk 41}')], [0xF1, 0xAE, 0x41]);
});

test('bbs-codec: missingGlyphs flags codes absent from FontEn.arc', () => {
  assert.deepEqual(bbs.missingGlyphs(bbs.encode('Hello Світ')), []);
  assert.deepEqual(bbs.missingGlyphs(Buffer.from([0x89, 0x40])), ['8940']); // 院
});

test('ctd-format (BBS) matches bbsctd.write() on a reference doc', () => {
  const ref = require('./fixtures/bbs-ctd.json');
  const buf = Buffer.from(ref.hex, 'hex');
  const p = ctdFmt.parseCtd(buf);
  assert.deepEqual(p.messages.map(m => m.raw.toString('hex')), ref.messages);
  assert.deepEqual([...ctdFmt.composeCtd(p)], [...buf]);
});

test('recom-ctdl-codec matches comtext.py vectors', () => {
  checkByteCodec('recom', com, require('./fixtures/recom-codec.json'));
});

test('recom-ctdl-format matches comctd.write() (align4, textBase, tail)', () => {
  const ref = require('./fixtures/recom-ctdl.json');
  const buf = Buffer.from(ref.hex, 'hex');
  const p = comFmt.parseCtdl(buf);
  assert.equal(p.header.textBase, ref.textBase);
  assert.deepEqual(p.entries.map(e => e.originalBytes.toString('hex')), ref.messages);
  assert.deepEqual([...comFmt.composeCtdl(p)], [...buf]);
});

test('ddd-ctd codec matches khctd.py vectors', () => {
  for (const v of require('./fixtures/ddd-codec.json')) {
    if (v.error) { assert.throws(() => ddd.encodeCodes(v.text)); continue; }
    assert.deepEqual(ddd.encodeCodes(v.text), v.codes, v.text);
    assert.equal(ddd.decodeCodes(v.codes), v.decoded, v.text);
  }
  assert.throws(() => ddd.encodeCodes('emoji \u{1F600}'), /😀/);
});

test('ddd-ctd container matches khctd.write() incl. >64K page bits', () => {
  for (const name of ['ddd-ctd', 'ddd-ctd-big']) {
    const ref = require('./fixtures/' + name + '.json');
    const buf = Buffer.from(ref.hex, 'hex');
    const p = ddd.parseDddCtd(buf);
    assert.deepEqual([...ddd.composeDddCtd(p)], [...buf], name + ' identity');
    if (ref.last) assert.equal(p.entries[399].text, ref.last);
  }
  const ref = require('./fixtures/ddd-ctd.json');
  const p = ddd.parseDddCtd(Buffer.from(ref.hex, 'hex'));
  const g = ddd.composeDddCtd(p, new Map([[1, 'Гей! Так ти цього хотів?\nІ що тепер?']]));
  const p2 = ddd.parseDddCtd(g);
  assert.equal(p2.entries[1].text, 'Гей! Так ти цього хотів?\nІ що тепер?');
  assert.equal(p2.entries[0].text, 'Hey!');
  assert.equal(g.length % 16, 0);
  assert.deepEqual(ddd.missingGlyphs('Гей Hey', 'mesfont'), []);
});

test('bbs-codec: м’які заміни — апостроф U+02BC → ’, тире/мінус → -, NBSP → пробіл', () => {
  const same = (a, b) => assert.deepStrictEqual([...bbs.encode(a)], [...bbs.encode(b)]);
  same('обовʼязково', 'обов’язково');
  same('a – b − c d', 'a - b - c d');
  assert.throws(() => bbs.encode('☃'), /не вміє показати/);
});
