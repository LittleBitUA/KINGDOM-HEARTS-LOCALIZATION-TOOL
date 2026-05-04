'use strict';

// Synthetic round-trip test для Re:CoM CTDL parser/composer.
// Створюємо мінімальний валідний CTDL-buffer вручну, прогоняємо через
// parseCtdl → composeCtdl, і перевіряємо байт-ідентичність.
// Окремо тестуємо codec на різноманітті символів.

const codec = require('./lib/recom-ctdl-codec');
const fmt = require('./lib/recom-ctdl-format');

// ---- 1. Codec round-trip -----------------------------------------------

const codecCases = [
  'Hello world!',
  'Sora\nDonald\nGoofy',
  'Press {BTN_A} to attack.',
  'Use {BTN_LEFTRIGHT} and {BTN_UPDOWN}',
  'Café — naïve résumé',                  // Latin Extended via 0x99
  'L\'Œil ßeta © 2026',
  '<EMPTYBLOCK>',
  '<Unk41> mid <Unk59>',
  'Mix: {BTN_A} + Café\n{BTN_DPAD}',
  '<7F>raw byte<80>'
];

let codecOk = 0, codecFail = 0;
for (const orig of codecCases) {
  const enc = codec.encode(orig);
  const dec = codec.decode(enc);
  // Re-encode must be stable
  const enc2 = codec.encode(dec);
  const ok = enc.equals(enc2);
  if (ok) codecOk++; else codecFail++;
  console.log(ok ? 'OK ' : 'FAIL',
    'orig=', JSON.stringify(orig),
    'enc=', enc.toString('hex'),
    'dec=', JSON.stringify(dec));
  if (!ok) console.log('  enc2=', enc2.toString('hex'));
}
console.log(`Codec: ${codecOk}/${codecCases.length} stable round-trips`);

// ---- 2. Format round-trip ----------------------------------------------

// Будуємо synthetic CTDL з 1 textbox і 3 текстовими entry.
function buildSynth() {
  const texts = [
    codec.encode('Hello'),
    codec.encode('Sora\nDonald'),
    codec.encode('Press {BTN_A}\nfor menu.')
  ];
  const headerSize = 0x10;
  const textboxCount = 1;
  const textboxSize = textboxCount * 48;
  // Pointer table йде одразу після textboxes (без padding для простоти).
  const ptOff = headerSize + textboxSize;
  const ptSize = texts.length * 4;
  const blockBase = ptOff + ptSize;
  const textBlockSize = texts.reduce((s, t) => s + t.length + 1, 0);
  const total = blockBase + textBlockSize;

  const buf = Buffer.alloc(total);
  // Header
  buf.writeUInt32LE(fmt.MAGIC, 0x00);
  buf.writeUInt16LE(textboxCount, 0x04);
  buf.writeUInt16LE(texts.length, 0x06);
  buf.writeUInt32LE(ptOff, 0x08);
  buf.writeUInt32LE(blockBase, 0x0C);

  // Textbox 0 (мінімально валідний)
  const off = headerSize;
  buf.writeUInt16LE(0, off + 0x00);              // entryIndex
  buf[off + 0x02] = 0x04; buf[off + 0x03] = 0x50; // textboxActivate=0x0450 (BE)
  // colors
  buf[off + 0x04] = 0xFF; buf[off + 0x05] = 0xFF; buf[off + 0x06] = 0xFF; buf[off + 0x07] = 0xFF;
  buf[off + 0x08] = 0x00; buf[off + 0x09] = 0x00; buf[off + 0x0A] = 0x00; buf[off + 0x0B] = 0xFF;
  buf[off + 0x0C] = 0xFF; buf[off + 0x0D] = 0xFF; buf[off + 0x0E] = 0xFF; buf[off + 0x0F] = 0xFF;
  buf.writeUInt32LE(0, off + 0x10);              // textEntryIndex = 0
  buf[off + 0x14] = 0x01;                        // textActivate
  buf[off + 0x15] = 0x00;
  buf.writeUInt16LE(120, off + 0x16);            // PosX
  buf.writeUInt16LE(80,  off + 0x18);            // PosY
  buf.writeUInt16LE(400, off + 0x1A);            // Width
  buf.writeUInt16LE(80,  off + 0x1C);            // Height
  buf[off + 0x1E] = 0x00;
  buf[off + 0x1F] = 0x00;
  buf[off + 0x20] = 0x02;
  buf[off + 0x21] = 0x00;
  buf.writeUInt16LE(22, off + 0x22);
  buf.writeUInt16LE(0xFFFF, off + 0x24);         // separator
  // reserved 6 байт лишається 0
  buf[off + 0x2C] = 0x00; buf[off + 0x2D] = 0x00; // speechmarkTurn (BE)
  buf[off + 0x2E] = 0x00; buf[off + 0x2F] = 0x00; // speechmarkPosition (BE)

  // Pointer table
  let cur = blockBase;
  for (let i = 0; i < texts.length; i++) {
    buf.writeUInt32LE(cur - blockBase, ptOff + i * 4);
    cur += texts[i].length + 1;
  }
  // Text-block
  cur = blockBase;
  for (const t of texts) {
    t.copy(buf, cur);
    cur += t.length;
    buf[cur] = 0x00;
    cur++;
  }
  return buf;
}

