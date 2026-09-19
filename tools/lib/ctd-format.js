'use strict';

// CTD container format (BBS) — parser + composer.
// Структура файлу:
//   • Header (32 b):   @CTD magic, version, counts, table-offsets
//   • Message table:   N × 12 b (id, textOffset, layoutIndex, waitFrames)
//   • Layout table:    M × 32 b (geometry/styling — read-only для перекладача)
//   • Text block:      null-terminated байтові рядки, кодовані bbs-codec
//
// Compose-логіка перебудовує message-table + text-block з оновленими
// offset'ами; layout-table копіюється як є; header оновлює textStart.

const codec = require('./bbs-codec');

const MAGIC = 0x44544340;             // '@CTD' little-endian
const HEADER_SIZE = 0x20;
const MSG_ENTRY_SIZE = 12;
const LAYOUT_ENTRY_SIZE = 32;

function parseCtd(buf) {
  if (buf.length < HEADER_SIZE) throw new Error('ctd: file too short for header');
  const magic = buf.readUInt32LE(0x00);
  if (magic !== MAGIC) {
    throw new Error('ctd: bad magic 0x' + magic.toString(16) + ' (expected 0x44544340)');
  }
  const version = buf.readUInt32LE(0x04);
  // 0x08-0x0B = File ID (uint32 LE). Кожне повідомлення має id = fileId + offset.
  // OpenKh CtdEditor показує його у заголовку.
  const fileId = buf.readUInt32LE(0x08);
  const layoutCount = buf.readUInt16LE(0x0C);
  const messageCount = buf.readUInt16LE(0x0E);
  const messageOffset = buf.readUInt32LE(0x10);
  const layoutOffset = buf.readUInt32LE(0x14);
  const textStart = buf.readUInt32LE(0x18);
  const reservedB = buf.readUInt32LE(0x1C);

  // Messages — також збираємо "block size" (відстань до сусіднього текст-блоку)
  // щоб при compose зберегти оригінальний layout байт-у-байт.
  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    const off = messageOffset + i * MSG_ENTRY_SIZE;
    messages.push({
      id: buf.readUInt32LE(off + 0x00),
      textOffset: buf.readUInt32LE(off + 0x04),
      layoutIndex: buf.readUInt16LE(off + 0x08),
      waitFrames: buf.readUInt16LE(off + 0x0A)
    });
  }
  // Розраховуємо block size за сортованими offset'ами
  const offsetsSorted = messages
    .map((m, i) => ({ idx: i, off: m.textOffset }))
    .sort((a, b) => a.off - b.off);
  for (let k = 0; k < offsetsSorted.length; k++) {
    const cur = offsetsSorted[k];
    const next = (k + 1 < offsetsSorted.length) ? offsetsSorted[k + 1].off : buf.length;
    messages[cur.idx]._origBlockSize = next - cur.off;
  }
  // Декодуємо текст
  for (const m of messages) {
    const textBytes = readUntilZero(buf, m.textOffset);
    m.raw = Buffer.from(textBytes);          // оригінальні байти — compose бере їх, якщо текст не змінено
    m.text = codec.decode(textBytes);
    m._rawText = m.text;
    m._origByteLen = textBytes.length;
  }

  // Layouts — копіюємо raw blob (32 b кожен), не парсимо поля
  const layoutsBlob = buf.slice(layoutOffset, layoutOffset + layoutCount * LAYOUT_ENTRY_SIZE);

  return {
    header: {
      version,
      fileId,
      reservedB,
      originalMessageOffset: messageOffset,
      originalLayoutOffset: layoutOffset,
      originalTextStart: textStart
    },
    messages,
    layouts: { count: layoutCount, blob: layoutsBlob }
  };
}

function readUntilZero(buf, start) {
  let end = start;
  while (end < buf.length && buf[end] !== 0x00) end++;
  return buf.slice(start, end);
}

