'use strict';

// Re:Chain of Memories (HD, PC) — контейнер @CTD / .ctdl. Порт еталонного
// DropDistanceHD/CoM/tools/comctd.py (426/426 файлів побайтово).
//
//   заголовок 0x10   "@CTD", u16 layoutCount, u16 messageCount,
//                    u32 offsetTable, u32 textBase
//   макети   0x30 × layoutCount   — не чіпаємо, копіюємо як є
//   таблиця  u32 × messageCount   — зсув рядка ВІД textBase
//   текст    рядки з NUL-термінатором, кожен займає align4(len+1)
//   хвіст    після останнього рядка 4 нулі, інколи сміття 0xCD — зберігаємо
//
// Compose завжди перебудовує текст-блок (як comctd.write): textBase
// оригіналу зберігається (вирівнювання), рядки — без дедуплікації.

const codec = require('./recom-ctdl-codec');

const MAGIC = 0x44544340;             // '@CTD' little-endian
const HEADER_SIZE = 0x10;
const LAYOUT_SIZE = 0x30;

function parseCtdl(buf) {
  if (!buf || buf.length < HEADER_SIZE) throw new Error('ctdl: file too short for header');
  const magic = buf.readUInt32LE(0);
  if (magic !== MAGIC) {
    throw new Error('ctdl: bad magic 0x' + magic.toString(16) + ' (expected 0x' + MAGIC.toString(16) + ' "@CTD")');
  }
  const layoutCount = buf.readUInt16LE(0x04);
  const messageCount = buf.readUInt16LE(0x06);
  const offTable = buf.readUInt32LE(0x08);
  const textBase = buf.readUInt32LE(0x0C);
  if (offTable < HEADER_SIZE || offTable + messageCount * 4 > buf.length) {
    throw new Error('ctdl: invalid offset table 0x' + offTable.toString(16));
  }
  if (textBase < offTable || textBase > buf.length) {
    throw new Error('ctdl: invalid text base 0x' + textBase.toString(16));
  }
  const layouts = [];
  for (let i = 0; i < layoutCount; i++) {
    const off = HEADER_SIZE + i * LAYOUT_SIZE;
    layouts.push(Buffer.from(buf.subarray(off, off + LAYOUT_SIZE)));
  }
  const entries = [];
  let end = textBase;
  for (let i = 0; i < messageCount; i++) {
    const rel = buf.readUInt32LE(offTable + i * 4);
    const abs = textBase + rel;
    if (abs >= buf.length) throw new Error('ctdl: entry ' + i + ' offset out of range');
    let e = abs;
    while (e < buf.length && buf[e] !== 0x00) e++;
    const raw = Buffer.from(buf.subarray(abs, e));
    entries.push({
      index: i,
      rawTableValue: rel,
      absoluteOffset: abs,
      originalBytes: raw,
      originalLength: raw.length,
      text: codec.decode(raw)
    });
    end += ((raw.length + 4) >> 2) << 2;     // align4(len + 1)
  }
  return {
    raw: buf,
    header: { layoutCount, messageCount, offTable, textBase },
    layouts,
    entries,
    tail: Buffer.from(buf.subarray(Math.min(end, buf.length)))
  };
}

// composeCtdl(parsed, replacements?) → Buffer
//   replacements: Map<index, text> | [{index, text}] | {index: text}; без них —
//   байт-ідентична копія.
function composeCtdl(parsed, replacements) {
  const rep = normalizeReplacements(replacements);
  const { header, layouts, entries } = parsed;
  const msgs = entries.map((e, i) => (rep.has(i) ? codec.encode(rep.get(i)) : e.originalBytes));

  const offTable = HEADER_SIZE + layouts.length * LAYOUT_SIZE;
  let textBase = header.textBase;                       // зберігаємо вирівнювання оригіналу
  const need = offTable + 4 * msgs.length;
  if (textBase < need) textBase = ((need + 15) >> 4) << 4;

  const chunks = [];
  const offs = [];
  let len = 0;
  for (const m of msgs) {
    offs.push(len);
    const padded = ((m.length + 4) >> 2) << 2;           // рядок + NUL, вирівняно на 4
    const chunk = Buffer.alloc(padded, 0);
    m.copy(chunk, 0);
    chunks.push(chunk);
    len += padded;
  }
  const tail = (parsed.tail && parsed.tail.length) ? parsed.tail : Buffer.from([0, 0, 0, 0]);
  const out = Buffer.alloc(textBase + len + tail.length, 0);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt16LE(layouts.length, 0x04);
  out.writeUInt16LE(msgs.length, 0x06);
  out.writeUInt32LE(offTable, 0x08);
  out.writeUInt32LE(textBase, 0x0C);
  layouts.forEach((l, i) => l.copy(out, HEADER_SIZE + i * LAYOUT_SIZE, 0, LAYOUT_SIZE));
  offs.forEach((o, i) => out.writeUInt32LE(o, offTable + i * 4));
  let p = textBase;
  for (const c of chunks) { c.copy(out, p); p += c.length; }
  tail.copy(out, p);
  return out;
}

function normalizeReplacements(rep) {
  const m = new Map();
  if (!rep) return m;
  if (rep instanceof Map) { for (const [k, v] of rep) m.set(Number(k), String(v == null ? '' : v)); return m; }
  if (Array.isArray(rep)) { for (const r of rep) if (r && typeof r.index === 'number') m.set(r.index, String(r.text == null ? '' : r.text)); return m; }
  for (const [k, v] of Object.entries(rep)) { const i = Number(k); if (Number.isFinite(i)) m.set(i, String(v == null ? '' : v)); }
  return m;
}

module.exports = { parseCtdl, composeCtdl, MAGIC, HEADER_SIZE, LAYOUT_SIZE, TEXTBOX_ENTRY_SIZE: LAYOUT_SIZE };
