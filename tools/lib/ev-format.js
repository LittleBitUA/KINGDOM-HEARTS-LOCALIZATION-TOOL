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
//   2) Pad with 0x00 so total newText.length % 16 == 0 (усі оригінальні ENG
//      і RUS-файли мають текстову секцію кратну 16; OpenKh теж тримає 16).
//   3) sizeDiff = newText.length - oldTextLength.
//   4) For each header pointer >= oldFooterOffset → +sizeDiff.
//   5) Final = updatedHeader + newText + originalFooter.
// =====================================================================

const TEXT_PAD_BYTE = 0x00;
const { looksLikeText } = require('./text-quality');
const { splitSlots, walkFits } = require('../../shared/kh1-message');
const { splitEdges } = require('../../shared/kh1-tokens');

// Старий поділ по 0x00 — запасний шлях для файлів, де обхід байткоду не сходиться.
function legacySplit(text) {
  const out = [];
  let pos = 0;
  while (pos < text.length) {
    let end = pos;
    while (end < text.length && text[end] !== 0x00) end++;
    out.push({ start: pos, end, term: end < text.length ? 0x00 : -1 });
    pos = end + 1;
  }
  return out;
}

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
  // Один слот = одна СТОРІНКА повідомлення: межі беремо обходом байткоду, а не
  // наївним поділом по 0x00 (той різав команди навпіл — див. shared/kh1-message.js).
  const paged = walkFits(text, 0, text.length);
  const pieces = paged ? splitSlots(text, 0, text.length) : legacySplit(text);
  const slots = [];
  let idx = 0;
  for (const piece of pieces) {
    const bytes = text.subarray(piece.start, piece.end);
    let decoded = '';
    try { decoded = codec.decode(bytes, { overlay: false }); } catch (_) { decoded = ''; }
    const full = decoded.replace(/\n$/, '');
    // Службова обгортка сторінки (інтервал рядків, зсув, тривалість показу)
    // відділяється від тексту й повертається при збірці.
    const cut = paged ? splitEdges(full) : { prefix: '', body: full, suffix: '' };
    slots.push({
      index: idx++,
      offset: piece.start,                  // відносно textOffset
      absOffset: textOffset + piece.start,
      byteLen: bytes.length,                // БЕЗ байта-роздільника
      term: piece.term,                     // 0x00 кінець повідомлення, 0x04 кінець сторінки, -1 нема
      english: cut.body,
      prefix: cut.prefix,
      suffix: cut.suffix,
      ukText: '',
      // translatable = схоже на текст (≥2 літери поспіль поза токенами) — text-quality.js
      translatable: looksLikeText(cut.body)
    });
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

// offset → переклад (лише там, де він справді є; null = лишаємо оригінальні байти).
function ukMap(slots) {
  const m = new Map();
  for (const s of slots || []) {
    if (m.has(s.offset)) continue;
    const uk = s.ukText;
    m.set(s.offset, (typeof uk === 'string' && uk.length) ? uk : null);
  }
  return m;
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
    const ukByOffset = ukMap(slots);
    let overflowCount = 0;
    let fitCount = 0;
    const newText = Buffer.alloc(oldTextLength, TEXT_PAD_BYTE);
    for (const off of sortedOffsets) {
      const slot = slotByOffset.get(off);
      const cellLen = cellLength.get(off);
      const orig = origBuf.subarray(textOffset + off, textOffset + off + slot.byteLen);
      const uk = ukByOffset.get(off);
      // Роздільник (0x00 кінець повідомлення / 0x04 кінець сторінки) — свій у
      // кожного слота; раніше завжди дописувався 0x00 і це псувало сторінки.
      const termLen = slot.term >= 0 ? 1 : 0;
      let encoded = uk == null ? orig : codec.encode(uk);
      if (encoded.length + termLen > cellLen) {
        overflowCount++;
        encoded = orig;
        if (encoded.length + termLen > cellLen) encoded = encoded.subarray(0, Math.max(0, cellLen - termLen));
      } else {
        fitCount++;
      }
      encoded.copy(newText, off);
      if (termLen) newText[off + encoded.length] = slot.term;
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
  // 1) Будуємо новий text-блок sequentially. Неперекладені слоти копіюємо
  //    байт-у-байт — так round-trip гарантовано точний, навіть якщо якийсь
  //    рідкісний байт кодувальник відтворив би інакше.
  const ukByOffset2 = ukMap(slots);
  const chunks = [];
  for (const s of parsed.slots) {
    const uk = ukByOffset2.get(s.offset);
    const orig = origBuf.subarray(textOffset + s.offset, textOffset + s.offset + s.byteLen);
    chunks.push(uk == null ? orig : codec.encode(uk));
    if (s.term >= 0) chunks.push(Buffer.from([s.term]));
  }
  let newText = Buffer.concat(chunks);
  // 2) Pad до %4.
  const paddingSize = (16 - (newText.length % 16)) % 16;
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
