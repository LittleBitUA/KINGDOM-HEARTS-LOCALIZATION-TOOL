'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const textall = require('../tools/lib/textall');
const ops = require('../tools/lib/translate-ops');
const synth = require('./helpers/synth');
const { parseCtd } = require('../tools/lib/ctd-format');

const SAMPLE = '\uFEFF### bbs_first.hed_out\\original\\message\\en\\event\\di\\CTdi400.ctd\r\n#0\r\nЦей світ занадто маленький.\r\n#1\r\nОсь, бачиш?\r\nПустий світ, ніби в\'язниця.\r\n#3\r\n\r\n\r\n### kh3d_first.hed_out\\original\\message\\en\\event\\rg\\bin\\ctrg300.ctd\r\n@0x0E968000\r\nHey!\r\n';

test('textall.parse handles BOM, CRLF, multi-line text, empty text and @0x ids', () => {
  const s = textall.parse(SAMPLE);
  assert.equal(s.length, 2);
  assert.equal(s[0].file, 'bbs_first.hed_out\\original\\message\\en\\event\\di\\CTdi400.ctd');
  assert.deepEqual(s[0].items, [
    { id: 0, text: 'Цей світ занадто маленький.' },
    { id: 1, text: 'Ось, бачиш?\nПустий світ, ніби в\'язниця.' },
    { id: 3, text: '' }
  ]);
  assert.deepEqual(s[1].items, [{ id: '0x0E968000', text: 'Hey!' }]);
});

test('textall.build → parse round-trip and python-style layout', () => {
  const secs = [{ file: 'a\\b.ctd', items: [{ id: 0, text: 'x' }, { id: 2, text: 'l1\nl2' }] }, { file: 'c.ctd', items: [{ id: '0x00000010', text: '' }] }];
  const built = textall.build(secs);
  assert.equal(built, '### a\\b.ctd\n#0\nx\n#2\nl1\nl2\n\n### c.ctd\n@0x00000010\n\n');
  assert.deepEqual(textall.parse(built), secs);
});

test('textall.parse rejects text outside a marker', () => {
  assert.throws(() => textall.parse('### f.ctd\nstray text\n'), /без маркера/);
});

test('textall.translatable mirrors the python heuristic', () => {
  assert.equal(textall.translatable(''), false);
  assert.equal(textall.translatable('{icon triangle}'), false);
  assert.equal(textall.translatable('123'), false);
  assert.equal(textall.translatable('Hi {icon a}'), true);
  assert.equal(textall.translatable('Привіт'), true);
});

test('textall.matchRel picks the unique longest suffix match', () => {
  const rels = ['event/di/CTdi400.ctd', 'event/dp/CTdi400.ctd', 'menu/CTmn100.ctd'];
  assert.equal(textall.matchRel('bbs_first.hed_out\\original\\message\\en\\event\\di\\CTdi400.ctd', rels), 'event/di/CTdi400.ctd');
  assert.equal(textall.matchRel('x\\CTmn100.ctd', rels), 'menu/CTmn100.ctd');
  assert.equal(textall.matchRel('x\\CTdi400.ctd', rels), null);        // неоднозначно
  assert.equal(textall.matchRel('nope.ctd', rels), null);
});

test('textall.pair joins EN and UK dumps by (file, id)', () => {
  const en = '### f.ctd\n#0\nHuh?\n#1\nGo\n';
  const uk = '### f.ctd\n#1\nЙди\n#0\nГа?\n';
  assert.deepEqual(textall.pair(textall.parse(en), textall.parse(uk)), [
    { file: 'f.ctd', id: 0, en: 'Huh?', uk: 'Га?' }, { file: 'f.ctd', id: 1, en: 'Go', uk: 'Йди' }
  ]);
});

test('exportTextAll → importTextAll round trip on synthetic BBS files (TSV + glossary)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-ta-'));
  const engDir = path.join(root, 'ENG', 'bbs_first.hed_out', 'original', 'message', 'en', 'event');
  const tsvDir = path.join(root, 'PROGRESS');
  fs.mkdirSync(engDir, { recursive: true });
  fs.writeFileSync(path.join(engDir, 'CTdi400.ctd'), synth.buildCtd([{ id: 1, text: 'This world is just too small.' }, { id: 2, text: '{icon triangle}' }, { id: 3, text: 'Hey, where am I?' }], 1));
  const files = ['bbs_first.hed_out/original/message/en/event/CTdi400.ctd'];
  const env = { engDir: path.join(root, 'ENG'), tsvDir, safeMode: true };

  const ex = await ops.exportTextAll(files, Object.assign({ glossary: { 'Hey, where am I?': 'Гей, де це я?' } }, env));
  assert.equal(ex.lines, 2);       // {icon triangle} — неперекладний, пропущено
  assert.match(ex.content, /^### bbs_first\.hed_out\\original\\message\\en\\event\\CTdi400\.ctd\n#0\nThis world is just too small\.\n#2\nГей, де це я\?\n$/);

  const ua = '### bbs_first.hed_out\\original\\message\\en\\event\\CTdi400.ctd\n#0\nЦей світ занадто маленький.\n#2\nHey, where am I?\n#9\nx\n';
  const im = await ops.importTextAll(ua, files, env);
  assert.equal(im.matchedFiles, 1);
  assert.equal(im.applied, 1);
  assert.equal(im.sameAsEn, 1);
  assert.equal(im.missingIds, 1);
  assert.equal(im.tsvWritten, 1);
  assert.deepEqual({ ...im.glossary }, { 'This world is just too small.': 'Цей світ занадто маленький.' });
  const tsvText = fs.readFileSync(path.join(tsvDir, files[0] + '.tsv'), 'utf8');
  assert.match(tsvText, /Цей світ занадто маленький\./);

  // composeAll бачить override з TSV і збирає файл з кирилицею на 0x83xx
  const outDir = path.join(root, 'DONE');
  const r = await ops.composeAll(files, Object.assign({ outDir, glossary: {}, useTsvOverrides: true }, env));
  assert.equal(r.written, 1);
  assert.deepEqual(r.errors, []);
  const re = parseCtd(fs.readFileSync(path.join(outDir, files[0])));
  assert.equal(re.messages[0].text, 'Цей світ занадто маленький.');
  fs.rmSync(root, { recursive: true, force: true });
});

test('importTextAllPair (Re:CoM text_uniq + text_ua) builds a glossary', () => {
  const en = '### remastered\\FORM\\0008\\FO0008.CTD\\UK_CT0016.ctdl\n#0\nTo the left\n#1\nTo the right\n';
  const uk = '### remastered\\FORM\\0008\\FO0008.CTD\\UK_CT0016.ctdl\n#0\nЛіворуч\n#1\nTo the right\n';
  const r = ops.importTextAllPair(en, uk);
  assert.equal(r.pairs, 2);
  assert.equal(r.translated, 1);
  assert.deepEqual({ ...r.glossary }, { 'To the left': 'Ліворуч' });
});

// Реальні файли з набору користувача (якщо є на цій машині) — парсер має
// прочитати їх без помилок і з тією ж кількістю записів, що й Python.
const TK = 'C:/Users/bidlov/Downloads/Telegram Desktop/DropDistanceHD';
test('real ua_all_text.txt (BBS) parses: 116 files, 8438 items', { skip: !fs.existsSync(path.join(TK, 'BBS', 'ua_all_text.txt')) }, () => {
  const s = textall.parse(fs.readFileSync(path.join(TK, 'BBS', 'ua_all_text.txt'), 'utf8'));
  assert.equal(s.length, 116);
  assert.equal(s.reduce((a, x) => a + x.items.length, 0), 8438);
});
