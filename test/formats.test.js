'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../shared/codec');
const mesOfs = require('../tools/lib/mes-ofs');
const ev = require('../tools/lib/ev-format');
const ctdFmt = require('../tools/lib/ctd-format');
const ctdCodec = require('../tools/lib/ctd-codec');
const ctdlFmt = require('../tools/lib/recom-ctdl-format');
const ctdlCodec = require('../tools/lib/recom-ctdl-codec');
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
  assert.equal(c2.dataBuf.length, data.length);
  const re = mesOfs.parsePair(c2.ofsBuf, c2.dataBuf, codec);
  assert.equal(re.slots[1].english, 'Ether{eol}');
  assert.deepEqual([...codec.encode(re.slots[0].english)], [...codec.encode('Дуже довге зілля{eol}')]);
});

test('mes-ofs: compact overflow beyond original data size throws', () => {
  const { ofs, data } = buildMesOfs(['Potion'], [0], { pad: 0 });
  const p = mesOfs.parsePair(ofs, data, codec);
  const long = p.slots.map(s => Object.assign({}, s, { ukText: 'x'.repeat(200) }));
  assert.throws(() => mesOfs.composePair(long, { ofsLength: ofs.length, dataLength: data.length, cellLengthByOffset: p.cellLengthByOffset }, codec));
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
  assert.equal(c.newTextLength % 4, 0);
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

test('ctd-codec: ASCII, newline, typography and colour tokens round-trip', () => {
  const cases = ['Hello', 'A\nB', "It's a cliché.", '[c:green]Go[c:default]', '{0xF1,0x30} press', '{0x81,0x46}'];
  for (const s of cases) {
    const enc = ctdCodec.encode(s);
    const dec = ctdCodec.decode(enc);
    assert.deepEqual([...ctdCodec.encode(dec)], [...enc], s);
  }
});

test('ctd-codec: OpenKh {:unk XX} escapes are accepted on encode', () => {
  assert.deepEqual([...ctdCodec.encode('{:unk f5}{:unk 30}')], [0xF5, 0x30]);
});

test('ctd-codec: transliterated Latin-Extended goes through PAIR_99 (é works), rest reported', () => {
  // 'é' — єдиний підтверджений 0x99-мапінг. Решта Latin-Extended цілей
  // CYRILLIC_TO_LATIN ще не мають байтів → '?' + запис в unmapped.
  assert.deepEqual([...ctdCodec.encode('й')], [0x99, 0xA1]); // й → é
  const enc = ctdCodec.encode('Сора');
  assert.equal(enc.length, 4);
  assert.deepEqual(ctdCodec.getLastEncodeUnmapped(), ['С', 'о', 'р', 'а']);
});

test.todo('ctd-codec: full Cyrillic → BBS font-hack byte table (needs confirmed PAIR_99 / single-byte layout)');

test('ctdl-format: {BTN_A} (0xFF 0x00) inside a string is not treated as terminator', () => {
  const orig = buildCtdl(['Press {BTN_A} now', 'Next']);
  const p = ctdlFmt.parseCtdl(orig);
  assert.equal(p.entries[0].text, 'Press {BTN_A} now');
  assert.equal(p.entries[1].text, 'Next');
  const grown = ctdlFmt.composeCtdl(p, new Map([[1, 'Next one is longer']]));
  const re = ctdlFmt.parseCtdl(grown);
  assert.equal(re.entries[0].text, 'Press {BTN_A} now');
  assert.equal(re.entries[1].text, 'Next one is longer');
});

test('ctd-codec: unmapped characters become ? and are reported', () => {
  const enc = ctdCodec.encode('a∑b');
  assert.equal(enc[1], 0x3F);
  assert.deepEqual(ctdCodec.getLastEncodeUnmapped(), ['∑']);
});

test('ctd-codec: glossaryKey collapses F1/F2/F5 params and restore2ndBytes restores them in order', () => {
  const en = 'Press {0xF1,0x30} or {0xF1,0x31} to {0xF5,0x10}';
  const key = ctdCodec.glossaryKey(en);
  assert.equal(key, 'Press {0xF1} or {0xF1} to {0xF5}');
  const uk = 'Натисни {0xF1} або {0xF1} щоб {0xF5}';
  assert.equal(ctdCodec.restore2ndBytes(uk, en), 'Натисни {0xF1,0x30} або {0xF1,0x31} щоб {0xF5,0x10}');
});

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

test('ctdl-codec: stable round-trip across SJIS, Latin-Extended, buttons, commands, raw', () => {
  const cases = [
    'Hello world!', 'Sora\nDonald\nGoofy', 'Press {BTN_A} to attack.',
    'Use {BTN_LEFTRIGHT} and {BTN_UPDOWN}', 'Café — naïve résumé', "L'Œil ßeta © 2026",
    '<EMPTYBLOCK>', '<Unk41> mid <Unk59>', 'Mix: {BTN_A} + Café\n{BTN_DPAD}', '<7F>raw byte<80>',
    '日本語テキスト'
  ];
  for (const s of cases) {
    const enc = ctdlCodec.encode(s);
    const dec = ctdlCodec.decode(enc);
    assert.deepEqual([...ctdlCodec.encode(dec)], [...enc], s);
  }
});

test('ctdl-codec: F5 button variant is preserved via originalBytes hints', () => {
  const orig = Buffer.from([0xF5, 0x67, 0x20, 0x41]);       // {BTN_F} via F5 + " A"
  const text = ctdlCodec.decode(orig);
  assert.equal(text, '{BTN_F} A');
  assert.deepEqual([...ctdlCodec.encode(text)], [0xFF, 0x11, 0x20, 0x41]);          // default → FF
  assert.deepEqual([...ctdlCodec.encode(text, { originalBytes: orig })], [...orig]); // hint → F5
});

test('ctdl-codec: cp932 EUDC bytes map to PUA and back', () => {
  const orig = Buffer.from([0xF9, 0x45]);
  const dec = ctdlCodec.decode(orig);
  assert.equal(dec.length, 1);
  assert.ok(dec.charCodeAt(0) >= 0xE000 && dec.charCodeAt(0) <= 0xE757);
  assert.deepEqual([...ctdlCodec.encode(dec)], [...orig]);
});

test('ctdl-format: identity, in-place shorter edit, rebuild on growth', () => {
  const orig = buildCtdl();
  const p = ctdlFmt.parseCtdl(orig);
  assert.equal(p.entries.length, 3);
  assert.deepEqual([...ctdlFmt.composeCtdl(p)], [...orig]);

  const inPlace = ctdlFmt.composeCtdl(p, new Map([[0, 'Hi']]));
  assert.equal(inPlace.length, orig.length);
  assert.equal(ctdlFmt.parseCtdl(inPlace).entries[0].text, 'Hi');

  const grown = ctdlFmt.composeCtdl(p, new Map([[1, 'Sora\nDonald\nGoofy and Pluto']]));
  assert.ok(grown.length > orig.length);
  const re = ctdlFmt.parseCtdl(grown);
  assert.equal(re.entries[1].text, 'Sora\nDonald\nGoofy and Pluto');
  assert.equal(re.entries[0].text, 'Hello');
  assert.equal(re.entries[2].text, 'Press {BTN_A}\nfor menu.');
  assert.deepEqual(re.textboxes[0], p.textboxes[0]);
});

test('ctdl-format: rejects truncated / bad headers', () => {
  assert.throws(() => ctdlFmt.parseCtdl(Buffer.alloc(8)), /too short/);
  const bad = buildCtdl();
  bad.writeUInt32LE(0xDEADBEEF, 0);
  assert.throws(() => ctdlFmt.parseCtdl(bad), /bad magic/);
});
