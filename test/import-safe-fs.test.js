'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const imp = require('../tools/lib/import-translations');
const { writeFileAtomic, writeFileAtomicSync } = require('../shared/safe-fs');
const glossary = require('../tools/lib/glossary');

// ======================= import-translations =======================

test('csvRows handles quotes, embedded commas and newlines', () => {
  const rows = imp.csvRows('a,"b, c","say ""hi"""\r\nx,y,z\n');
  assert.deepEqual(rows, [['a', 'b, c', 'say "hi"'], ['x', 'y', 'z']]);
});

test('htmlRows strips tags, decodes entities and converts <br> to line breaks', () => {
  const html = '<table><tr><td>Hello&nbsp;<b>World</b></td><td>Привіт<br/>Світ</td></tr></table>';
  const rows = imp.htmlRows(html);
  assert.deepEqual(rows, [['Hello World', 'Привіт\nСвіт']]);
});

test('rowsToPairs: KH1 mode converts newlines/¶ to {lf} and OpenKh escapes to {0xNN}', () => {
  const pairs = imp.rowsToPairs([['Line one¶Line two{:unk 6}', 'Рядок один\nРядок два{:unk 6}']], {});
  assert.deepEqual(pairs, [{ en: 'Line one{lf}Line two{0x06}', uk: 'Рядок один{lf}Рядок два{0x06}' }]);
});

test('rowsToPairs: BBS mode keeps native newlines', () => {
  const pairs = imp.rowsToPairs([['p', 'A¶B', 'Х\nY']], { enCol: 1, ukCol: 2, lineBreakToken: null });
  assert.deepEqual(pairs, [{ en: 'A\nB', uk: 'Х\nY' }]);
});

test('importFile auto-detects header row and format by content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-imp-'));
  const p = path.join(dir, 'x.txt');
  fs.writeFileSync(p, 'English\tПереклад\nPotion\tЗілля\nEther\tЕфір\n');
  const r = imp.importFile(p, {});
  assert.equal(r.format, 'tsv');
  assert.equal(r.headerRows, 1);
  assert.deepEqual(r.pairs, [{ en: 'Potion', uk: 'Зілля' }, { en: 'Ether', uk: 'Ефір' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ======================= safe-fs / glossary =======================

test('writeFileAtomic writes content, leaves no tmp files and rotates backups', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-fs-'));
  const p = path.join(dir, 'sub', 'f.txt');
  await writeFileAtomic(p, 'v1', { encoding: 'utf8', backups: 2 });
  await writeFileAtomic(p, 'v2', { encoding: 'utf8', backups: 2 });
  await writeFileAtomic(p, 'v3', { encoding: 'utf8', backups: 2 });
  assert.equal(fs.readFileSync(p, 'utf8'), 'v3');
  assert.equal(fs.readFileSync(p + '.bak.1', 'utf8'), 'v2');
  assert.equal(fs.readFileSync(p + '.bak.2', 'utf8'), 'v1');
  assert.equal(fs.existsSync(p + '.bak.3'), false);
  assert.ok(!fs.readdirSync(path.dirname(p)).some(n => n.includes('.tmp-')));
  writeFileAtomicSync(p, 'v4', { encoding: 'utf8' });
  assert.equal(fs.readFileSync(p, 'utf8'), 'v4');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('glossary save/read round-trip with backups', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-gl-'));
  glossary.saveGlossary(dir, { Potion: 'Зілля' });
  glossary.saveGlossary(dir, { Potion: 'Зілля', Ether: 'Ефір' });
  assert.deepEqual(glossary.readGlossary(dir), { Potion: 'Зілля', Ether: 'Ефір' });
  assert.ok(fs.existsSync(glossary.glossaryPath(dir) + '.bak.1'));
  assert.deepEqual(glossary.readGlossary(path.join(dir, 'nope')), {});
  fs.rmSync(dir, { recursive: true, force: true });
});