const orig = buildSynth();
console.log(`\nSynthetic file: ${orig.length} bytes, magic = ${orig.slice(0,4).toString('ascii')}`);

const parsed = fmt.parseCtdl(orig);
console.log('Parsed:');
console.log(`  textboxes: ${parsed.textboxes.length}, entries: ${parsed.entries.length}`);
parsed.entries.forEach(e => {
  console.log(`  [${e.index}] absOff=0x${e.absoluteOffset.toString(16)} len=${e.originalLength} text=${JSON.stringify(e.text)}`);
});

// 2a. Identity compose (no replacements)
const recomposed = fmt.composeCtdl(parsed);
const same = orig.equals(recomposed);
console.log(`\nIdentity round-trip: ${same ? 'OK (byte-identical)' : 'FAIL (' + orig.length + ' vs ' + recomposed.length + ')'}`);

// 2b. In-place edit (shorter or equal length)
const shortReplace = new Map([[0, 'Hi']]);   // shorter than 'Hello'
const inPlace = fmt.composeCtdl(parsed, shortReplace);
console.log(`\nIn-place shorter edit: ${inPlace.length === orig.length ? 'OK same size' : 'WRONG size diff'}`);
const reparsed1 = fmt.parseCtdl(inPlace);
console.log(`  entry 0 after edit: ${JSON.stringify(reparsed1.entries[0].text)}`);

// 2c. Rebuild edit (longer)
const longReplace = new Map([[1, 'Sora\nDonald\nGoofy and Pluto']]); // grows
const rebuilt = fmt.composeCtdl(parsed, longReplace);
console.log(`\nRebuild longer edit: original=${orig.length}, rebuilt=${rebuilt.length} (grew by ${rebuilt.length - orig.length})`);
const reparsed2 = fmt.parseCtdl(rebuilt);
console.log(`  entry 1 after grow: ${JSON.stringify(reparsed2.entries[1].text)}`);
console.log(`  entry 0 (untouched): ${JSON.stringify(reparsed2.entries[0].text)}`);
console.log(`  entry 2 (untouched): ${JSON.stringify(reparsed2.entries[2].text)}`);
const allEqual = parsed.entries.every((e, i) => {
  if (longReplace.has(i)) return reparsed2.entries[i].text === longReplace.get(i);
  return reparsed2.entries[i].text === e.text;
});
console.log(`  all texts preserved: ${allEqual ? 'OK' : 'FAIL'}`);
