'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ctdlFmt = require('../tools/lib/recom-ctdl-format');
const layout = require('../tools/lib/recom-ctdl-layout');
const { buildCtdl } = require('./helpers/synth');
const ctdlHandler = require('../tools/lib/formats/ctdl');
const ops = require('../tools/lib/translate-ops');

// ======================= Re:CoM макети (хмаринки) =======================

test('recom-layout: readLayout / writeLayout / applyLayoutOverrides by msgId', () => {
  const p = ctdlFmt.parseCtdl(buildCtdl());
  const L = layout.readLayout(p.layouts[0]);
  assert.deepEqual([L.msgId, L.count, L.x, L.y, L.w, L.h, L.lineHeight], [0, 1, 120, 80, 400, 80, 22]);

  const copy = Object.assign({}, p, { layouts: p.layouts.map(l => Buffer.from(l)) });
  assert.equal(layout.applyLayoutOverrides(copy, { 5: { w: 1 } }), 0);       // нема макета з таким id
  assert.equal(layout.applyLayoutOverrides(copy, { '0': { x: 10, w: 460, h: 96 } }), 1);
  const L2 = layout.readLayout(copy.layouts[0]);
  assert.deepEqual([L2.x, L2.y, L2.w, L2.h], [10, 80, 460, 96]);
  assert.equal(layout.readLayout(p.layouts[0]).w, 400);                       // оригінал не зачеплено
  // решта запису (кольори, стиль, id) — без змін
  assert.deepEqual([...copy.layouts[0].subarray(0, 0x16)], [...p.layouts[0].subarray(0, 0x16)]);
  assert.deepEqual([...copy.layouts[0].subarray(0x1E)], [...p.layouts[0].subarray(0x1E)]);
});

test('recom-layout: lineWidths counts glyph advances per line, icons and colors', () => {
  // мінімальний «шрифт»: 0x20..0x7F → гліфи 0..95 (ширина = 10), кирилиця 0x82C0 (а) → гліф 224+0xC0 = 416
  const map = []; for (let i = 0; i < 6816; i++) map.push(i);
  const widths = new Array(6816).fill(10); widths[224 + 0xC0] = 7; widths[0] = 4;
  const font = { count: 6816, widths, map, line: 26 };
  const bytes = Buffer.from([0x41, 0x42, 0x20, 0x0A, 0xF9, 0x43, 0x82, 0xC0, 0xF5, 0x66]);   // "AB " / {color 43}а{icon 66}
  assert.deepEqual(layout.lineWidths(bytes, font, 26), [24, 33]);
});

test('recom-layout: suggestGeometry keeps original padding, centre and screen bounds', () => {
  const L = { x: 219, y: 76, w: 250, h: 52, lineHeight: 22 };
  const en = [278, 302], uk = [407, 540];                                     // одиниці .binl
  const s = layout.suggestGeometry(L, en, uk);
  const padEn = 250 - 302 * layout.UNIT_PX;
  const wantW = Math.ceil(540 * layout.UNIT_PX + padEn);
  assert.equal(s.w, wantW + (wantW & 1));                                     // до парного, як CTextWnd
  assert.equal(s.h, 52);
  assert.equal(s.x, Math.min(layout.SCREEN_W - 8 - s.w, Math.round(219 + (250 - s.w) / 2)));   // центр, але в межах екрана
  assert.equal(s.y, 76);
  // коротший текст — не звужуємо
  assert.equal(layout.suggestGeometry(L, en, [100]).w, 250);
  // не виходимо за екран
  const wide = layout.suggestGeometry({ x: 400, y: 400, w: 100, h: 30, lineHeight: 22 }, [100], [900, 900, 900]);
  assert.ok(wide.x >= 8 && wide.x + wide.w <= layout.SCREEN_W - 8);
  assert.ok(wide.y + wide.h <= layout.SCREEN_H - 4);
});

test('ctdl handler: compose applies layout overrides even without translations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-bb-'));
  const eng = path.join(dir, 'ENG'), out = path.join(dir, 'DONE');
  fs.mkdirSync(path.join(eng, 'remastered', 'X'), { recursive: true });
  const rel = 'remastered/X/UK_CT0001.ctdl';
  fs.writeFileSync(path.join(eng, rel), buildCtdl());

  const parsed = await ctdlHandler.parse(path.join(eng, rel));
  const r = await parsed.compose(new Map(), { layouts: { 0: { w: 480, x: 16 } } });
  assert.equal(r.extra.ctdl.layoutsChanged, 1);
  const re = ctdlFmt.parseCtdl(r.outputs[0].buf);
  assert.equal(layout.readLayout(re.layouts[0]).w, 480);
  assert.equal(re.entries[0].text, 'Hello');

  // через composeOneFile: env.layouts[rel] → файл записано і статус ok
  const res = await ops.composeOneFile(rel, { engDir: eng, outDir: out, glossary: {}, safeMode: true, layouts: { [rel]: { 0: { w: 333 } } } });
  assert.equal(res.status, 'ok');
  const written = ctdlFmt.parseCtdl(fs.readFileSync(path.join(out, rel)));
  assert.equal(layout.readLayout(written.layouts[0]).w, 333);
  // без overrides і без перекладів — як раніше, no-translations
  const res2 = await ops.composeOneFile(rel, { engDir: eng, outDir: out, glossary: {}, safeMode: true });
  assert.equal(res2.status, 'no-translations');
  fs.rmSync(dir, { recursive: true, force: true });
});
