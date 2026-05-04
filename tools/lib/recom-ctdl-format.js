'use strict';

// Re:Chain of Memories CTDL container format — parse + compose.
//
// Структура файлу (mixed LE / BE):
//   [0x00] 4b magic "@CTD" (0x40 0x43 0x54 0x44)
//   [0x04] u16 LE — TextboxCount
//   [0x06] u16 LE — PointerCount (== кількість текстових entry)
//   [0x08] u32 LE — PointerTableOffset
//   [0x0C] u32 LE — BlockBase (абсолютний offset початку текстового блоку)
//   [0x10] N × 48b textbox entries (geometry/styling — read-only тут;
//                                   зберігаються 1:1)
//   [PointerTableOffset] M × 4b u32 LE — relative offset кожного string
//                                        ВІД BlockBase
//   [BlockBase] sequence of null-terminated KH-encoded strings
//
// Compose-стратегія:
//   • Якщо жоден string не виріс понад original byte length — overwrite
//     in-place у RawFile (зберігаємо ВСІ службові байти, padding, alignment).
//   • Якщо хоча б один виріс — повна перебудова text-block + pointer table,
//     перерахунок BlockBase у header.
//
// Round-trip сумісність: на немодифікованих файлах compose повертає
// байт-ідентичну копію.

const codec = require('./recom-ctdl-codec');

const MAGIC = 0x44544340;             // '@CTD' little-endian
const HEADER_SIZE = 0x10;             // 16 байт
const TEXTBOX_ENTRY_SIZE = 48;

// ---- Helpers ------------------------------------------------------------

function readU16BE(buf, off) {
  return (buf[off] << 8) | buf[off + 1];
}
function readI16BE(buf, off) {
  const v = (buf[off] << 8) | buf[off + 1];
  return v >= 0x8000 ? v - 0x10000 : v;
}
function writeU16BE(buf, off, val) {
  buf[off] = (val >>> 8) & 0xFF;
  buf[off + 1] = val & 0xFF;
}
function writeI16BE(buf, off, val) {
  const v = val < 0 ? val + 0x10000 : val;
  buf[off] = (v >>> 8) & 0xFF;
  buf[off + 1] = v & 0xFF;
}

function parseTextboxEntry(buf, off) {
  return {
    entryIndex:        buf.readUInt16LE(off + 0x00),
    textboxActivate:   readU16BE(buf, off + 0x02),
    colorBackground:   Buffer.from(buf.slice(off + 0x04, off + 0x08)),
    colorBorder:       Buffer.from(buf.slice(off + 0x08, off + 0x0C)),
    colorText:         Buffer.from(buf.slice(off + 0x0C, off + 0x10)),
    textEntryIndex:    buf.readUInt32LE(off + 0x10),
    textActivate:      buf[off + 0x14],
    unknown15:         buf[off + 0x15],
    posX:              buf.readUInt16LE(off + 0x16),
    posY:              buf.readUInt16LE(off + 0x18),
    width:             buf.readUInt16LE(off + 0x1A),
    height:            buf.readUInt16LE(off + 0x1C),
    xPosAlignment:     buf[off + 0x1E],
    textboxStyle:      buf[off + 0x1F],
    textAlignment:     buf[off + 0x20],
    unknown21:         buf[off + 0x21],
    fontSize:          buf.readUInt16LE(off + 0x22),
    separator:         buf.readUInt16LE(off + 0x24),
    reserved:          Buffer.from(buf.slice(off + 0x26, off + 0x2C)),
    speechmarkTurn:    readU16BE(buf, off + 0x2C),
    speechmarkPosition: readI16BE(buf, off + 0x2E)
  };
}

