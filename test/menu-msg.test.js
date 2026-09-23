'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const codec = require('../shared/codec');
const menuMsg = require('../tools/lib/menu-msg');
const mesOfs = require('../tools/lib/mes-ofs');
const { classifyFile, parseFile } = require('../tools/lib/formats');

// Рядок меню з 0x00 усередині команди (0D i16 = dx) — типовий для SAWDMSG.
const MENU_CMD_PREFIX = Buffer.from([0x0C, 0x14, 0x0E, 0xFD, 0xFF, 0x0D, 0x0C, 0x00]);
function menuStr(text) { return Buffer.concat([MENU_CMD_PREFIX, codec.encode(text)]); }

function buildKmb(strings, opts) {
  const chunks = [Buffer.alloc(4)];
  chunks[0].writeUInt32LE(strings.length, 0);
  for (const s of strings) chunks.push(Buffer.isBuffer(s) ? s : codec.encode(s), Buffer.from([0]));
  const body = Buffer.concat(chunks);
  const pad = (opts && opts.padTo) ? Math.max(0, opts.padTo - body.length) : 0;
  return Buffer.concat([body, Buffer.alloc(pad, 0)]);
}

// Пара таблиця-зсувів + дані у діалекті меню (без 0xCD — як SASAMSG/Challenge).
function buildMenuPair(bufs) {
  const ofs = Buffer.alloc(bufs.length * 2);
  const chunks = [];
  let off = 0;
  bufs.forEach((b, i) => { ofs.writeUInt16LE(off, i * 2); chunks.push(b, Buffer.from([0])); off += b.length + 1; });
  return { ofs, data: Buffer.concat(chunks) };
}

test('menu-msg: scanMsgEnd skips 0x00 that belongs to a menu command parameter', () => {
  const s = Buffer.concat([menuStr('Hi'), Buffer.from([0x00, 0x41])]);
  assert.equal(menuMsg.scanMsgEnd(s, 0, s.length), MENU_CMD_PREFIX.length + 2);
  // без команд — перший нуль
  assert.equal(menuMsg.scanMsgEnd(Buffer.from([0x41, 0x42, 0x00, 0x43]), 0, 4), 2);
});

test('kmb: u32 count + terminated strings; identity is byte-identical, growth keeps the tail policy', () => {
  const buf = buildKmb(['What would you like{lf}to read?', menuStr('Rotate with'), 'Bye'], { padTo: 64 });
  const p = menuMsg.parseCounted(buf);
  assert.equal(p.count, 3);
  assert.equal(codec.decode(p.entries[1].bytes, { cmd: 'sysmsg' }), '{scale 20}{dy -3}{dx 12}Rotate with');
  assert.deepEqual([...menuMsg.composeCounted(p, new Map())], [...buf]);
  // коротший переклад → розмір файла той самий; довший → хвіст (нулі) + вирівнювання 16
  const shorter = menuMsg.composeCounted(p, new Map([[2, codec.encode('B')]]));
  assert.equal(shorter.length, 64);
  const longer = menuMsg.composeCounted(p, new Map([[0, codec.encode('Що б ви хотіли{lf}прочитати сьогодні ввечері?')]]));
  assert.ok(longer.length > 64 && longer.length % 16 === 0, 'grown + aligned: ' + longer.length);
  const back = menuMsg.parseCounted(longer);
  assert.equal(codec.decode(back.entries[0].bytes, { cmd: 'sysmsg' }), 'Що б ви хотіли{lf}прочитати сьогодні ввечері?');
  assert.equal(back.entries[2].bytes.toString('hex'), codec.encode('Bye').toString('hex'));
  // сміття після заявлених рядків — помилка (не kmb)
  assert.throws(() => menuMsg.parseCounted(Buffer.concat([buildKmb(['a']), Buffer.from([0x41])])), /ненульові/);
});

test('mes-ofs pairs: menu dialect keeps 0x00 inside commands and round-trips a longer translation', () => {
  const { ofs, data } = buildMenuPair([menuStr('End of the World'), menuStr('Monstro'), codec.encode('Atlantica')]);
  const p = mesOfs.parsePair(ofs, data, codec, { cmd: 'sysmsg' });
  assert.equal(p.uniqueStrings, 3);
  assert.equal(p.slots[0].english, '{scale 20}{dy -3}{dx 12}End of the World{eol}');
  assert.equal(p.slots[2].english, 'Atlantica{eol}');
  // старий (evmsg) сканер обрізав би перший рядок на параметрі 0x00
  const naive = mesOfs.parsePair(ofs, data, codec);
  assert.notEqual(naive.slots[0].english, p.slots[0].english);
  const c = mesOfs.composePair(p.slots.map(s => Object.assign({}, s, { ukText: s.offset === p.slots[1].offset ? '{scale 20}{dy -3}{dx 12}Монстро{eol}' : '' })),
    { ofsLength: ofs.length, dataLength: data.length, cellLengthByOffset: p.cellLengthByOffset }, codec);
  const back = mesOfs.parsePair(c.ofsBuf, c.dataBuf, codec, { cmd: 'sysmsg' });
  assert.equal(back.slots[1].english, '{scale 20}{dy -3}{dx 12}Монстро{eol}');
  assert.equal(back.slots[0].english, p.slots[0].english);
  assert.equal(back.slots[2].english, 'Atlantica{eol}');
});

