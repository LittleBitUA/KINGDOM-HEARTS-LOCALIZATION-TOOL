'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const tsv = require('../shared/tsv');
const ts = require('../shared/text-structure');

// ======================= tsv =======================

test('tsv: build → parse round-trip incl. tabs, newlines and backslashes', () => {
  const slots = [
    { index: 0, offset: 0x1A, byteLen: 5, english: 'Hello{lf}World', ukText: 'Прив\tіт\nСвіте' },
    { index: 1, offset: 0x30, byteLen: 3, english: 'C:\\path', ukText: '' }
  ];
  const content = tsv.build(slots);
  assert.equal(content.split('\n')[0], 'index\toffset\tbytes\tenglish\tukrainian');
  const { rows } = tsv.parse(content);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].offset, 0x1A);
  assert.equal(rows[0].ukrainian, 'Прив\tіт\nСвіте');
  assert.equal(rows[1].english, 'C:\\path');
});

test('tsv: legacy files (unescaped backslash) still read the same', () => {
  const legacy = 'index\toffset\tbytes\tenglish\tukrainian\n0\t0x0010\t4\tA\\nB\tА\\nБ\n';
  const map = tsv.overridesByOffset(legacy);
  assert.equal(map.get(0x10), 'А\nБ');
});

test('tsv: overridesByOffset ignores empty translations and non-TSV input', () => {
  const c = 'index\toffset\tbytes\tenglish\tukrainian\n0\t0x0010\t4\tA\t\n1\t0x0020\t4\tB\tБ\n';
  const map = tsv.overridesByOffset(c);
  assert.equal(map.size, 1);
  assert.equal(map.get(0x20), 'Б');
  assert.equal(tsv.overridesByOffset('just text'), null);
});

// ======================= text-structure =======================

test('preserveStructure restores leading/trailing whitespace from EN', () => {
  assert.equal(ts.preserveStructure('  Potion ', 'Зілля'), '  Зілля ');
  assert.equal(ts.preserveStructure('  Potion ', ' Зілля  '), ' Зілля  ');
  assert.equal(ts.preserveStructure('Potion', ''), '');
});

test('validateTokens ignores {lf} but catches missing/extra control tokens', () => {
  assert.equal(ts.validateTokens('A{lf}B{lf}C', 'А Б В').ok, true);
  const v = ts.validateTokens('{ColorRed}Hi{0x06}{0x06}', '{ColorRed}Привіт{0x06}{VarItem}');
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, [{ token: '{0x06}', expected: 2, got: 1 }]);
  assert.deepEqual(v.extra, [{ token: '{VarItem}', count: 1 }]);
  assert.match(ts.tokenIssueText('{0x06}{0x06}', '{0x06}'), /Missing: \{0x06\}×1/);
});

test('autoFixStructure rebuilds UK on the EN skeleton', () => {
  assert.equal(ts.autoFixStructure('{0x08} Obtained {VarItem}.{0x06}', 'Отримано'), '{0x08} Отримано {VarItem}.{0x06}');
  assert.equal(ts.autoFixStructure('A{lf}B', 'Х Y'), null);           // 2 letters segments vs 1
  assert.equal(ts.autoFixStructure('A{lf}B', 'Х{lf}Y{lf}Z'), null);   // more in UK
  assert.equal(ts.autoFixStructure('A{lf}B', 'Х{lf}Y'), 'Х{lf}Y');
});

test('syncPaddingFromEn copies per-line padding; null when line counts differ', () => {
  assert.equal(ts.syncPaddingFromEn('  A{lf}B  ', 'А{lf}Б'), '  А{lf}Б  ');
  assert.equal(ts.syncPaddingFromEn('  A{lf}B', 'А'), null);
  assert.equal(ts.syncPaddingFromEn('A', 'А'), null);
});

test('segmentByTokens splits text/token and tolerates unclosed brace', () => {
  assert.deepEqual(ts.segmentByTokens('a{x}b{'), [
    { type: 'text', value: 'a' }, { type: 'token', value: '{x}' }, { type: 'text', value: 'b{' }
  ]);
});
