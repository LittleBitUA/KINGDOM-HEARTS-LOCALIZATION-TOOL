'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { nameTokens, rawTokens, DIALOG, MENU, VARS, DIALOG_FIXED } = require('../shared/kh1-tokens');
const codec = require('../shared/codec');

test('kh1-tokens: іменування команд діалогів і меню — зворотне до rawTokens', () => {
  const cases = [
    ['{0x03}', 'dialog', '{pause}'],
    ['{0x04}', 'dialog', '{page}'],
    ['{0x05,0x5A,0x00}', 'dialog', '{wait 90}'],
    ['{0x06,0x2C,0x01}', 'dialog', '{wait2 300}'],
    ['{0x0A,0x00,0x00,0x00}', 'dialog', '{line_spacing 0,0}'],
    ['{0x0B,0x00,0x04,0x00}', 'dialog', '{text_dx 4}'],
    ['{0x0B,0x01,0x14,0x00}', 'dialog', '{text_at 20}'],
    ['{0x0D,0x00,0x14,0x00}', 'dialog', '{text_speed 20}'],
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
  // Стисла 2-байтова форма 05/06/07/0x12 лишилась у перекладах, зроблених до
  // того, як розбір навчився рахувати довжини команд: читаємо її так само,
  // а назад пишемо канонічні 3 байти (саме стільки читає гра).
  assert.equal(nameTokens('{0x05,0x5A}', 'dialog'), '{wait 90}');
  assert.equal(nameTokens('{0x07,0x0C}', 'dialog'), '{yshift 12}');
  // Голий байт без параметра (так виглядали обрізані команди у старих ключах).
  assert.equal(nameTokens('{0x0B}', 'dialog'), '{text_x}');
  assert.equal(rawTokens('{text_x}'), '{0x0B}');
});

test('kh1-tokens: splitEdges зрізає службову обгортку сторінки', () => {
  const { splitEdges } = require('../shared/kh1-tokens');
  const r = splitEdges('{line_spacing 0,0}{yshift 12}{lf}Hey there, Donald.{wait 80}');
  assert.equal(r.body, 'Hey there, Donald.');
  assert.equal(r.prefix + r.body + r.suffix, '{line_spacing 0,0}{yshift 12}{lf}Hey there, Donald.{wait 80}');
  // Підстановки всередині тексту — НЕ обгортка, лишаються у тілі.
  const r2 = splitEdges('{yshift 12}{color_green}{item_name}{color_base}.{wait2 90}');
  assert.equal(r2.body, '{color_green}{item_name}{color_base}.');
  // Рядок без тексту — усе в префіксі, тіло порожнє.
  assert.equal(splitEdges('{text_size}{page}').body, '');
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
    [0x0C, 0x04, 0x0E, 0x01, 0x0C, 0xFF, 0x2E, 0x06, 0x3C, 0x00],    // Obtained {item}.{wait2 60}
    [0x0F, 0x62, 0x20, 0x41, 0x04, 0x0B, 0x00, 0x04, 0x00],           // {button b} A{page}{text_dx 4}
    [0x05, 0x5A, 0x00],
    [0x0A, 0x00, 0x00, 0x00, 0x07, 0x0C, 0x00, 0x41],
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

test('kh1-limits: межі буфера розкладки (384 гліфи / 32 рядки / 32 паузи) на сторінку', () => {
  const lim = require('../shared/kh1-limits');
  assert.equal(lim.LAYOUT_BUFFER, 0x1F18);
  assert.equal(lim.overflowIssue(codec.encode('Привіт, Соро!{lf}Як справи?{wait 90}{eol}')), null);
  // {page} ділить повідомлення на сторінки — кожна рахується окремо
  const stats = lim.pageStats(codec.encode('abc{page}defg{eol}'));
  assert.deepEqual(stats.map(p => p.glyphs), [3, 4]);
  const long = codec.encode('A'.repeat(500) + '{eol}');
  assert.match(String(lim.overflowIssue(long)), /задовга сторінка: 500 гліфів/);
  // дві сторінки по 250 — уже в межах
  assert.equal(lim.overflowIssue(codec.encode('A'.repeat(250) + '{page}' + 'B'.repeat(250) + '{eol}')), null);
  assert.match(String(lim.overflowIssue(codec.encode('x{lf}'.repeat(40) + '{eol}'))), /забагато рядків/);
});
