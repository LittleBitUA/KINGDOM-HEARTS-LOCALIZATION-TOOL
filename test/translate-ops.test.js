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
  fs.writeFileSync(path.join(engDir, 'b.ctd'), synth.buildCtd([{ id: 7, text: 'Press {0xF1,0x30} now' }, { id: 8, text: 'Yes' }], 1));
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
  assert.equal(ctd.slots[0].english, 'Press {0xF1} now'); // canonical (collapsed)
  assert.equal(ctd.slots[0].offset, 7);
  const ctdl = await ops.extractFile(path.join(engDir, 'c.ctdl'), {});
  assert.equal(ctdl.stats.entryCount, 2);
  await assert.rejects(() => ops.extractFile(path.join(engDir, 'junk.bin'), {}), /Непідтримуваний/);
});

test('composeFile: ctd restores F1 param bytes from EN; mesofs writes both files', async () => {
  const r = await ops.composeFile(path.join(engDir, 'b.ctd'), [{ offset: 7, ukText: 'Тисни {0xF1} зараз' }], path.join(outDir, 'b.ctd'), {});
  assert.equal(r.applied, 1);
  const re = parseCtd(fs.readFileSync(path.join(outDir, 'b.ctd')));
  assert.match(re.messages[0].text, /\{0xF1,0x30\}/);

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
  assert.ok(keys.includes('Press {0xF1} now'));
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
    'Press {0xF1} now': 'Тисни {0xF1} зараз'
  };
  const progress = [];
  const r = await ops.composeAll(FILES, { engDir, rusDir, outDir, tsvDir, glossary, safeMode: true, concurrency: 3, onProgress: p => progress.push(p) });
  assert.equal(r.skippedUnsafe, 1);
  assert.equal(r.written, 5);
  // Єдина «помилка» — попередження BBS про кирилицю без байт-мапінгу ('Так' → '???').
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].rel, 'b.ctd');
  assert.match(r.errors[0].samples[0].message, /без мапінгу/);
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
  assert.match(ctd.messages[0].text, /\{0xF1,0x30\}/);
});