test('classify: SAW*/SASA/Challenge pairs and .kmb are recognised; data halves are not raw text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-menu-'));
  try {
    const ex = path.join(dir, 'kh1_third', 'exchange');
    const gumi = path.join(dir, 'kh1_third', 'gumi', 'SASAMSG.BIN');
    const challe = path.join(dir, 'kh1_fourth', 'worldmap', 'challe.dat');
    for (const d of [ex, gumi, challe]) fs.mkdirSync(d, { recursive: true });
    const pair = buildMenuPair([menuStr('World Map Event Test 1'), codec.encode('Garage')]);
    fs.writeFileSync(path.join(ex, 'UK_SAWEOMSG.BIN'), pair.ofs);
    fs.writeFileSync(path.join(ex, 'UK_SAWEMSG.BIN'), pair.data);
    fs.writeFileSync(path.join(ex, 'UK_SASAOMSG.BIN'), pair.ofs);
    fs.writeFileSync(path.join(gumi, 'UK_SASAMSG.BIN'), pair.data);
    fs.writeFileSync(path.join(challe, 'UK_ChallengeOfs.binl'), pair.ofs);
    fs.writeFileSync(path.join(challe, 'UK_ChallengeMsg.bin'), pair.data);
    fs.writeFileSync(path.join(dir, 'UK_md_jiminy.kmb'), buildKmb(['Read?']));

    for (const f of ['UK_SAWEOMSG.BIN', 'UK_SASAOMSG.BIN']) {
      const c = classifyFile(path.join(ex, f));
      assert.equal(c.kind, 'mesofs', f);
      assert.equal(c.extractOpts.cmd, 'sysmsg', f);
    }
    assert.equal(classifyFile(path.join(ex, 'UK_SASAOMSG.BIN')).extractOpts.dataPath, path.join(gumi, 'UK_SASAMSG.BIN'));
    assert.equal(classifyFile(path.join(challe, 'UK_ChallengeOfs.binl')).kind, 'mesofs');
    for (const f of [path.join(ex, 'UK_SAWEMSG.BIN'), path.join(gumi, 'UK_SASAMSG.BIN'), path.join(challe, 'UK_ChallengeMsg.bin')]) {
      const c = classifyFile(f);
      assert.equal(c.kind, 'mesdata', f);
      assert.equal(c.isTranslatable, false, f);
    }
    assert.equal(classifyFile(path.join(dir, 'UK_md_jiminy.kmb')).kind, 'kmb');

    // Cross-dir пара через реєстр: data-вихід іде за srcPath у власну теку DONE.
    const parsed = await parseFile(path.join(ex, 'UK_SASAOMSG.BIN'), {});
    assert.equal(parsed.kind, 'mesofs');
    assert.equal(parsed.slots.length, 2);
    const r = await parsed.compose(new Map([[parsed.slots[1].offset, 'Гараж{eol}']]));
    assert.equal(r.outputs[1].srcPath, path.join(gumi, 'UK_SASAMSG.BIN'));
    const ops = require('../tools/lib/translate-ops');
    const out = path.join(dir, 'DONE');
    const res = await ops.composeAll(['kh1_third/exchange/UK_SASAOMSG.BIN', 'kh1_third/exchange/UK_SAWEOMSG.BIN', 'UK_md_jiminy.kmb'],
      { engDir: dir, outDir: out, glossary: { 'Garage{eol}': 'Гараж{eol}', 'Read?': 'Читати?' }, safeMode: true, outLayout: 'patch', gameId: 'kh1-final-mix' });
    assert.deepEqual(res.errors, []);
    assert.equal(res.written, 3);
    assert.ok(fs.existsSync(path.join(out, 'kh1_third', 'original', 'exchange', 'UK_SASAOMSG.BIN')));
    assert.ok(fs.existsSync(path.join(out, 'kh1_third', 'remastered', 'gumi', 'SASAMSG.BIN', 'UK_SASAMSG.BIN')), 'SASAMSG lands in remastered/gumi');
    assert.ok(fs.existsSync(path.join(out, 'kh1_third', 'original', 'exchange', 'UK_SAWEMSG.BIN')));
    const kmb = menuMsg.parseCounted(fs.readFileSync(path.join(out, 'kh1_first', 'remastered', 'UK_md_jiminy.kmb')));
    assert.equal(codec.decode(kmb.entries[0].bytes, { cmd: 'sysmsg' }), 'Читати?');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('kh1-files: memo sysmsg is text; psel.bin and allarea.nam are not', () => {
  const { isKh1TextFile } = require('../tools/lib/kh1-files');
  assert.equal(isKh1TextFile('remastered/menu/md_memo_sysmsg.bin/UK_md_memo_sysmsg.binl'), true);
  assert.equal(isKh1TextFile('remastered/menu/md_dic_msg.kmb/UK_md_dic_msg.kmb'), true);
  assert.equal(isKh1TextFile('original/exchange/UK_SASAOMSG.BIN'), true);
  assert.equal(isKh1TextFile('remastered/gumi/SASAMSG.BIN/UK_SASAMSG.BIN'), true);
  assert.equal(isKh1TextFile('original/exchange/UK/psel.bin'), false);
  assert.equal(isKh1TextFile('original/exchange/UK_allarea.nam'), false);
  assert.equal(isKh1TextFile('original/exchange/US_allarea.nam'), false);
});