function writeTextboxEntry(buf, off, t) {
  buf.writeUInt16LE(t.entryIndex & 0xFFFF, off + 0x00);
  writeU16BE(buf, off + 0x02, t.textboxActivate & 0xFFFF);
  t.colorBackground.copy(buf, off + 0x04, 0, 4);
  t.colorBorder.copy(buf, off + 0x08, 0, 4);
  t.colorText.copy(buf, off + 0x0C, 0, 4);
  buf.writeUInt32LE(t.textEntryIndex >>> 0, off + 0x10);
  buf[off + 0x14] = t.textActivate & 0xFF;
  buf[off + 0x15] = t.unknown15 & 0xFF;
  buf.writeUInt16LE(t.posX & 0xFFFF, off + 0x16);
  buf.writeUInt16LE(t.posY & 0xFFFF, off + 0x18);
  buf.writeUInt16LE(t.width & 0xFFFF, off + 0x1A);
  buf.writeUInt16LE(t.height & 0xFFFF, off + 0x1C);
  buf[off + 0x1E] = t.xPosAlignment & 0xFF;
  buf[off + 0x1F] = t.textboxStyle & 0xFF;
  buf[off + 0x20] = t.textAlignment & 0xFF;
  buf[off + 0x21] = t.unknown21 & 0xFF;
  buf.writeUInt16LE(t.fontSize & 0xFFFF, off + 0x22);
  buf.writeUInt16LE(t.separator & 0xFFFF, off + 0x24);
  t.reserved.copy(buf, off + 0x26, 0, 6);
  writeU16BE(buf, off + 0x2C, t.speechmarkTurn & 0xFFFF);
  writeI16BE(buf, off + 0x2E, t.speechmarkPosition);
}

// ---- parseCtdl(buf) → parsed structure ---------------------------------

function parseCtdl(buf) {
  if (!buf || buf.length < HEADER_SIZE) {
    throw new Error('ctdl: file too short for header');
  }
  const magic = buf.readUInt32LE(0x00);
  if (magic !== MAGIC) {
    throw new Error('ctdl: bad magic 0x' + magic.toString(16) +
                    ' (expected 0x' + MAGIC.toString(16) + ' "@CTD")');
  }

  const textboxCount = buf.readUInt16LE(0x04);
  const pointerCount = buf.readUInt16LE(0x06);
  const pointerTableOffset = buf.readUInt32LE(0x08);
  const blockBase = buf.readUInt32LE(0x0C);

  if (pointerCount <= 0) {
    throw new Error('ctdl: pointer count = 0');
  }
  if (pointerTableOffset <= 0 ||
      pointerTableOffset + pointerCount * 4 > buf.length) {
    throw new Error('ctdl: invalid pointer table offset 0x' +
                    pointerTableOffset.toString(16));
  }
  if (blockBase <= 0 || blockBase >= buf.length) {
    throw new Error('ctdl: invalid block base offset 0x' +
                    blockBase.toString(16));
  }

  // Textbox entries (зберігаємо 1:1 — лише декодуємо, при compose пишемо
  // байт-точно). За specifікацією починаються одразу після header.
  const textboxes = [];
  for (let i = 0; i < textboxCount; i++) {
    const off = HEADER_SIZE + i * TEXTBOX_ENTRY_SIZE;
    if (off + TEXTBOX_ENTRY_SIZE > pointerTableOffset) break;
    textboxes.push(parseTextboxEntry(buf, off));
  }

  // Text entries
  const entries = [];
  for (let i = 0; i < pointerCount; i++) {
    const ptrOff = pointerTableOffset + i * 4;
    const relOff = buf.readUInt32LE(ptrOff);
    const absOff = blockBase + relOff;
    if (absOff < 0 || absOff >= buf.length) {
      entries.push({
        index: i,
        rawTableValue: relOff,
        absoluteOffset: -1,
        text: '',
        originalLength: 0,
        originalBytes: Buffer.alloc(0)
      });
      continue;
    }
    let len = 0;
    while (absOff + len < buf.length && buf[absOff + len] !== 0x00) len++;
    const rawBytes = Buffer.from(buf.slice(absOff, absOff + len));
    entries.push({
      index: i,
      rawTableValue: relOff,
      absoluteOffset: absOff,
      text: codec.decode(rawBytes),
      originalLength: rawBytes.length,
      originalBytes: rawBytes
    });
  }

  return {
    raw: buf,
    header: {
      textboxCount,
      pointerCount,
      pointerTableOffset,
      blockBase
    },
    textboxes,
    entries
  };
}

// ---- composeCtdl(parsed, replacements) → Buffer ------------------------
//
// replacements: optional Map<entryIndex, newText> або array з {index, text}.
// Якщо не передано — повертаємо байт-ідентичну копію.

