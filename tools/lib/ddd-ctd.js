'use strict';

// Kingdom Hearts 3D: Dream Drop Distance HD (KH 2.8, PC) — @CTD версії 0x1F7.
// Порт еталонного DropDistanceHD/KH3D_UA_Toolkit/tools/khctd.py (37/37 файлів
// побайтово). Таблиця тегів — data/ddd/tables.json.
//
//   заголовок 0x20  "@CTD", u32 version=0x1F7, u32 baseId, u16 layoutCount,
//                   u16 entryCount, u32 entryTableOffset(0x20), u32 layoutTableOffset,
//                   u32 textOffset, u32 reserved
//   entry 8 байт    u32 messageId, u16 textOffsetLow, u16 (layoutIndex<<4 | textOffsetPage)
//                   → адреса рядка = low + page*0x10000 (текст-блок до 1 МіБ)
//   layout 20 байт  — не чіпаємо
//   текст           UTF-16LE, кожен рядок NUL(0x0000), впритул; 0x000A — перенос;
//                   U+E000..U+EFFF — іконки/підстановки ({PLAYER}, {BTN_A}, {U+XXXX})
//
// Кирилиця у DDD — нативні Unicode-коди (шрифти .bcfnt доповнюються гліфами
// окремим інструментом), тому кодек тривіальний; лише BMP.

const path = require('path');
const fs = require('fs');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'ddd', 'tables.json'), 'utf8'));
const TAGS = new Map(Object.entries(T.tags).map(([k, v]) => [parseInt(k, 16), v]));   // code → name
const RTAGS = new Map([...TAGS].map(([k, v]) => [v, k]));
let FONT_CP = null;
function fontCodepoints() {
  if (FONT_CP) return FONT_CP;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'ddd', 'font-codepoints.json'), 'utf8'));
    FONT_CP = {};
    for (const [font, arr] of Object.entries(j)) FONT_CP[font] = new Set(arr);
  } catch (_) { FONT_CP = {}; }
  return FONT_CP;
}

const MAGIC = 0x44544340;
const VERSION = 0x1F7;
const HEADER_SIZE = 0x20;
const ENTRY_SIZE = 8;
const LAYOUT_SIZE = 20;
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

// ---- codec: масив UTF-16 code units ↔ текст ----
function decodeCodes(codes) {
  const out = [];
  for (const c of codes) {
    if (c === 0x0A) out.push('\n');
    else if (c === 0x7B) out.push('{{');
    else if ((c >= 0x20 && c < 0xE000) || c === 0x09) out.push(String.fromCharCode(c));
    else if (TAGS.has(c)) out.push('{' + TAGS.get(c) + '}');
    else out.push('{U+' + hex4(c) + '}');
  }
  return out.join('');
}

// encodeCodesDetailed(text, {lenient}) → { codes, unmapped }
function encodeCodesDetailed(text, opts) {
  const lenient = !!(opts && opts.lenient);
  const s = text == null ? '' : String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const codes = [];
  const unmapped = [];
  const n = s.length;
  let i = 0;
  const fail = (what, at) => {
    unmapped.push({ char: what, index: at, context: s.substring(at, Math.min(at + 24, n)) });
    if (lenient) codes.push(0x3F);
  };
  while (i < n) {
    const ch = s[i];
    if (ch === '{') {
      if (s.startsWith('{{', i)) { codes.push(0x7B); i += 2; continue; }
      const j = s.indexOf('}', i);
      if (j < 0) { fail('{', i); i++; continue; }
      const name = s.slice(i + 1, j);
      if (RTAGS.has(name)) codes.push(RTAGS.get(name));
      else if (/^U\+[0-9a-fA-F]{1,4}$/.test(name)) codes.push(parseInt(name.slice(2), 16));
      else fail('{' + name + '}', i);
      i = j + 1;
      continue;
    }
    const cp = s.codePointAt(i);
    if (cp > 0xFFFF) { fail(String.fromCodePoint(cp), i); i += 2; continue; }
    codes.push(cp);
    i++;
  }
  return { codes, unmapped };
}

function encodeCodes(text) {
  const r = encodeCodesDetailed(text);
  if (r.unmapped.length) {
    const uniq = [...new Set(r.unmapped.map(u => u.char))];
    const err = new Error('Гра не вміє зберегти: ' + uniq.slice(0, 8).map(c => '«' + c + '»').join(' ') +
      (uniq.length > 8 ? ' (+' + (uniq.length - 8) + ')' : '') + ' — біля: "' + r.unmapped[0].context + '"');
    err.unmapped = r.unmapped;
    throw err;
  }
  return r.codes;
}

