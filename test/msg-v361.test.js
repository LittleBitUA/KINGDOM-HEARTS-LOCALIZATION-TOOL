'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const codec = require('../shared/codec');
const msg = require('../tools/lib/msg-v361');
const { classifyFile, parseFile } = require('../tools/lib/formats');
const { buildMsgV361 } = require('./helpers/synth');

const STRINGS = ['Load this game?', 'Ability equipped.{lf}Nice.', 'P', 'Form your party.'];

test('msg-v361: parse reads count, offsets, sentinel and entries', () => {
  const buf = buildMsgV361(STRINGS);
  const p = msg.parseMessageV361(buf);
  assert.equal(p.count, 4);
  assert.equal(p.offsetCount, 5);
  assert.equal(p.hasTrailingSentinel, true);
  assert.equal(p.usesCdPadding, true);
  assert.equal(codec.decode(p.entries[1].bytes, { overlay: false }), 'Ability equipped.{lf}Nice.');
  assert.equal(p.entries[0].offset, p.textOffset);
  // Без sentinel і з 0x00-padding теж парситься.
  const p2 = msg.parseMessageV361(buildMsgV361(STRINGS, { sentinel: false, cdPad: false }));
  assert.equal(p2.offsetCount, 4);
  assert.equal(p2.hasTrailingSentinel, false);
  assert.equal(p2.usesCdPadding, false);
});

test('msg-v361: identity compose is byte-identical; growth rebuilds offsets and textLength', () => {
  for (const opts of [{}, { sentinel: false }, { cdPad: false }]) {
    const buf = buildMsgV361(STRINGS, opts);
    const p = msg.parseMessageV361(buf);
    assert.deepEqual([...msg.composeMessageV361(p, new Map())], [...buf]);

    const uk = codec.encode('Завантажити цю гру?{lf}Так/Ні');
    const out = msg.composeMessageV361(p, new Map([[0, uk]]));
    assert.equal(out.length % 16, 0);
    const q = msg.parseMessageV361(out);
    assert.equal(q.count, 4);
    assert.equal(q.hasTrailingSentinel, p.hasTrailingSentinel);
    assert.deepEqual([...q.entries[0].bytes], [...uk]);
    assert.deepEqual([...q.entries[3].bytes], [...p.entries[3].bytes]);
    assert.equal(out.readUInt32LE(0x1C), q.textLength);
    assert.equal(out[out.length - 1], p.usesCdPadding ? 0xCD : 0x00);
  }
});

test('msg-v361: compose keeps inner 0x00 (command params) and rejects >64K text block', () => {
  const p = msg.parseMessageV361(buildMsgV361(STRINGS));
  const out = msg.composeMessageV361(p, new Map([[0, Buffer.from([0x2B, 0x0D, 0x06, 0x00, 0x2B])]]));
  assert.deepEqual([...msg.parseMessageV361(out).entries[0].bytes], [0x2B, 0x0D, 0x06, 0x00, 0x2B]);
  assert.throws(() => msg.composeMessageV361(p, new Map([[0, Buffer.alloc(70000, 0x2B)]])), /65535/);
});

test('msg-v361: classify + format handler round-trip through the registry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-v361-'));
  try {
    const engPath = path.join(dir, 'UK_sysmsg.binl');
    fs.writeFileSync(engPath, buildMsgV361(STRINGS));
    const cls = classifyFile(engPath);
    assert.equal(cls.kind, 'binl-v361');
    assert.equal(cls.isTranslatable, true);
    const parsed = await parseFile(engPath, {});
    // 'P' — одна літера, не текст (text-quality) → 3 перекладні.
    assert.equal(parsed.slots.length, 3);
    assert.deepEqual(parsed.slots.map(s => s.index), [0, 1, 3]);
    assert.equal(parsed.slots[0].english, 'Load this game?');
    const r = await parsed.compose(new Map([
      [parsed.slots[0].offset, 'Завантажити цю гру?'],
      [parsed.slots[1].offset, 'Здібність{eol}зламана'],   // {eol} → error, лишається EN
      [parsed.slots[2].offset, 'Form your party.']           // без змін → пропуск
    ]));
    assert.equal(r.applied, 1);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /\{eol\}/);
    const q = msg.parseMessageV361(r.outputs[0].buf);
    assert.equal(codec.decode(q.entries[0].bytes), 'Завантажити цю гру?');
    assert.equal(codec.decode(q.entries[1].bytes, { overlay: false }), 'Ability equipped.{lf}Nice.');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Реальний файл гри (якщо є на цій машині): byte-identical round-trip і
// перерозбір після зростання кожного запису.
const REAL = 'E:/Games/KH1 MODDED UA/Image/en/kh1_first.hed_out/remastered/menu/uk/sysmsg.bin/UK_sysmsg.binl';
test('msg-v361: real UK_sysmsg.binl round-trips', { skip: !fs.existsSync(REAL) }, () => {
  const buf = fs.readFileSync(REAL);
  const p = msg.parseMessageV361(buf);
  assert.equal(p.count, 488);
  assert.deepEqual([...msg.composeMessageV361(p, new Map())], [...buf]);
  // Діалект sysmsg: «Kingdom Hearts» з відступом 0D 06 00 — «H» не ховається у токені.
  assert.match(codec.decode(p.entries[9].bytes, { overlay: false, cmd: 'sysmsg' }), /^Kingdom\{0x0D,0x06,0x00\}Hearts has not been properly/);
  // Кожен запис декодується і кодується назад без втрат.
  for (const e of p.entries) {
    const t = codec.decode(e.bytes, { overlay: false, cmd: 'sysmsg' });
    assert.deepEqual([...codec.encode(t, { overlay: false })], [...e.bytes], 'entry #' + e.index + ': ' + t);
    assert.doesNotMatch(t, /\{eol\}/, 'entry #' + e.index + ' has a bare 0x00 outside commands: ' + t);
  }
  const rep = new Map(p.entries.map(e => [e.index, Buffer.concat([e.bytes, codec.encode(' Ю')])]));
  const out = msg.composeMessageV361(p, rep);
  const q = msg.parseMessageV361(out);
  assert.equal(q.count, 488);
  assert.equal(q.entries[487].bytes.length, p.entries[487].bytes.length + 2);
});
