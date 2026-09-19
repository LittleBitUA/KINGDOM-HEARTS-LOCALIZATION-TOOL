'use strict';

// =====================================================================
// KH1 ReMIX «Message v361» .binl (системні повідомлення: menu/*/sysmsg.bin/
// XX_sysmsg.binl — «Load this game?», «Ability equipped.» тощо).
// Той самий KH1-кодек, що й EvMsg, але інший контейнер:
//
//   0x00  char[12]  "Message v361"
//   0x0C  u32       count           — кількість повідомлень
//   0x10  u32       offsetTableOffset (= 0x20)
//   0x14  u32       textOffset      (= offsetTableOffset + offsetTableLength)
//   0x18  u32       offsetTableLength — count або count+1 записів u16
//   0x1C  u32       textLength
//   offsetTable: u16[]  — зсуви відносно textOffset, зростають, перший = 0
//   text: кожне повідомлення = байти + 0x00; 0x02 = перенос рядка;
//         опційний trailing sentinel 0x00 після останнього; далі padding
//         (0xCD або 0x00) до кратного 16.
//
// Compose перебудовує таблицю зсувів і textLength; порожній UK лишає оригінал
// байт-у-байт. Текст-блок обмежений u16 (65535 байт). Записи читаються за
// таблицею зсувів, тому 0x00 усередині запису (параметри команд) — норма.
// Звірено з OpenKh PR #1275 (Kh1MessageV361.cs).
// =====================================================================

const MAGIC = Buffer.from('Message v361', 'ascii');
const HEADER = 0x20;

function isMessageV361(buf) {
  return !!buf && buf.length >= HEADER && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function parseMessageV361(buf) {
  if (!isMessageV361(buf)) throw new Error('Не Message v361 .binl');
  const count = buf.readUInt32LE(0x0C);
  const offsetTableOffset = buf.readUInt32LE(0x10);
  const textOffset = buf.readUInt32LE(0x14);
  const offsetTableLength = buf.readUInt32LE(0x18);
  const textLength = buf.readUInt32LE(0x1C);
  const offsetCount = offsetTableLength >>> 1;

  if (count === 0 || offsetTableOffset < HEADER || (offsetTableLength & 1) !== 0 ||
      (offsetCount !== count && offsetCount !== count + 1) ||
      textOffset !== offsetTableOffset + offsetTableLength ||
      textLength < 1 || textOffset + textLength > buf.length ||
      buf[textOffset + textLength - 1] !== 0x00) {
    throw new Error('Message v361: некоректний заголовок');
  }

  const offsets = new Array(offsetCount);
  for (let i = 0; i < offsetCount; i++) {
    offsets[i] = buf.readUInt16LE(offsetTableOffset + i * 2);
    if ((i === 0 && offsets[i] !== 0) || (i > 0 && offsets[i] < offsets[i - 1]) || offsets[i] >= textLength) {
      throw new Error('Message v361: некоректна таблиця зсувів');
    }
  }

  const hasTrailingSentinel = offsetCount > count ||
    (offsets[count - 1] < textLength - 1 && buf[textOffset + textLength - 2] === 0x00);
  const entriesEnd = textLength - (hasTrailingSentinel ? 1 : 0);
  if (offsetCount > count && offsets[count] !== entriesEnd) {
    throw new Error('Message v361: некоректний фінальний зсув');
  }

  const entries = [];
  for (let i = 0; i < count; i++) {
    const start = offsets[i];
    const end = i + 1 < count ? offsets[i + 1] : entriesEnd;
    const length = end - start;
    if (length === 0 || buf[textOffset + end - 1] !== 0x00) {
      throw new Error('Message v361: повідомлення #' + (i + 1) + ' без термінатора 0x00');
    }
    entries.push({
      index: i,
      offset: textOffset + start,           // абсолютний зсув байтів тексту у файлі
      bytes: buf.subarray(textOffset + start, textOffset + end - 1)
    });
  }

  return {
    raw: buf,
    count,
    offsetTableOffset,
    textOffset,
    offsetCount,
    textLength,
    hasTrailingSentinel,
    usesCdPadding: buf.length > 0 && buf[buf.length - 1] === 0xCD,
    entries
  };
}

// composeMessageV361(parsed, replacements: Map<entryIndex, Buffer>) → Buffer
// Записи без заміни лишаються оригінальними байтами.
function composeMessageV361(parsed, replacements) {
  const rep = replacements || new Map();
  if (rep.size === 0) return Buffer.from(parsed.raw);

  const encoded = parsed.entries.map(e => {
    const r = rep.get(e.index);
    if (!r) return e.bytes;
    return r;   // 0x00 усередині допустимий (байти параметрів команд, як в оригіналі)
  });
  const entriesLength = encoded.reduce((n, b) => n + b.length + 1, 0);
  const textLength = entriesLength + (parsed.hasTrailingSentinel ? 1 : 0);
  if (textLength > 0xFFFF) throw new Error('Message v361: текст-блок перевищує 65535 байт (' + textLength + ')');

  const header = Buffer.from(parsed.raw.subarray(0, parsed.textOffset));
  header.writeUInt32LE(textLength, 0x1C);
  let cur = 0;
  for (let i = 0; i < encoded.length; i++) {
    header.writeUInt16LE(cur, parsed.offsetTableOffset + i * 2);
    cur += encoded[i].length + 1;
  }
  if (parsed.offsetCount > encoded.length) header.writeUInt16LE(cur, parsed.offsetTableOffset + encoded.length * 2);

  const parts = [header];
  for (const b of encoded) { parts.push(b); parts.push(Buffer.from([0x00])); }
  if (parsed.hasTrailingSentinel) parts.push(Buffer.from([0x00]));
  let out = Buffer.concat(parts);
  const target = Math.max(parsed.raw.length, (out.length + 0x0F) & ~0x0F);
  if (out.length < target) out = Buffer.concat([out, Buffer.alloc(target - out.length, parsed.usesCdPadding ? 0xCD : 0x00)]);
  return out;
}

module.exports = { MAGIC, HEADER, isMessageV361, parseMessageV361, composeMessageV361 };
