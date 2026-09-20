'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ES-модуль renderer'а без DOM-залежностей — імпортуємо динамічно.
const mod = () => import('../renderer/translate/glossary-txt-mgs.js');

test('MGS txt: build lists every entry with file/xK header, translation or original below; parse skips untranslated', async () => {
  const { buildGlossaryTxtMgs, parseGlossaryTxtMgs, looksLikeMgsTxt } = await mod();
  const entries = [
    { english: 'What?', count: 6, fileCount: 2, occurrences: [{ rel: 'message/en/ev_001.ctd' }] },
    { english: 'Two\nlines · here', count: 1, fileCount: 1, occurrences: [{ rel: 'message/en/sys.ctd' }] },
    { english: 'Untouched', count: 1, fileCount: 1, occurrences: [{ rel: 'a.ctd' }] }
  ];
  const txt = buildGlossaryTxtMgs(entries, { 'What?': 'Що?', 'Two\nlines · here': 'Два\nрядки · тут' }, 'KH BBS');
  assert.ok(looksLikeMgsTxt(txt));
  assert.match(txt, /^### 1 {2}— ev_001\.ctd \+1 · x6 · What\?\nЩо\?\n$/m);
  assert.match(txt, /^### 2 {2}— sys\.ctd · Two⏎lines · here\nДва\nрядки · тут\n$/m);
  assert.match(txt, /^### 3 {2}— a\.ctd · Untouched\nUntouched\n$/m);
  const parsed = parseGlossaryTxtMgs(txt);
  assert.equal(parsed.total, 3);
  assert.deepEqual(parsed.pairs, [{ en: 'What?', uk: 'Що?' }, { en: 'Two\nlines · here', uk: 'Два\nрядки · тут' }]);
});

test('MGS txt: append adds only missing entries, numbering continues', async () => {
  const { buildGlossaryTxtMgs, buildGlossaryTxtMgsAppend, parseGlossaryTxtMgs } = await mod();
  const e1 = { english: 'Yes', count: 2, fileCount: 1, occurrences: [{ rel: 'a.ctd' }] };
  const e2 = { english: 'No', count: 1, fileCount: 1, occurrences: [{ rel: 'a.ctd' }] };
  const existing = buildGlossaryTxtMgs([e1], { Yes: 'Так' }, 'G');
  const r = buildGlossaryTxtMgsAppend(existing, [e1, e2], { Yes: 'Так' });
  assert.equal(r.added, 1);
  assert.match(r.content, /### 2 {2}— a\.ctd · No\nNo\n/);
  assert.equal(parseGlossaryTxtMgs(r.content, { keepSame: true }).pairs.length, 2);
  assert.equal(buildGlossaryTxtMgsAppend(r.content, [e1, e2], {}).added, 0);
});
