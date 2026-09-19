'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const codec = require('../shared/codec');
const tsv = require('../shared/tsv');
const ops = require('../tools/lib/translate-ops');
const { classifyFile, clearCache } = require('../tools/lib/formats');
const { parseCtd } = require('../tools/lib/ctd-format');
const { parseCtdl } = require('../tools/lib/recom-ctdl-format');
const { parsePair } = require('../tools/lib/mes-ofs');
const { parseEv } = require('../tools/lib/ev-format');
const { extract } = require('../tools/lib/extract');
const synth = require('./helpers/synth');

let root, engDir, rusDir, outDir, tsvDir;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-ops-'));
  engDir = path.join(root, 'ENG'); rusDir = path.join(root, 'RUS');
  outDir = path.join(root, 'DONE'); tsvDir = path.join(root, 'PROGRESS');
  for (const d of [engDir, rusDir, outDir, tsvDir]) fs.mkdirSync(path.join(d, 'sub'), { recursive: true });

  // binl: 'Potion' preserved (in RUS), 'Attack' translatable
  fs.writeFileSync(path.join(engDir, 'sub', 'a.binl'), synth.buildBinl(['Potion', 'Attack', 'Traverse Town']));
  fs.writeFileSync(path.join(rusDir, 'sub', 'a.binl'), synth.buildBinl(['Potion']));
  // mes_ofs pair
  const mo = synth.buildMesOfs(['Potion', 'Ether'], [0, 1, 1], { pad: 16 });
  fs.writeFileSync(path.join(engDir, 'g_mes_ofs.bin'), mo.ofs);
  fs.writeFileSync(path.join(engDir, 'g_mes_data.bin'), mo.data);
  fs.writeFileSync(path.join(rusDir, 'g_mes_ofs.bin'), mo.ofs);
  fs.writeFileSync(path.join(rusDir, 'g_mes_data.bin'), mo.data);
  // ev
  fs.writeFileSync(path.join(engDir, 'e.evdl'), synth.buildEv(['Hello there', 'Bye']).buf);
  fs.writeFileSync(path.join(rusDir, 'e.evdl'), Buffer.alloc(1));
  // ctd + ctdl
  fs.writeFileSync(path.join(engDir, 'b.ctd'), synth.buildCtd([{ id: 7, text: 'Press {icon triangle} now' }, { id: 8, text: 'Yes' }], 1));
  fs.writeFileSync(path.join(rusDir, 'b.ctd'), Buffer.alloc(1));
  fs.writeFileSync(path.join(engDir, 'c.ctdl'), synth.buildCtdl(['Hello', 'Yes']));
  fs.writeFileSync(path.join(rusDir, 'c.ctdl'), Buffer.alloc(1));
  // unknown junk
  fs.writeFileSync(path.join(engDir, 'junk.bin'), Buffer.from('KGR\0' + 'x'.repeat(100)));
  fs.writeFileSync(path.join(rusDir, 'junk.bin'), Buffer.alloc(1));
});

after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const FILES = ['sub/a.binl', 'g_mes_ofs.bin', 'e.evdl', 'b.ctd', 'c.ctdl', 'junk.bin'];

test('classifyFile detects every synthetic format and caches by mtime', () => {
  clearCache();
  const kinds = FILES.map(f => classifyFile(path.join(engDir, f)).kind);
  assert.deepEqual(kinds, ['binl', 'mesofs', 'ev', 'ctd', 'ctdl', 'unknown']);
  assert.equal(classifyFile(path.join(engDir, 'g_mes_data.bin')).kind, 'mesdata');
  // cache hit returns the same object
  const a = classifyFile(path.join(engDir, 'b.ctd'));
  assert.equal(classifyFile(path.join(engDir, 'b.ctd')), a);
});

test('extractFile returns UI slots for each format', async () => {
  const binl = await ops.extractFile(path.join(engDir, 'sub', 'a.binl'), { rusPath: path.join(rusDir, 'sub', 'a.binl') });
  assert.deepEqual(binl.slots.map(s => s.english), ['Attack', 'Traverse Town']);
  const mes = await ops.extractFile(path.join(engDir, 'g_mes_ofs.bin'), {});
  assert.equal(mes.slots.length, 2);
  assert.equal(mes.slots[1].linkedCount, 2);
  const ctd = await ops.extractFile(path.join(engDir, 'b.ctd'), {});
  assert.equal(ctd.slots[0].english, 'Press {icon triangle} now');
  assert.equal(ctd.slots[0].offset, 7);
  const ctdl = await ops.extractFile(path.join(engDir, 'c.ctdl'), {});
  assert.equal(ctdl.stats.entryCount, 2);
  await assert.rejects(() => ops.extractFile(path.join(engDir, 'junk.bin'), {}), /Непідтримуваний/);
});