function composeCtdl(parsed, replacements) {
  const repMap = _normalizeReplacements(replacements);
  const { raw, header, textboxes, entries } = parsed;

  // Закодовуємо всі entries наперед, щоб вирішити: in-place чи rebuild.
  const encoded = entries.map((e, i) => {
    if (repMap.has(i)) {
      return codec.encode(repMap.get(i));
    }
    return e.originalBytes;
  });

  let needRebuild = false;
  for (let i = 0; i < entries.length; i++) {
    if (repMap.has(i) && encoded[i].length > entries[i].originalLength) {
      needRebuild = true;
      break;
    }
  }

  if (!needRebuild) {
    // In-place: копіюємо raw, перезаписуємо textboxes (важливо — у разі
    // якщо викликаючий код модифікував textbox-поля), потім кожен
    // змінений string на тому ж absoluteOffset, доповнюємо 0x00 до
    // original length.
    const out = Buffer.from(raw);
    for (let i = 0; i < textboxes.length; i++) {
      writeTextboxEntry(out, HEADER_SIZE + i * TEXTBOX_ENTRY_SIZE, textboxes[i]);
    }
    for (let i = 0; i < entries.length; i++) {
      if (!repMap.has(i)) continue;
      const e = entries[i];
      if (e.absoluteOffset < 0) {
        throw new Error('ctdl: entry ' + i + ' has invalid offset, cannot patch in place');
      }
      const newBytes = encoded[i];
      newBytes.copy(out, e.absoluteOffset);
      // Заповнюємо хвіст оригінальної довжини нулями
      for (let p = e.absoluteOffset + newBytes.length;
           p < e.absoluteOffset + e.originalLength;
           p++) {
        out[p] = 0x00;
      }
    }
    return out;
  }

  // Rebuild: header → textboxes → padding до pointerTableOffset →
  //         pointer table (placeholder) → text-block.
  // Зберігаємо pointerTableOffset з оригіналу (не зсуваємо textboxes),
  // text-block починається відразу після pointer table.
  const ptOff = header.pointerTableOffset;
  const newBlockBase = ptOff + header.pointerCount * 4;

  // Обчислюємо relOff для кожного entry
  const newRelOffsets = new Array(entries.length);
  let curPos = newBlockBase;
  for (let i = 0; i < entries.length; i++) {
    newRelOffsets[i] = curPos - newBlockBase;
    curPos += encoded[i].length + 1;  // +1 за null-термінатор
  }

  const totalLen = curPos;
  const out = Buffer.alloc(totalLen);

  // Header (16 байт)
  out.writeUInt32LE(MAGIC, 0x00);
  out.writeUInt16LE(header.textboxCount, 0x04);
  out.writeUInt16LE(header.pointerCount, 0x06);
  out.writeUInt32LE(ptOff, 0x08);
  out.writeUInt32LE(newBlockBase, 0x0C);

  // Textboxes
  for (let i = 0; i < textboxes.length; i++) {
    writeTextboxEntry(out, HEADER_SIZE + i * TEXTBOX_ENTRY_SIZE, textboxes[i]);
  }

  // Якщо між textboxes-блоком і pointerTableOffset є padding — копіюємо
  // ці байти з оригіналу (звичайно нулі, але зберігаємо точно).
  const txEnd = HEADER_SIZE + textboxes.length * TEXTBOX_ENTRY_SIZE;
  if (txEnd < ptOff) {
    const padLen = Math.min(ptOff - txEnd, raw.length - txEnd);
    if (padLen > 0) raw.copy(out, txEnd, txEnd, txEnd + padLen);
  }

  // Pointer table
  for (let i = 0; i < entries.length; i++) {
    out.writeUInt32LE(newRelOffsets[i] >>> 0, ptOff + i * 4);
  }

  // Text-block
  let writeAt = newBlockBase;
  for (let i = 0; i < entries.length; i++) {
    encoded[i].copy(out, writeAt);
    writeAt += encoded[i].length;
    out[writeAt] = 0x00;
    writeAt++;
  }

  return out;
}

function _normalizeReplacements(rep) {
  const m = new Map();
  if (!rep) return m;
  if (rep instanceof Map) {
    for (const [k, v] of rep.entries()) m.set(Number(k), String(v == null ? '' : v));
    return m;
  }
  if (Array.isArray(rep)) {
    for (const r of rep) {
      if (r && typeof r.index === 'number') {
        m.set(r.index, String(r.text == null ? '' : r.text));
      }
    }
    return m;
  }
  // plain object {index: text}
  for (const [k, v] of Object.entries(rep)) {
    const idx = Number(k);
    if (Number.isFinite(idx)) m.set(idx, String(v == null ? '' : v));
  }
  return m;
}

module.exports = {
  parseCtdl,
  composeCtdl,
  MAGIC,
  HEADER_SIZE,
  TEXTBOX_ENTRY_SIZE
};
