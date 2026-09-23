'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { nameTokens, rawTokens, DIALOG, MENU, VARS, DIALOG_FIXED } = require('../shared/kh1-tokens');
const codec = require('../shared/codec');

test('kh1-tokens: іменування команд діалогів і меню — зворотне до rawTokens', () => {
  const cases = [
    ['{0x03}', 'dialog', '{pause}'],
    ['{0x04}', 'dialog', '{page}'],
    ['{0x05,0x5A}', 'dialog', '{wait 90}'],
    ['{0x06,0x2C,0x01}', 'dialog', '{wait2 300}'],
    ['{0x07,0xEE,0xFF}', 'dialog', '{yshift -18}'],
    ['{0x09,0x08}', 'dialog', '{icon 8}'],
    ['{0x0C,0x14}', 'dialog', '{color 20}'],
    ['{0x0E,0x06}', 'dialog', '{summon_name}'],
    ['{0x0E,0x04}', 'dialog', '{ability_name}'],
    ['{0x0F,0x02}', 'dialog', '{rtl_on}'],
    ['{0x0F}b', 'dialog', '{button b}'],
    ['{0x08,0x96,0xF0,0xDC,0x80}', 'menu', '{rgba 96F0DC80}'],
    ['{0x0C,0x14}', 'menu', '{scale 20}'],
    ['{0x0D,0x04,0x00}', 'menu', '{dx 4}'],
    ['{0x0E,0xFD,0xFF}', 'menu', '{dy -3}'],
    ['{0x11,0x22,0x01}', 'menu', '{abs_x 290}']
  ];
  for (const [raw, dialect, named] of cases) {
    assert.equal(nameTokens(raw, dialect), named, raw + ' @' + dialect);
    assert.equal(rawTokens(named), raw, named);
  }
});

test('kh1-tokens: старі CamelCase-імена перейменовано, кодувальник розуміє обидві форми', () => {
  assert.equal(nameTokens('{VarItem}{ColorGreen}{Potion}', 'dialog'), '{item_name}{color_green}{icon_potion}');
  assert.equal(rawTokens('{item_name}{color_green}{icon_potion}'), '{VarItem}{ColorGreen}{Potion}');
  assert.deepEqual([...codec.encode('{item_name}')], [...codec.encode('{VarItem}')]);
  assert.deepEqual([...codec.encode('{color_green}Hi')], [...codec.encode('{ColorGreen}Hi')]);
});

test('kh1-tokens: імена в діалектах не перетинаються (кодувальник не знає діалекту)', () => {
  const names = new Map();
  const add = (name, bytes) => {
    const prev = names.get(name);
    if (prev) assert.deepEqual(prev, bytes, 'одне ім\'я — різні байти: ' + name);
    names.set(name, bytes);
  };
  for (const [b, d] of Object.entries(DIALOG)) add(d.name, [Number(b)]);
  for (const [b, d] of Object.entries(MENU)) add(d.name, [Number(b)]);
  for (const f of DIALOG_FIXED) add(f.name, f.bytes);
  for (const [n, name] of Object.entries(VARS)) add(name, [0x0E, Number(n)]);
  assert.ok(names.size > 30);
});

test('kh1-tokens: decode → encode лишається байт-у-байт на керівних послідовностях', () => {
  const samples = [
    [0x0C, 0x04, 0x0E, 0x01, 0x0C, 0xFF, 0x2E, 0x06, 0x3C],          // Obtained {item}.{wait2 60}
    [0x0F, 0x62, 0x20, 0x41, 0x04, 0x0B, 0x00],                       // {button b} A{page}{text_x}
    [0x05, 0x5A, 0x00],
    [0x07, 0xEE, 0xFF, 0x41]
  ];
  for (const s of samples) {
    const buf = Buffer.from(s);
    assert.deepEqual([...codec.encode(codec.decode(buf))], s, JSON.stringify(s));
  }
  const menu = Buffer.from([0x08, 0x96, 0xF0, 0xDC, 0x80, 0x0D, 0x04, 0x00, 0x41]);
  assert.deepEqual([...codec.encode(codec.decode(menu, { cmd: 'sysmsg' }))], [...menu]);
});

test('kh1-tokens: рядок лише з команд розкладки — не текст, підстановки — текст', () => {
  const { looksLikeText } = require('../tools/lib/text-quality');
  for (const junk of ['{page}{eol}', '{wait 12}{eol}', '{text_x}{eol}', '{text_width} {text_size}{eol}', '{scale 20}{dx 4}{eol}', '{0x0B}{eol}']) {
    assert.equal(looksLikeText(junk), false, junk);
  }
  for (const text of ['Donald,{wait 76}{eol}', '{color_green}{icon_key}{item_name}{color_base}.{wait2 90}{eol}', '{ColorGreen}{Potion}{VarItem}s{ColorBase}.', '{summon_name}{eol}', '{number_1}{eol}']) {
    assert.equal(looksLikeText(text), true, text);
  }
});