// composeCtd({header, messages, layouts}) → Buffer
// Перебудовує файл: layouts на тих же зміщеннях, messages зі своїми
// оновленими textOffset, text-блок з 0x00-термінаторами.
function composeCtd(parsed) {
  const { header, messages, layouts } = parsed;

  // Розрахунок layout: розташовуємо так само, як в оригіналі —
  // header → messages → padding → layouts → text.
  const messageTableSize = messages.length * MSG_ENTRY_SIZE;
  const layoutTableSize = layouts.count * LAYOUT_ENTRY_SIZE;

  // Зберігаємо оригінальний layoutOffset (вирівняний на 16/32 байти);
  // якщо в новій версії messageCount інший, треба перерахувати з padding.
  // Прив'язуємось до оригінальних offset'ів якщо messageCount той самий —
  // це гарантує round-trip.
  const messageOffset = HEADER_SIZE;
  const minLayoutOffset = HEADER_SIZE + messageTableSize;
  // Зберігаємо вирівнювання: округлити вгору до 16 байт (як в реальних файлах)
  const layoutOffset = Math.max(header.originalLayoutOffset || 0, alignUp(minLayoutOffset, 16));
  const textStart = layoutOffset + layoutTableSize;

  // Кодуємо тексти. Розкладка зберігає ОРИГІНАЛЬНИЙ ПОРЯДОК у файлі
  // (повідомлення можуть йти в text-блоці не за index'ом). Блок кожного
  // повідомлення = max(originalBlockSize, новий-текст + 1 null) — якщо
  // переклад влазить, файл лишається байт-у-байт ідентичним; якщо ні —
  // блок розширюється і всі наступні зміщуються.
  // m.raw має пріоритет (байт-ідентичний round-trip і без повторного encode);
  // caller, що змінив текст, кладе нові байти у m.raw.
  const encodedTexts = messages.map(m => ((m.raw && m.text === m._rawText) ? m.raw : codec.encode(m.text)));

  // Сортуємо за оригінальним textOffset (file-order)
  const fileOrder = messages
    .map((m, i) => ({ idx: i, off: m.textOffset }))
    .sort((a, b) => a.off - b.off);

  const textOffsets = new Array(messages.length);
  let cursor = textStart;
  for (const { idx } of fileOrder) {
    textOffsets[idx] = cursor;
    const minSize = encodedTexts[idx].length + 1;
    const origBlock = messages[idx]._origBlockSize || minSize;
    const block = Math.max(minSize, origBlock);
    cursor += block;
  }
  // Хвостове вирівнювання файлу до 16 байт (всі спостережувані .ctd так зроблені)
  const totalSize = alignUp(cursor, 16);

  // Алокуємо буфер. Дві зони з різним padding-байтом:
  //   • header / message-table / layouts: 0x00 (file alignment zeros)
  //   • text-блок (textStart..end): 0xCD (debug-allocator pattern, яким
  //     Square забили невикористані регіони у text-блоці)
  // Цей розподіл відтворює структуру оригінальних .ctd файлів.
  const out = Buffer.alloc(totalSize, 0);
  out.fill(0xCD, textStart, totalSize);

  // Header
  out.writeUInt32LE(MAGIC, 0x00);
  out.writeUInt32LE(header.version || 1, 0x04);
  out.writeUInt32LE(header.fileId || 0, 0x08);
  out.writeUInt16LE(layouts.count, 0x0C);
  out.writeUInt16LE(messages.length, 0x0E);
  out.writeUInt32LE(messageOffset, 0x10);
  out.writeUInt32LE(layoutOffset, 0x14);
  out.writeUInt32LE(textStart, 0x18);
  out.writeUInt32LE(header.reservedB || 0, 0x1C);

  // Message table
  for (let i = 0; i < messages.length; i++) {
    const off = messageOffset + i * MSG_ENTRY_SIZE;
    const m = messages[i];
    out.writeUInt32LE(m.id >>> 0, off + 0x00);
    out.writeUInt32LE(textOffsets[i], off + 0x04);
    out.writeUInt16LE(m.layoutIndex || 0, off + 0x08);
    out.writeUInt16LE(m.waitFrames || 0, off + 0x0A);
  }

  // Layouts blob (copy as-is)
  layouts.blob.copy(out, layoutOffset, 0, layoutTableSize);

  // Text block — text + explicit 0x00 terminator (бо зона залита 0xCD)
  for (let i = 0; i < encodedTexts.length; i++) {
    encodedTexts[i].copy(out, textOffsets[i]);
    out[textOffsets[i] + encodedTexts[i].length] = 0x00;
  }

  return out;
}

function alignUp(value, multiple) {
  const r = value % multiple;
  return r === 0 ? value : value + (multiple - r);
}

module.exports = { parseCtd, composeCtd, HEADER_SIZE, MSG_ENTRY_SIZE, LAYOUT_ENTRY_SIZE, MAGIC };