test('composeFile: ctd encodes Cyrillic to katakana codes; mesofs writes both files', async () => {
  const r = await ops.composeFile(path.join(engDir, 'b.ctd'), [{ offset: 7, ukText: 'Тисни {icon triangle} зараз' }], path.join(outDir, 'b.ctd'), {});
  assert.equal(r.applied, 1);
  assert.deepEqual(r.errors, []);
  const re = parseCtd(fs.readFileSync(path.join(outDir, 'b.ctd')));
  assert.equal(re.messages[0].text, 'Тисни {icon triangle} зараз');
  assert.equal(re.messages[0].raw[0], 0x83); // Т → катакана-код 0x83xx

  const m = await ops.composeFile(path.join(engDir, 'g_mes_ofs.bin'), [{ offset: 0, ukText: 'Зілля{eol}' }], path.join(outDir, 'g_mes_ofs.bin'), {});
  assert.equal(m.written.length, 2);
  assert.ok(fs.existsSync(path.join(outDir, 'g_mes_data.bin')));
  const pp = parsePair(fs.readFileSync(path.join(outDir, 'g_mes_ofs.bin')), fs.readFileSync(path.join(outDir, 'g_mes_data.bin')), codec);
  assert.deepEqual([...codec.encode(pp.slots[0].english)], [...codec.encode('Зілля{eol}')]);
});

test('buildGlossaryIndex aggregates keys across formats, safe mode skips unknown', async () => {
  const r = await ops.buildGlossaryIndex(FILES, { engDir, rusDir, safeMode: true, withOccurrences: false });
  assert.equal(r.skippedUnsafe, 1);
  assert.equal(r.processed, 6);
  const keys = r.entries.map(e => e.english);
  assert.ok(keys.includes('Attack'));
  assert.ok(keys.includes('Potion{eol}'));
  assert.ok(keys.includes('Press {icon triangle} now'));
  assert.ok(keys.includes('Hello there{eol}'));
  const yes = r.entries.find(e => e.english === 'Yes');
  assert.equal(yes.count, 2);          // ctd + ctdl
  assert.equal(yes.fileCount, 2);
  assert.equal(yes.occurrences, undefined);
});

test('glossaryLookup bridges keys with and without trailing {eol}', () => {
  const g = { 'Potion': 'Зілля', 'Ether{eol}': 'Ефір{eol}' };
  assert.equal(ops.glossaryLookup(g, 'Potion{eol}'), 'Зілля{eol}');
  assert.equal(ops.glossaryLookup(g, 'Ether'), 'Ефір');
  assert.equal(ops.glossaryLookup(g, 'Nope'), '');
});