// Символи, для яких у .bcfnt-шрифті немає гліфа (за glyph_table.csv еталона).
function missingGlyphs(text, font) {
  const sets = fontCodepoints();
  const set = sets[font || 'mesfont'];
  if (!set) return [];
  const out = new Set();
  for (const c of encodeCodesDetailed(text, { lenient: true }).codes) {
    if (c < 0x20 || (c >= 0xE000 && c <= 0xEFFF)) continue;
    if (!set.has(c)) out.add(String.fromCharCode(c));
  }
  return [...out];
}

// ---- container ----
function parseDddCtd(buf) {
  if (!buf || buf.length < HEADER_SIZE) throw new Error('ddd-ctd: file too short');
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('ddd-ctd: bad magic');
  const version = buf.readUInt32LE(4);
  if (version !== VERSION) throw new Error('ddd-ctd: unexpected version 0x' + version.toString(16) + ' (expected 0x1F7)');
  const baseId = buf.readUInt32LE(8);
  const layoutCount = buf.readUInt16LE(12);
  const entryCount = buf.readUInt16LE(14);
  const eo = buf.readUInt32LE(16);
  const lo = buf.readUInt32LE(20);
  const to = buf.readUInt32LE(24);
  const entries = [];
  let end = to;
  for (let i = 0; i < entryCount; i++) {
    const o = eo + i * ENTRY_SIZE;
    const id = buf.readUInt32LE(o);
    const low = buf.readUInt16LE(o + 4);
    const fld = buf.readUInt16LE(o + 6);
    const addr = low + (fld & 0xF) * 0x10000;
    const codes = [];
    let e = addr;
    while (e + 1 < buf.length) {
      const c = buf.readUInt16LE(e);
      e += 2;
      if (c === 0) break;
      codes.push(c);
    }
    if (e > end) end = e;
    entries.push({ index: i, id, layout: fld >> 4, addr, codes, text: decodeCodes(codes) });
  }
  return {
    header: { version, baseId, layoutCount, entryCount, entryTableOffset: eo, layoutTableOffset: lo, textOffset: to },
    layouts: Buffer.from(buf.subarray(lo, lo + layoutCount * LAYOUT_SIZE)),
    entries,
    tailPad: Buffer.from(buf.subarray(end))
  };
}

// composeDddCtd(parsed, replacements?) → Buffer; replacements: Map<index, text>
function composeDddCtd(parsed, replacements) {
  const rep = replacements instanceof Map ? replacements : new Map(Object.entries(replacements || {}).map(([k, v]) => [Number(k), v]));
  const { header, layouts, entries } = parsed;
  const nent = entries.length;
  const nlay = Math.floor(layouts.length / LAYOUT_SIZE);
  const eo = HEADER_SIZE;
  const lo = (eo + nent * ENTRY_SIZE + 0xF) & ~0xF;
  const to = (lo + layouts.length + 0xF) & ~0xF;

  const chunks = [];
  const addrs = [];
  let len = 0;
  for (const e of entries) {
    const codes = rep.has(e.index) ? encodeCodes(rep.get(e.index)) : e.codes;
    const b = Buffer.alloc(codes.length * 2 + 2);
    codes.forEach((c, k) => b.writeUInt16LE(c, k * 2));
    addrs.push(to + len);
    chunks.push(b);
    len += b.length;
  }
  if (to + len > 0x100000) throw new Error('ddd-ctd: text block too large (' + (to + len) + ' bytes); the format can address 1 MiB');

  let pad = parsed.tailPad || Buffer.alloc(0);
  const need = (16 - ((to + len) % 16)) % 16;
  if (pad.length !== need) pad = Buffer.alloc(need, 0xCD);

  const out = Buffer.alloc(to + len + pad.length, 0);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(header.version, 4);
  out.writeUInt32LE(header.baseId, 8);
  out.writeUInt16LE(nlay, 12);
  out.writeUInt16LE(nent, 14);
  out.writeUInt32LE(eo, 16);
  out.writeUInt32LE(lo, 20);
  out.writeUInt32LE(to, 24);
  out.writeUInt32LE(0, 28);
  entries.forEach((e, i) => {
    const o = eo + i * ENTRY_SIZE;
    out.writeUInt32LE(e.id >>> 0, o);
    out.writeUInt16LE(addrs[i] & 0xFFFF, o + 4);
    out.writeUInt16LE(((e.layout << 4) | (addrs[i] >> 16)) & 0xFFFF, o + 6);
  });
  layouts.copy(out, lo);
  let p = to;
  for (const c of chunks) { c.copy(out, p); p += c.length; }
  pad.copy(out, p);
  return out;
}

module.exports = {
  decodeCodes, encodeCodes, encodeCodesDetailed, missingGlyphs,
  parseDddCtd, composeDddCtd,
  MAGIC, VERSION, HEADER_SIZE, ENTRY_SIZE, LAYOUT_SIZE, TAGS
};
