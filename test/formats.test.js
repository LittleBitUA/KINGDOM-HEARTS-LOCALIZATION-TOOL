'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../shared/codec');
const mesOfs = require('../tools/lib/mes-ofs');
const ev = require('../tools/lib/ev-format');
const ctdFmt = require('../tools/lib/ctd-format');
const ctdlFmt = require('../tools/lib/recom-ctdl-format');
const { buildMesOfs, buildEv, buildCtd, buildCtdl } = require('./helpers/synth');

// ======================= mes_ofs =======================

test('mes-ofs: parse unique strings, linked pointers and cell lengths', () => {
  const { ofs, data } = buildMesOfs(['Potion', 'Ether', 'Elixir'], [0, 1, 1, 2], { pad: 4 });
  const p = mesOfs.parsePair(ofs, data, codec);
  assert.equal(p.pointerCount, 4);
  assert.equal(p.uniqueStrings, 3);
  assert.equal(p.ofsPadding, 4);
  assert.equal(p.dataPadding, 4);
  // mes-ofs/ev включають термінатор у текст слота як {eol} (на відміну від binl).
  assert.equal(p.slots[1].english, 'Ether{eol}');
  assert.equal(p.slots[2].english, 'Ether{eol}');
  assert.equal(p.slots[1].offset, p.slots[2].offset);
  assert.doesNotMatch(p.slots[0].english, /[Ѐ-ӿ]/);
});

test('mes-ofs: identity compose is byte-identical (cell-preserving)', () => {
  const { ofs, data } = buildMesOfs(['Potion', 'Ether', 'Elixir'], [0, 1, 1, 2], { pad: 4 });
  const p = mesOfs.parsePair(ofs, data, codec);
  const c = mesOfs.composePair(p.slots, { ofsLength: ofs.length, dataLength: data.length, cellLengthByOffset: p.cellLengthByOffset }, codec);
  assert.equal(c.layout, 'cell-preserving');
  assert.deepEqual([...c.ofsBuf], [...ofs]);
  assert.deepEqual([...c.dataBuf], [...data]);
});

test('mes-ofs: shorter translation stays cell-preserving; longer falls back to compact', () => {
  const { ofs, data } = buildMesOfs(['Potion', 'Ether'], [0, 1], { pad: 32 });
  const p = mesOfs.parsePair(ofs, data, codec);
  const short = p.slots.map(s => Object.assign({}, s, { ukText: s.english === 'Ether{eol}' ? 'Ет{eol}' : '' }));
  const c1 = mesOfs.composePair(short, { ofsLength: ofs.length, dataLength: data.length, cellLengthByOffset: p.cellLengthByOffset }, codec);
  assert.equal(c1.layout, 'cell-preserving');
  assert.deepEqual([...c1.ofsBuf], [...ofs]);
  const long = p.slots.map(s => Object.assign({}, s, { ukText: s.english === 'Potion{eol}' ? 'Дуже довге зілля{eol}' : '' }));
  const c2 = mesOfs.composePair(long, { ofsLength: ofs.length, dataLength: data.length, cellLengthByOffset: p.cellLengthByOffset }, codec);
  assert.equal(c2.layout, 'compact');
  assert.ok(c2.dataBuf.length >= data.length && c2.dataBuf.length % 16 === 0, 'compact data grows 16-aligned: ' + c2.dataBuf.length);
  const re = mesOfs.parsePair(c2.ofsBuf, c2.dataBuf, codec);
  assert.equal(re.slots[1].english, 'Ether{eol}');
  assert.deepEqual([...codec.encode(re.slots[0].english)], [...codec.encode('Дуже довге зілля{eol}')]);
});

test('mes-ofs: data may grow beyond the original size (16-byte aligned), only 16-bit pointers are the limit', () => {
  const { ofs, data } = buildMesOfs(['Potion'], [0], { pad: 0 });
  const p = mesOfs.parsePair(ofs, data, codec);
  // у самій грі FR/GR/IT/SP gumi_mes_data більші за UK при тому самому .ofs
  const long = p.slots.map(s => Object.assign({}, s, { ukText: 'x'.repeat(200) }));
  const c = mesOfs.composePair(long, { ofsLength: ofs.length, dataLength: data.length, cellLengthByOffset: p.cellLengthByOffset }, codec);
  assert.ok(c.dataBuf.length >= 201 && c.dataBuf.length % 16 === 0, 'grown and aligned: ' + c.dataBuf.length);
  assert.equal(c.ofsBuf.length, ofs.length);
  assert.equal(mesOfs.parsePair(c.ofsBuf, c.dataBuf, codec).slots[0].english, 'x'.repeat(200) + '{eol}');
  const huge = p.slots.map(s => Object.assign({}, s, { ukText: 'x'.repeat(70000) }));
  assert.throws(() => mesOfs.composePair(huge, { ofsLength: ofs.length, dataLength: data.length, cellLengthByOffset: p.cellLengthByOffset }, codec), /65535/);
});

test('mes-ofs: name helpers', () => {
  assert.equal(mesOfs.isMesOfsName('gummi_mes_ofs.bin'), true);
  assert.equal(mesOfs.isMesOfsName('gummi_mes_data.bin'), false);
  assert.equal(mesOfs.pairedDataName('gummi_mes_ofs.bin'), 'gummi_mes_data.bin');
});

// ======================= .ev =======================

