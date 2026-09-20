'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../shared/codec');

test('encode/decode round-trip for plain English', () => {
  const s = 'Sora, Donald and Goofy went to Traverse Town.';
  const bytes = codec.encode(s);
  assert.equal(codec.decode(bytes), s);
});

test('Latin never decodes as Cyrillic look-alikes', () => {
  const s = 'Potion Hi-Potion Ether';
  const dec = codec.decode(codec.encode(s));
  assert.equal(dec, s);
  assert.doesNotMatch(dec, /[Ѐ-ӿ]/);
});

test('Ukrainian round-trips exactly through native 19 NN codes', () => {
  const uk = 'Сора та Дональд пішли до міста.';
  const bytes = codec.encode(uk);
  assert.equal(codec.decode(bytes), uk);
  // кожна кирилична літера — 2 байти, латиниця/пунктуація — 1
  assert.equal(bytes.length, [...uk].reduce((n, ch) => n + (/[А-Яа-яІіЇїЄєҐґ]/.test(ch) ? 2 : 1), 0));
});

test('Cyrillic look-alikes are separate glyphs (not Latin bytes); hybrid shares them', () => {
  assert.notDeepEqual([...codec.encode('А')], [...codec.encode('A')]);
  assert.deepEqual([...codec.encode('А', { hybrid: true })], [...codec.encode('A')]);
  assert.deepEqual([...codec.encode('о', { hybrid: true })], [...codec.encode('o')]);
});
test('{eol} followed by newline collapses into a single terminator byte', () => {
  const a = codec.encode('Hi{eol}\nThere{eol}');
  const b = codec.encode('Hi{eol}There{eol}');
  assert.deepEqual([...a], [...b]);
});

test('decode appends newline after {eol} and encode strips it (idempotent)', () => {
  const bytes = codec.encode('One{eol}Two{eol}');
  const text = codec.decode(bytes);
  assert.equal(text, 'One{eol}\nTwo{eol}\n');
  assert.deepEqual([...codec.encode(text)], [...bytes]);
});

test('unknown 2-byte prefix command is kept as a single {0xAA,0xBB} token', () => {
  // 0x0C (колір) має 1-байтовий параметр — далі йде текст.
  const bytes = Buffer.from([0x0C, 0x3C, ...codec.encode('R')]);
  const text = codec.decode(bytes);
  assert.match(text, /^\{0x0C,0x3C\}R$/);
  assert.deepEqual([...codec.encode(text)], [...bytes]);
});

test('05/06/07 carry a u16 parameter: high byte joins the token when non-zero', () => {
  // 0x012C = 300 — старший байт 0x01 раніше показувався як «пробіл» і губився.
  const bytes = Buffer.from([...codec.encode('Hi'), 0x06, 0x2C, 0x01]);
  const text = codec.decode(bytes);
  assert.equal(text, 'Hi{0x06,0x2C,0x01}');
  assert.deepEqual([...codec.encode(text)], [...bytes]);
  // Старший байт 0x00 — у 0x00-розбитих слотах він є термінатором, токен лишається 2-байтовим.
  const short = Buffer.from([0x05, 0x6E]);
  assert.equal(codec.decode(short), '{0x05,0x6E}');
  // Цілий буфер із 0x00 після параметра: 00 лишається окремим {eol}.
  const whole = Buffer.from([0x05, 0x6E, 0x00]);
  assert.equal(codec.decode(whole), '{0x05,0x6E}{eol}\n');
  assert.deepEqual([...codec.encode('{0x05,0x6E}{eol}\n')], [...whole]);
  // Сирі hex-токени довільної довжини.
  assert.deepEqual([...codec.encode('{0x0A,0x00,0x00,0x01}')], [0x0A, 0x00, 0x00, 0x01]);
});

test('known 2-byte token from kh1sys_multi round-trips', () => {
  const { multiMap } = codec.load();
  const [combo, token] = multiMap.entries().next().value;
  const bytes = Buffer.from([combo >> 8, combo & 0xFF]);
  assert.equal(codec.decode(bytes), token);
  assert.deepEqual([...codec.encode(token)], [...bytes]);
});

test('raw {0xNN} escapes encode to the byte and unknown bytes decode to escapes', () => {
  assert.deepEqual([...codec.encode('{0xFE}')], [0xFE]);
  assert.deepEqual([...codec.encode('{0x7B,0x7D}')], [0x7B, 0x7D]);
  const dec = codec.decode(Buffer.from([0xFE]));
  assert.match(dec, /^\{0x[0-9A-F]{2}\}$|^.$/); // або escape, або якщо мапа має гліф
});

