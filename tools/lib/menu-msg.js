'use strict';

// Текст меню KH1 у «сирих» списках: `u32 count` + count рядків з термінатором
// 0x00 (діалект команд меню — codec.SYSMSG_CMD_LEN: 0D/0E i16, 0F NN, 08 RGBA…).
// Так влаштовані `menu/md_*.kmb` (словник, гімн, Jiminy, синопсис). Байт 0x00
// всередині рядка можливий лише як параметр команди (`{0x0D,0x0C,0x00}`), тому
// кінець рядка шукаємо, перестрибуючи команди, а не за першим нулем.
//
// Хвіст файла після останнього рядка — нулі (md_syno доповнено до 0x4800,
// md_anthem/md_dic мають один завершальний 0x00, md_jiminy — до кратного 16).
// Compose зберігає ту саму політику: якщо новий вміст не довший за оригінал —
// доповнюємо до оригінального розміру; інакше — той самий хвіст (кількість
// нулів), вирівняний на 16, якщо оригінал був кратний 16.

const { SYSMSG_CMD_LEN } = require('../../shared/codec');

// scanMsgEnd(buf, start, end) → індекс термінатора 0x00 (або end), з урахуванням
// довжин команд меню.
function scanMsgEnd(buf, start, end) {
  let i = start;
  while (i < end) {
    const b = buf[i];
    if (b === 0x00) return i;
    const n = SYSMSG_CMD_LEN[b];
    i += n !== undefined ? n : 1;
  }
  return end;
}

// parseCounted(buf) → { count, entries: [{ index, offset, bytes }], bodyEnd, tail }
function parseCounted(buf) {
  if (!buf || buf.length < 4) throw new Error('kmb: файл закороткий');
  const count = buf.readUInt32LE(0);
  if (count === 0 || count > 100000) throw new Error('kmb: неправдоподібна кількість рядків ' + count);
  const entries = [];
  let i = 4;
  for (let k = 0; k < count; k++) {
    if (i >= buf.length) throw new Error('kmb: рядок #' + k + ' поза файлом (заявлено ' + count + ')');
    const e = scanMsgEnd(buf, i, buf.length);
    entries.push({ index: k, offset: i, bytes: buf.subarray(i, e) });
    i = e + 1;
  }
  const bodyEnd = Math.min(i, buf.length);
  const tail = buf.subarray(bodyEnd);
  for (let k = 0; k < tail.length; k++) {
    if (tail[k] !== 0x00) throw new Error('kmb: після ' + count + ' рядків є ненульові дані (зсув ' + (bodyEnd + k) + ')');
  }
  return { count, entries, bodyEnd, tail, fileSize: buf.length };
}

// composeCounted(parsed, replacements: Map<index, Buffer>) → Buffer
function composeCounted(parsed, replacements) {
  const rep = replacements || new Map();
  const chunks = [Buffer.alloc(4)];
  chunks[0].writeUInt32LE(parsed.count, 0);
  for (const e of parsed.entries) {
    const bytes = rep.has(e.index) ? rep.get(e.index) : e.bytes;
    chunks.push(bytes, Buffer.from([0x00]));
  }
  let body = Buffer.concat(chunks);
  let target;
  if (body.length <= parsed.fileSize) target = parsed.fileSize;
  else {
    target = body.length + parsed.tail.length;
    if (parsed.fileSize % 16 === 0) target = Math.ceil(target / 16) * 16;
  }
  return Buffer.concat([body, Buffer.alloc(target - body.length, 0x00)]);
}

module.exports = { scanMsgEnd, parseCounted, composeCounted };