test('ev: parse finds text block, footer and translatable slots', () => {
  const { buf, textOffset, footerOffset } = buildEv(['Hello there', 'Bye']);
  const p = ev.parseEv(buf, codec);
  assert.equal(p.textOffset, textOffset);
  assert.equal(p.footerOffset, footerOffset);
  const tr = p.slots.filter(s => s.translatable);
  assert.deepEqual(tr.map(s => s.english), ['Hello there{eol}', 'Bye{eol}']);
});

test('ev: identity compose (compact) is byte-identical', () => {
  const { buf } = buildEv(['Hello there', 'Bye']);
  const p = ev.parseEv(buf, codec);
  const c = ev.composeEv(buf, p.slots.map(s => ({ offset: s.offset, english: s.english, ukText: '' })), codec);
  assert.deepEqual([...c.buf], [...buf]);
  assert.equal(c.sizeDiff, 0);
});

test('ev: growing text relocates footer pointers by sizeDiff and keeps footer bytes', () => {
  const { buf, footerOffset } = buildEv(['Hi', 'Bye']);
  const p = ev.parseEv(buf, codec);
  const slots = p.slots.map(s => ({ offset: s.offset, english: s.english, ukText: s.english === 'Hi{eol}' ? 'Привіт усім{eol}' : '' }));
  const c = ev.composeEv(buf, slots, codec);
  assert.ok(c.sizeDiff > 0);
  assert.equal(c.relocCount, 2);
  assert.equal(c.buf.readUInt32LE(16), footerOffset + c.sizeDiff);
  assert.deepEqual([...c.buf.subarray(c.buf.length - 8)], [...buf.subarray(buf.length - 8)]);
  // Усі оригінальні ENG/RUS .ev/.evdl мають текстову секцію кратну 16.
  assert.equal(c.newTextLength % 16, 0);
});

test('ev: cell-preserving mode never changes size and falls back to EN on overflow', () => {
  const { buf } = buildEv(['Hi', 'Bye']);
  const p = ev.parseEv(buf, codec);
  const slots = p.slots.map(s => ({ offset: s.offset, english: s.english, ukText: s.english === 'Hi{eol}' ? 'Привіт усім{eol}' : '' }));
  const c = ev.composeEv(buf, slots, codec, { cellPreserving: true });
  assert.equal(c.buf.length, buf.length);
  assert.equal(c.overflowCount, 1);
});

// ======================= BBS .ctd =======================

// BBS/CoM/DDD codec-и звіряються з еталонними Python-інструментами у
// test/codecs-reference.test.js; тут — лише поведінка контейнерів.

test('ctd-format: identity round-trip is byte-identical', () => {
  const buf = buildCtd([{ id: 10, text: 'Hello' }, { id: 11, text: 'World\nTwo' }], 2);
  const p = ctdFmt.parseCtd(buf);
  assert.equal(p.messages.length, 2);
  assert.equal(p.messages[1].text, 'World\nTwo');
  assert.deepEqual([...ctdFmt.composeCtd(p)], [...buf]);
});

test('ctd-format: longer translation grows the file and keeps layout blob', () => {
  const buf = buildCtd([{ id: 10, text: 'Hi' }, { id: 11, text: 'Bye' }], 1);
  const p = ctdFmt.parseCtd(buf);
  p.messages[0].text = 'A much longer replacement text';
  const out = ctdFmt.composeCtd(p);
  assert.ok(out.length > buf.length);
  const re = ctdFmt.parseCtd(out);
  assert.equal(re.messages[0].text, 'A much longer replacement text');
  assert.equal(re.messages[1].text, 'Bye');
  assert.deepEqual([...re.layouts.blob], [...p.layouts.blob]);
  assert.equal(out.length % 16, 0);
});

test('ctd-format: rejects bad magic', () => {
  assert.throws(() => ctdFmt.parseCtd(Buffer.alloc(64)), /bad magic/);
});

// ======================= Re:CoM .ctdl =======================

test('ctdl-format: identity, edit shorter, rebuild on growth (align4, textBase kept)', () => {
  const orig = buildCtdl();
  const p = ctdlFmt.parseCtdl(orig);
  assert.equal(p.entries.length, 3);
  assert.deepEqual([...ctdlFmt.composeCtdl(p)], [...orig]);

  const short = ctdlFmt.composeCtdl(p, new Map([[0, 'Hi']]));
  const re1 = ctdlFmt.parseCtdl(short);
  assert.equal(re1.entries[0].text, 'Hi');
  assert.equal(re1.header.textBase, p.header.textBase);

  const grown = ctdlFmt.composeCtdl(p, new Map([[1, 'Sora\nDonald\nGoofy and Pluto']]));
  assert.ok(grown.length > orig.length);
  const re = ctdlFmt.parseCtdl(grown);
  assert.equal(re.entries[1].text, 'Sora\nDonald\nGoofy and Pluto');
  assert.equal(re.entries[0].text, 'Hello');
  assert.equal(re.entries[2].text, 'Press {icon 66}\nfor menu.');
  assert.deepEqual([...re.layouts[0]], [...p.layouts[0]]);
  for (const e of re.entries) assert.equal(e.absoluteOffset % 4, 0);
});

test('ctdl-format: rejects truncated / bad headers', () => {
  assert.throws(() => ctdlFmt.parseCtdl(Buffer.alloc(8)), /too short/);
  const bad = buildCtdl();
  bad.writeUInt32LE(0xDEADBEEF, 0);
  assert.throws(() => ctdlFmt.parseCtdl(bad), /bad magic/);
});