test('encode error lists every unmappable character, not only the first', () => {
  assert.throws(
    () => codec.encode('a ∑ b \u{1F600} c ∑'),
    (e) => {
      assert.match(e.message, /∑/);
      assert.match(e.message, /😀/);
      assert.equal(e.unmapped.length, 3);
      return true;
    }
  );
});

test('lenient encode substitutes ? and reports unmapped', () => {
  const r = codec.encodeDetailed('a∑b', { lenient: true });
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.bytes[1], 0x3F);
  assert.equal(r.bytes.length, 3);
});

test('token aliases (Pro100luk-style names) encode to the same bytes as canonical', () => {
  const multi = require('../data/kh1sys_multi.json');
  const aliases = multi.encodeAliases || {};
  let checked = 0;
  for (const [alias, bytes] of Object.entries(aliases)) {
    if (alias.startsWith('_')) continue;
    assert.deepEqual([...codec.encode(alias)], bytes.map(b => b & 0xFF), alias);
    checked++;
  }
  assert.ok(checked > 0, 'kh1sys_multi.json has encodeAliases');
  // Канонічна назва завжди перемагає при decode.
  for (const [token, pair] of Object.entries(multi)) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    assert.equal(codec.decode(Buffer.from(pair)), token);
  }
});

test('encodeAliases (typographic dashes/quotes) map to existing font cells', () => {
  // kh1sys_multi.json encodeAliases: – ‒ − ʼ ‘ ’ “ ” « »
  for (const ch of ['–', '’', '«', '»']) {
    assert.doesNotThrow(() => codec.encode(ch), ch);
  }
  assert.deepEqual([...codec.encode('«ключ»')], [252, 0x19, 0x2F, 0x19, 0x30, 0x19, 0x40, 0x19, 0x3C, 251]);
});

test('native map: Cyrillic ↔ 19 NN glyph codes, Latin stays Latin, unknown 19 NN decodes as a raw token', () => {
  const map = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'kh1_native.json'), 'utf8'));
  const UA = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя';
  assert.equal(Object.keys(map.map).length, 66);
  // мапа детермінована: літера i → індекс 224+i → 19 (i)
  for (let i = 0; i < UA.length; i++) assert.deepEqual(map.map[UA[i]], [0x19, i]);

  const text = 'Привіт, Sora! Ґудзик {ColorRed}A{ColorBase}';
  const nat = codec.encode(text);
  assert.deepEqual([...nat.subarray(0, 4)], [0x19, 0x13, 0x19, 0x35]);            // П р
  assert.equal(codec.decode(nat), text);                                           // без втрат
  assert.deepEqual([...codec.encode('Ї')], [0x19, 0x0C]);
  // hybrid: А/В/С/Е… — 1 байт латинського гліфа; решта — 19 NN
  const hyb = codec.encode('САД', { hybrid: true });
  assert.deepEqual([...hyb], [...codec.encode('CA'), 0x19, 0x05]);
  // код поза картою — сирий токен, а не «з'їдений» байт
  assert.equal(codec.decode(Buffer.from([0x19, 0x6F, 0x19, 0x00])), '{0x19,0x6F}А');
});

test('native map: a custom map (generator output with extra letters) overrides the built-in one', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-native-map-'));
  const file = path.join(dir, 'kh1-native-map.json');
  try {
    // Без файла — статична карта: Ё невідома.
    codec.setNativeMapPath(file);
    assert.equal(codec.loadNative().source, 'static');
    assert.equal(codec.loadNative().encodeMap.has('Ё'), false);
    // З файлом — беремо його: українські коди ті самі, Ё → 19 42.
    const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kh1_native.json'), 'utf8'));
    base.map['Ё'] = [0x19, 0x42];
    fs.writeFileSync(file, JSON.stringify(base));
    const nat = codec.loadNative();
    assert.equal(nat.source, 'custom');
    assert.deepEqual(nat.encodeMap.get('Ё'), [0x19, 0x42]);
    assert.deepEqual(nat.encodeMap.get('А'), [0x19, 0x00]);
    const enc = codec.encode('Ё');
    assert.deepEqual([...enc], [0x19, 0x42]);
    assert.equal(codec.decode(Buffer.from([0x19, 0x42, 0x19, 0x00])), 'ЁА');
  } finally {
    codec.setNativeMapPath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(codec.loadNative().source, 'static');
});
