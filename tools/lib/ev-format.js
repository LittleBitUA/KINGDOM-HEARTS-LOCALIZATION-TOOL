'use strict';

// =====================================================================
// KH1 .ev / .evdl event-script container format.
//
// Layout (Little-Endian):
//   0x00..0x0B  — three uint32 counts (c1, c2, c3) — meta.
//   0x0C        — uint32 textOffset (start of text block).
//   0x10..textOffset  — array of uint32 pointers (header relocations).
//   textOffset..footerOffset  — text block: concatenated null-terminated
//                                strings (KH1 codec).
//   footerOffset..fileEnd     — footer (script bytecode / other data).
//
// footerOffset is computed as min(ptr) where ptr > textOffset (looking at
// every uint32 in the header pointer table). Pointers that are >= footer
// reference DATA INSIDE FOOTER and need to be RELOCATED by +sizeDiff when
// text length changes. Pointers >= textOffset && < footerOffset point INTO
// text (rare in this format but possible) and are NOT relocated by this
// algorithm (assumes text-block is treated as a unit).
//
// Compose algorithm:
//   1) Encode each UK slot + 0x00 terminator. Concatenate sequentially.
//   2) Pad with 0x00 so total newText.length % 4 == 0 (KH1 alignment).
//   3) sizeDiff = newText.length - oldTextLength.
//   4) For each header pointer >= oldFooterOffset → +sizeDiff.
//   5) Final = updatedHeader + newText + originalFooter.
// =====================================================================

const TEXT_PAD_BYTE = 0x00;

function parseEv(buf, codec) {
  if (!buf || buf.length < 16) throw new Error('EV file too short');
  const c1 = buf.readUInt32LE(0);
  const c2 = buf.readUInt32LE(4);
  const c3 = buf.readUInt32LE(8);
  const textOffset = buf.readUInt32LE(12);
  if (textOffset >= buf.length) throw new Error('Invalid textOffset 0x' + textOffset.toString(16));

  let footerOffset = buf.length;
  const pointers = [];
  for (let i = 16; i + 4 <= textOffset; i += 4) {
    const ptr = buf.readUInt32LE(i);
    pointers.push({ at: i, val: ptr });
    if (ptr > textOffset && ptr < footerOffset) footerOffset = ptr;
  }

  const text = buf.subarray(textOffset, footerOffset);
  const slots = [];
  let pos = 0;
  let idx = 0;
  while (pos < text.length) {
    let end = pos;
    while (end < text.length && text[end] !== 0x00) end++;
    // Включаємо 0x00 у байти слота (якщо він є).
    const sliceWithEol = text.subarray(pos, Math.min(end + 1, text.length));
    let decoded = '';
    try { decoded = codec.decode(sliceWithEol, { overlay: false }); } catch (_) { decoded = ''; }
    const stringText = decoded.replace(/\n$/, '');
    // translatable = є хоч 1 літера (пропускаємо padding-байти 0x00 + чисто
    // керівні токени `{eol}`/`{0x0A}` тощо).
    const translatable = /[a-zA-Zа-яА-ЯёЁїЇіІєЄґҐ]/.test(stringText);
    slots.push({
      index: idx++,
      offset: pos,                          // відносно textOffset
      absOffset: textOffset + pos,
      byteLen: sliceWithEol.length,
      english: stringText,
      ukText: '',
      translatable
    });
    pos = end + 1;
    if (sliceWithEol.length === 0) break;
  }

  return {
    slots,
    counts: [c1, c2, c3],
    textOffset,
    footerOffset,
    headerSize: textOffset,
    fileSize: buf.length,
    pointers,
    textLength: footerOffset - textOffset
  };
}