test('composeAll: TSV override beats glossary; whitespace preserved; unsafe skipped', async () => {
  // per-file override for binl 'Attack'
  const binlSlots = extract(fs.readFileSync(path.join(engDir, 'sub', 'a.binl')), fs.readFileSync(path.join(rusDir, 'sub', 'a.binl')), { header: 11, footer: 5 }).slots;
  const attack = binlSlots.find(s => s.english === 'Attack');
  fs.mkdirSync(path.join(tsvDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(tsvDir, 'sub', 'a.binl.tsv'), tsv.build([{ index: 0, offset: attack.offset, byteLen: attack.byteLen, english: 'Attack', ukText: 'Удар' }]));

  const glossary = {
    'Attack': 'Атака',               // перекриється TSV
    'Traverse Town': ' Місто Траверс',
    'Potion': 'Зілля',               // для mesofs через {eol}-bridge
    'Yes': 'Так',
    'Hello there{eol}': 'Привіт{eol}',
    'Press {icon triangle} now': 'Тисни {icon triangle} зараз'
  };
  const progress = [];
  const r = await ops.composeAll(FILES, { engDir, rusDir, outDir, tsvDir, glossary, safeMode: true, concurrency: 3, onProgress: p => progress.push(p) });
  assert.equal(r.skippedUnsafe, 1);
  assert.equal(r.written, 5);
  assert.deepEqual(r.errors, []);
  assert.equal(progress.length, 6);

  // binl: TSV override applied, glossary for the other
  const outBinl = fs.readFileSync(path.join(outDir, 'sub', 'a.binl'));
  const decoded = codec.decode(outBinl.subarray(11, outBinl.length - 5));
  assert.match(decoded, /Удар/);
  assert.match(decoded, /Місто Траверс/);
  assert.doesNotMatch(decoded, /Атака/);

  // ev
  const ev = parseEv(fs.readFileSync(path.join(outDir, 'e.evdl')), codec);
  assert.deepEqual([...codec.encode(ev.slots[0].english)], [...codec.encode('Привіт{eol}')]);
  // ctd + ctdl 'Yes'
  assert.equal(parseCtdl(fs.readFileSync(path.join(outDir, 'c.ctdl'))).entries[1].text.length > 0, true);
  const ctd = parseCtd(fs.readFileSync(path.join(outDir, 'b.ctd')));
  assert.equal(ctd.messages[0].text, 'Тисни {icon triangle} зараз');
  assert.equal(parseCtdl(fs.readFileSync(path.join(outDir, 'c.ctdl'))).entries[1].text, 'Так');
});

test('structural guard: KH1 compose keeps EN when a translation drops a command token or adds a structural one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-guard-'));
  try {
    const eng = path.join(dir, 'ENG'), rus = path.join(dir, 'RUS'), out = path.join(dir, 'DONE');
    for (const d of [eng, rus, out]) fs.mkdirSync(d);
    // «Wake up!{0x06,0x2C,0x01}» — команда з u16-параметром 0x012C у кінці рядка.
    fs.writeFileSync(path.join(eng, 'g.binl'), synth.buildBinl(['Wake up!{0x06,0x2C,0x01}', 'Run', 'Jump']));
    fs.writeFileSync(path.join(rus, 'g.binl'), synth.buildBinl(['Nope']));
    assert.equal(ops.structuralIssue('Wake up!{0x06,0x2C,0x01}', 'Прокинься!'), 'втрачено токени: {0x06,0x2C,0x01}');
    assert.equal(ops.structuralIssue('Run', 'Біжи{0x0A,0x00}'), 'додано структурні команди: {0x0A,0x00}');
    assert.equal(ops.structuralIssue('Run{lf}fast', 'Біжи швидко{ColorRed}'), null);   // {lf} вільний, колір — не структурний

    const glossary = { 'Wake up!{0x06,0x2C,0x01}': 'Прокинься!', 'Run': 'Біжи{0x0A,0x00}', 'Jump': 'Стрибай' };
    const r = await ops.composeAll(['g.binl'], { engDir: eng, rusDir: rus, outDir: out, glossary, safeMode: true });
    assert.equal(r.written, 1);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].count, 2);
    const outBuf = fs.readFileSync(path.join(out, 'g.binl')).subarray(11);
    assert.match(codec.decode(outBuf), /Стрибай/);                                   // UA-режим
    assert.match(codec.decode(outBuf, { overlay: false }), /Wake up!\{0x06,0x2C,0x01\}/); // EN лишився
    assert.doesNotMatch(codec.decode(outBuf), /Біжи/);

    // composeFile (редактор одного файла) — той самий guard, strictTokens:false вимикає.
    const slots = extract(fs.readFileSync(path.join(eng, 'g.binl')), fs.readFileSync(path.join(rus, 'g.binl')), { header: 11, footer: 5 }).slots;
    const wake = slots.find(s => s.english.startsWith('Wake'));
    const one = await ops.composeFile(path.join(eng, 'g.binl'), [{ offset: wake.offset, ukText: 'Прокинься!' }], path.join(out, 'g2.binl'), { rusPath: path.join(rus, 'g.binl') });
    assert.equal(one.applied, 0);
    assert.match(one.errors[0].message, /втрачено токени/);
    const two = await ops.composeFile(path.join(eng, 'g.binl'), [{ offset: wake.offset, ukText: 'Прокинься!' }], path.join(out, 'g3.binl'), { rusPath: path.join(rus, 'g.binl'), strictTokens: false });
    assert.equal(two.applied, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy keys: index exposes legacyKey and lookup bridges old 2-byte 05/06/07 tokens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-legacy-'));
  try {
    const eng = path.join(dir, 'ENG'), rus = path.join(dir, 'RUS');
    fs.mkdirSync(eng); fs.mkdirSync(rus);
    fs.writeFileSync(path.join(eng, 'l.binl'), synth.buildBinl(['Wake up!{0x06,0x2C,0x01}', 'Plain']));
    fs.writeFileSync(path.join(rus, 'l.binl'), synth.buildBinl(['Nope']));
    const idx = await ops.buildGlossaryIndex(['l.binl'], { engDir: eng, rusDir: rus, safeMode: true });
    const wake = idx.entries.find(e => e.english.startsWith('Wake'));
    assert.equal(wake.english, 'Wake up!{0x06,0x2C,0x01}');
    assert.equal(wake.legacyKey, 'Wake up!{0x06,0x2C} ');
    assert.equal(idx.entries.find(e => e.english === 'Plain').legacyKey, undefined);
    // Старий глосарій (ключ у 2-байтовій формі) далі знаходиться при compose.
    assert.equal(ops.glossaryLookup({ 'Wake up!{0x06,0x2C} ': 'Прокинься!{0x06,0x2C} ' }, 'Wake up!{0x06,0x2C,0x01}'), 'Прокинься!{0x06,0x2C} ');
    assert.equal(codec.legacyCommandKey('x{0x07,0x0C,0x02}y'), 'x{0x07,0x0C}{lf}y');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('classify: X_offset.bin + X_data.bin pair (wsysmsg/wname) is mesofs/mesdata, lone _data.bin stays raw', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-pair-'));
  try {
    const mo = synth.buildMesOfs(['Power', 'Armor', 'Shield'], [0, 1, 2], { pad: 16 });
    fs.writeFileSync(path.join(dir, 'UK_wsysmsg_offset.bin'), mo.ofs);
    fs.writeFileSync(path.join(dir, 'UK_wsysmsg_data.bin'), mo.data);
    fs.writeFileSync(path.join(dir, 'UK_lonely_data.bin'), mo.data);
    clearCache();
    assert.equal(classifyFile(path.join(dir, 'UK_wsysmsg_offset.bin')).kind, 'mesofs');
    assert.equal(classifyFile(path.join(dir, 'UK_wsysmsg_data.bin')).kind, 'mesdata');
    assert.notEqual(classifyFile(path.join(dir, 'UK_lonely_data.bin')).kind, 'mesdata');
    const parsed = await ops.extractFile(path.join(dir, 'UK_wsysmsg_offset.bin'), {});
    assert.deepEqual(parsed.slots.map(s => s.english), ['Power{eol}', 'Armor{eol}', 'Shield{eol}']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('native scheme: composeAll writes 19 NN codes for KH1 binl and sysmsg uses hybrid', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-native-'));
  try {
    const eng = path.join(dir, 'ENG'), rus = path.join(dir, 'RUS'), out = path.join(dir, 'DONE');
    for (const d of [eng, rus, out]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(eng, 'n.binl'), synth.buildBinl(['Wake up!', 'Run']));
    fs.writeFileSync(path.join(rus, 'n.binl'), synth.buildBinl(['Nope']));
    fs.writeFileSync(path.join(eng, 'UK_sysmsg.binl'), synth.buildMsgV361(['Load this game?', 'Form your party.']));
    codec.setDefaultScheme('native');
    try {
      const r = await ops.composeAll(['n.binl', 'UK_sysmsg.binl'], { engDir: eng, rusDir: rus, outDir: out, glossary: { 'Wake up!': 'Прокинься!', 'Run': 'Біжи', 'Load this game?': 'Завантажити цю гру?' }, safeMode: true });
      assert.equal(r.written, 2);
      assert.deepEqual(r.errors, []);
      const binl = fs.readFileSync(path.join(out, 'n.binl'));
      assert.ok(binl.includes(Buffer.from([0x19, 0x13, 0x19, 0x35])), 'П р as 19 NN');
      assert.match(codec.decode(binl.subarray(11), { scheme: 'native' }), /Прокинься!/);
      const sys = require('../tools/lib/msg-v361').parseMessageV361(fs.readFileSync(path.join(out, 'UK_sysmsg.binl')));
      const first = codec.decode(sys.entries[0].bytes, { scheme: 'native', cmd: 'sysmsg' });
      assert.equal(first, 'Зaвaнтaжити цю гpy?');   // hybrid: а/р/у → латинські a/p/y (1 байт)
    } finally { codec.setDefaultScheme('overlay'); }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('text-quality: bytecode fragments are not translatable slots', () => {
  const { looksLikeText } = require('../tools/lib/text-quality');
  for (const bad of ['{0x19}{eol}', '{0x0F}{eol}', 'H{eol}', 'Bö ìoèy{0x0B}{eol}', 'Âáy{0x0B}', '{0x08}{0x07,0x0C}', '100', 'Úерхêеé úíаàе éаÛаáâêа{lf}{0x0B}']) {
    assert.equal(looksLikeText(bad), false, bad);
  }
  for (const good of ['Uh, Donald. Ya know,{lf}{0x0B}', 'HP', 'Go!', 'Yes{eol}', 'Привіт{eol}', 'Pooh\'s House', 'Obtained {ColorGreen}{Gem}{VarItem}{ColorBase}.']) {
    assert.equal(looksLikeText(good), true, good);
  }
});
