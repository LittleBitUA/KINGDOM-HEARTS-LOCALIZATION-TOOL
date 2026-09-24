'use strict';

// BBS (PC HD) .arc-контейнер — той самий формат, що читає tools/py/bbs/arc.py:
//   0x00 'ARC' (24 біти) | 0x04 version i16, count i16 | 0x08 u8 i32, uc i32
//   0x10 + i*0x20: dirhash u32, off i32, len i32, unused u32, name[16]
// dirhash != 0 — посилання (link) без власних даних.

const fs = require('fs');
const path = require('path');

function parseArc(buf) {
  if (buf.length < 0x10 || (buf.readUInt32LE(0) & 0xFFFFFF) !== 0x435241) {
    throw new Error('not an ARC container');
  }
  const version = buf.readInt16LE(4);
  const count = buf.readInt16LE(6);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const o = 0x10 + i * 0x20;
    if (o + 0x20 > buf.length) break;
    const dirhash = buf.readUInt32LE(o);
    const off = buf.readInt32LE(o + 4);
    const len = buf.readInt32LE(o + 8);
    const raw = buf.subarray(o + 0x10, o + 0x20);
    const nul = raw.indexOf(0);
    const name = raw.subarray(0, nul < 0 ? 16 : nul).toString('utf8');
    entries.push({ i, dirhash, off, len, name, link: dirhash !== 0,
      data: dirhash === 0 && off >= 0 && len >= 0 && off + len <= buf.length ? buf.subarray(off, off + len) : null });
  }
  return { version, count, entries };
}

// Розпакувати .arc у теку (лише записи з даними). Повертає список імен.
function unpackArc(arcPath, outDir) {
  const arc = parseArc(fs.readFileSync(arcPath));
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const e of arc.entries) {
    if (!e.data || !e.name || /[\\/]/.test(e.name)) continue;
    fs.writeFileSync(path.join(outDir, e.name), e.data);
    written.push(e.name);
  }
  return written;
}

// Зібрати .arc заново з підміною вмісту записів (replace: Map<name, Buffer>) — як
// bbsfont.build_arc: заголовок, таблиця, дані з вирівнюванням 16; link-записи без даних.
function buildArc(buf, replace) {
  const arc = parseArc(buf);
  const base = 0x10 + 0x20 * arc.count;
  const head = Buffer.alloc(base);
  head.writeUInt32LE(0x435241, 0); head.writeInt16LE(arc.version, 4); head.writeInt16LE(arc.count, 6);
  head.writeInt32LE(buf.readInt32LE(8), 8); head.writeInt32LE(buf.readInt32LE(12), 12);
  const body = [];
  let size = 0;
  for (const e of arc.entries) {
    const o = 0x10 + e.i * 0x20;
    const unused = buf.readUInt32LE(o + 0x0c);
    if (e.link) { head.writeUInt32LE(e.dirhash, o); head.writeInt32LE(0, o + 4); head.writeInt32LE(0, o + 8); }
    else {
      const data = replace.has(e.name) ? replace.get(e.name) : e.data;
      const pad = (16 - (base + size) % 16) % 16; if (pad) { body.push(Buffer.alloc(pad)); size += pad; }
      head.writeUInt32LE(0, o); head.writeInt32LE(base + size, o + 4); head.writeInt32LE(data.length, o + 8);
      body.push(data); size += data.length;
    }
    head.writeUInt32LE(unused, o + 0x0c);
    Buffer.from(e.name, 'utf8').copy(head, o + 0x10, 0, Math.min(16, Buffer.byteLength(e.name)));
  }
  const pad = (16 - (base + size) % 16) % 16; if (pad) body.push(Buffer.alloc(pad));
  return Buffer.concat([head, ...body]);
}

// Те саме, але БЕЗ зсуву записів, яких ми не чіпали.
//
// Навіщо: у грі `.arc` містить і розкладки `.l2d`, і текстури `.tm2`. Якщо
// перекладений `.l2d` побільшав і ми перезбираємо архів підряд, усе, що лежить
// після нього, з'їжджає — і текстури починають малюватися сміттям (титульний
// екран, смуги підказок). Тому тут кожен незмінений запис лишається РІВНО на
// своєму зсуві, а змінені дописуються в кінець файла; старі байти змінених
// записів просто стають мертвим місцем.
function buildArcKeepOffsets(buf, replace) {
  const arc = parseArc(buf);
  const base = 0x10 + 0x20 * arc.count;
  const head = Buffer.alloc(base);
  head.writeUInt32LE(0x435241, 0); head.writeInt16LE(arc.version, 4); head.writeInt16LE(arc.count, 6);
  head.writeInt32LE(buf.readInt32LE(8), 8); head.writeInt32LE(buf.readInt32LE(12), 12);

  // Хвіст = кінець останнього запису, вирівняний на 16.
  let tail = base;
  for (const e of arc.entries) if (!e.link) tail = Math.max(tail, e.off + e.len);
  tail = Math.ceil(tail / 16) * 16;

  const moved = [];          // { at, data } — що дописуємо в кінець
  for (const e of arc.entries) {
    const o = 0x10 + e.i * 0x20;
    const unused = buf.readUInt32LE(o + 0x0c);
    if (e.link) {
      head.writeUInt32LE(e.dirhash, o); head.writeInt32LE(0, o + 4); head.writeInt32LE(0, o + 8);
    } else {
      const repl = replace.has(e.name) ? replace.get(e.name) : null;
      if (!repl || (repl.length === e.data.length && repl.equals(e.data))) {
        // незмінений — лишається там, де був
        head.writeUInt32LE(0, o); head.writeInt32LE(e.off, o + 4); head.writeInt32LE(e.len, o + 8);
      } else if (repl.length <= e.len) {
        // влазить на місце — пишемо туди ж (решту старих байтів лишаємо як є)
        head.writeUInt32LE(0, o); head.writeInt32LE(e.off, o + 4); head.writeInt32LE(repl.length, o + 8);
        moved.push({ at: e.off, data: repl });
      } else {
        head.writeUInt32LE(0, o); head.writeInt32LE(tail, o + 4); head.writeInt32LE(repl.length, o + 8);
        moved.push({ at: tail, data: repl });
        tail = Math.ceil((tail + repl.length) / 16) * 16;
      }
    }
    head.writeUInt32LE(unused, o + 0x0c);
    Buffer.from(e.name, 'utf8').copy(head, o + 0x10, 0, Math.min(16, Buffer.byteLength(e.name)));
  }

  const out = Buffer.alloc(Math.max(tail, buf.length));
  buf.copy(out);                       // усе старе на своїх місцях
  head.copy(out, 0);                   // новий заголовок і таблиця
  for (const m of moved) m.data.copy(out, m.at);
  return out;
}

module.exports = { parseArc, unpackArc, buildArc, buildArcKeepOffsets };