function composeEv(origBuf, slots, codec, opts) {
  const parsed = parseEv(origBuf, codec);
  const { textOffset, footerOffset } = parsed;
  const oldTextLength = footerOffset - textOffset;
  // DEFAULT режим — COMPACT (з header pointer relocation). Підтверджено
  // байт-у-байт порівнянням ENG/RUS .ev файлів: footer/bytecode position-
  // independent, треба оновлювати ЛИШЕ header pointer table при зростанні
  // тексту. Cell-preserving (opts.cellPreserving) — опційно для випадків
  // коли треба гарантувати що байт-довжина не змінилась взагалі.
  const cellPreserving = !!(opts && opts.cellPreserving === true);

  // === Cell-preserving режим (default, безпечний) ===
  // Кожен слот лишається на оригінальному offset'і. UK encoded + 0x00
  // вкладається в cell (= nextSlotOffset - thisSlotOffset). Padd 0x00 до
  // повної довжини cell. Текст НЕ росте → KGR-секції не зміщуються →
  // header pointer'и лишаються валідними. Game-safe для round-trip і коротких UK.
  if (cellPreserving) {
    // Карта offset → cellLength з оригінальних слотів.
    const slotByOffset = new Map();
    for (const s of parsed.slots) {
      if (!slotByOffset.has(s.offset)) slotByOffset.set(s.offset, s);
    }
    const sortedOffsets = [...slotByOffset.keys()].sort((a, b) => a - b);
    const cellLength = new Map();
    for (let i = 0; i < sortedOffsets.length; i++) {
      const here = sortedOffsets[i];
      const next = (i + 1 < sortedOffsets.length) ? sortedOffsets[i + 1] : oldTextLength;
      cellLength.set(here, next - here);
    }

    // Best-effort: для overflow-слотів fallback на EN (не ростимо cell).
    // Текст НЕ росте → KGR-секції на місці → str[N] індексація валідна.
    const ukByOffset = new Map();
    for (const s of slots) {
      if (!ukByOffset.has(s.offset)) {
        const text = (s.ukText && s.ukText.length) ? s.ukText : (s.english || '');
        ukByOffset.set(s.offset, text);
      }
    }
    let overflowCount = 0;
    let fitCount = 0;
    const newText = Buffer.alloc(oldTextLength, TEXT_PAD_BYTE);
    for (const off of sortedOffsets) {
      const slot = slotByOffset.get(off);
      const cellLen = cellLength.get(off);
      let text = ukByOffset.get(off);
      if (text === undefined) text = slot.english;
      let encoded = codec.encode(text);
      let needLen = encoded.length + (encoded[encoded.length - 1] === 0x00 ? 0 : 1);
      if (needLen > cellLen) {
        // Overflow — fallback на EN. Гарантує що text НЕ росте.
        overflowCount++;
        encoded = codec.encode(slot.english);
        needLen = encoded.length + (encoded[encoded.length - 1] === 0x00 ? 0 : 1);
        // Якщо навіть EN не влазить (дивно, але можливо при corrupted даних) —
        // обрізаємо до cell-1 байтів + 0x00.
        if (needLen > cellLen) {
          encoded = encoded.subarray(0, Math.max(0, cellLen - 1));
        }
      } else {
        fitCount++;
      }
      encoded.copy(newText, off);
      let writePos = off + encoded.length;
      if (!encoded.length || encoded[encoded.length - 1] !== 0x00) {
        if (writePos < off + cellLen) newText[writePos++] = 0x00;
      }
    }

    const headerBuf = origBuf.subarray(0, textOffset);
    const footerBuf = origBuf.subarray(footerOffset);
    return {
      buf: Buffer.concat([headerBuf, newText, footerBuf]),
      sizeDiff: 0,
      relocCount: 0,
      oldTextLength,
      newTextLength: newText.length,
      overflowCount,
      fitCount,
      layout: 'cell-preserving'
    };
  }

  // === Compact режим (опціональний, ризикований) ===
  // 1) Будуємо новий text-блок sequentially.
  const chunks = [];
  for (const s of slots) {
    const text = (s.ukText && s.ukText.length) ? s.ukText : (s.english || '');
    const encoded = codec.encode(text);
    let chunk;
    if (encoded.length && encoded[encoded.length - 1] === 0x00) {
      chunk = encoded;
    } else {
      chunk = Buffer.concat([encoded, Buffer.from([0x00])]);
    }
    chunks.push(chunk);
  }
  let newText = Buffer.concat(chunks);
  // 2) Pad до %4.
  const paddingSize = (4 - (newText.length % 4)) % 4;
  if (paddingSize > 0) {
    newText = Buffer.concat([newText, Buffer.alloc(paddingSize, TEXT_PAD_BYTE)]);
  }
  // 3) sizeDiff + 4) реліокація pointer'ів.
  const sizeDiff = newText.length - oldTextLength;
  const headerBuf = Buffer.from(origBuf.subarray(0, textOffset));
  let relocCount = 0;
  for (let i = 16; i + 4 <= headerBuf.length; i += 4) {
    const ptr = headerBuf.readUInt32LE(i);
    if (ptr >= footerOffset) {
      headerBuf.writeUInt32LE(ptr + sizeDiff, i);
      relocCount++;
    }
  }
  // 5) Footer.
  const footerBuf = origBuf.subarray(footerOffset);
  return {
    buf: Buffer.concat([headerBuf, newText, footerBuf]),
    sizeDiff,
    relocCount,
    oldTextLength,
    newTextLength: newText.length,
    layout: 'compact'
  };
}

function isEvName(filename) {
  return /\.(ev|evdl)$/i.test(filename);
}

module.exports = { parseEv, composeEv, isEvName };
