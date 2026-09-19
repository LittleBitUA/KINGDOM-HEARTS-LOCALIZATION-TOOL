'use strict';

// Кодек тексту Re:Chain of Memories (HD, PC) — порт еталонного
// DropDistanceHD/CoM/tools/comtext.py (+ cyrmap.py), звіреного на всіх
// 30 503 повідомленнях гри. Таблиці — data/recom/tables.json.
//
// Байти → текст:
//   0x0A                → '\n'
//   F9 xx / F5 xx       → {color xx} / {icon xx}
//   0x7B                → '{{'
//   0x20..0x7E          → ASCII
//   lead(0x81-0x9F) + справжній SJIS-trail (0x40-0xFC, не 0x7F)
//                       → символ із таблиці sjis (лише ті коди, що є в грі),
//                         кирилиця (коди хіраґани 0x829F-0x82E0), інакше {sjis xxxx}
//   інший байт          → {b xx}
//
// Текст → байти: ASCII, таблиця sjis, кирилиця, «мʼякі» заміни (— → ―∥,
// типографські лапки → 0x8167/0x8168, … → ...). Усе інше — помилка з
// переліком символів (encode) або '?' (encodeDetailed lenient).

const path = require('path');
const fs = require('fs');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'recom', 'tables.json'), 'utf8'));

const CMD = new Map(Object.entries(T.cmd).map(([k, v]) => [parseInt(k, 16), v]));   // lead → name
const CMD_REV = new Map([...CMD].map(([k, v]) => [v, k]));
const SJIS = new Map(Object.entries(T.sjis).map(([k, v]) => [parseInt(k, 16), v]));  // code → char
for (const [ch, hex] of Object.entries(T.cyr)) SJIS.set(parseInt(hex, 16), ch);
const SJIS_REV = new Map([...SJIS].map(([code, ch]) => [ch, code]));
const SOFT = new Map(Object.entries(T.soft).map(([ch, hex]) => [ch, Buffer.from(hex, 'hex')]));
const LEAD = new Set(T.lead);

const hex2 = (n) => n.toString(16).padStart(2, '0');
const hex4 = (n) => n.toString(16).padStart(4, '0');

function isPair(raw, i) {
  if (!LEAD.has(raw[i]) || i + 1 >= raw.length) return false;
  const t = raw[i + 1];
  return t >= 0x40 && t <= 0xFC && t !== 0x7F;
}

function decode(raw) {
  if (!raw || !raw.length) return '';
  const out = [];
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const c = raw[i++];
    if (c === 0x0A) { out.push('\n'); continue; }
    if (CMD.has(c) && i < n) { out.push('{' + CMD.get(c) + ' ' + hex2(raw[i]) + '}'); i++; continue; }
    if (c === 0x7B) { out.push('{{'); continue; }
    if (c >= 0x20 && c < 0x7F) { out.push(String.fromCharCode(c)); continue; }
    if (isPair(raw, i - 1)) {
      const code = (c << 8) | raw[i++];
      out.push(SJIS.get(code) || '{sjis ' + hex4(code) + '}');
      continue;
    }
    out.push('{b ' + hex2(c) + '}');
  }
  return out.join('');
}

function encodeTag(body) {
  const sp = body.indexOf(' ');
  const name = sp < 0 ? body : body.slice(0, sp);
  const arg = sp < 0 ? '' : body.slice(sp + 1);
  if (CMD_REV.has(name)) {
    if (!/^[0-9a-fA-F]{1,2}$/.test(arg)) return null;
    return [CMD_REV.get(name), parseInt(arg, 16)];
  }
  if (name === 'sjis') {
    const a = (arg || body.slice(4)).replace(/\s+/g, '');
    if (!/^([0-9a-fA-F]{2})+$/.test(a)) return null;
    return [...Buffer.from(a, 'hex')];
  }
  if (name === 'b') {
    if (!/^[0-9a-fA-F]{1,2}$/.test(arg)) return null;
    return [parseInt(arg, 16)];
  }
  // Сумісність зі старим синтаксисом застосунку: {0xF9,0x41}, <XX> не підтримуємо.
  if (/^0x[0-9a-fA-F]{1,2}(,0x[0-9a-fA-F]{1,2})*$/i.test(body)) {
    return body.split(',').map(p => parseInt(p.trim().slice(2), 16));
  }
  return null;
}

function encodeDetailed(text, opts) {
  const lenient = !!(opts && opts.lenient);
  const s = text == null ? '' : String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out = [];
  const unmapped = [];
  const n = s.length;
  let i = 0;
  const fail = (what, at) => {
    unmapped.push({ char: what, index: at, context: s.substring(at, Math.min(at + 24, n)) });
    if (lenient) out.push(0x3F);
  };
  while (i < n) {
    const ch = s[i];
    if (ch === '{') {
      if (s.startsWith('{{', i)) { out.push(0x7B); i += 2; continue; }
      const j = s.indexOf('}', i);
      if (j < 0) { fail('{', i); i++; continue; }
      const body = s.slice(i + 1, j);
      const bytes = encodeTag(body);
      if (bytes) out.push(...bytes); else fail('{' + body + '}', i);
      i = j + 1;
      continue;
    }
    i++;
    if (ch === '\n') { out.push(0x0A); continue; }
    const code = ch.charCodeAt(0);
    let full = ch;
    if (code >= 0xD800 && code <= 0xDBFF && i < n) { full = ch + s[i]; i++; }
    if (SJIS_REV.has(full)) { const c = SJIS_REV.get(full); out.push(c >> 8, c & 0xFF); continue; }
    if (code >= 0x20 && code < 0x7F) { out.push(code); continue; }
    if (SOFT.has(full)) { out.push(...SOFT.get(full)); continue; }
    fail(full, i - full.length);
  }
  return { bytes: Buffer.from(out), unmapped };
}

function encode(text) {
  const r = encodeDetailed(text);
  if (r.unmapped.length) {
    const uniq = [...new Set(r.unmapped.map(u => u.char))];
    const err = new Error('Символи без коду у Re:CoM: ' + uniq.slice(0, 8).map(c => '«' + c + '»').join(' ') +
      (uniq.length > 8 ? ' (+' + (uniq.length - 8) + ')' : '') + ' — біля: "' + r.unmapped[0].context + '"');
    err.unmapped = r.unmapped;
    throw err;
  }
  return r.bytes;
}

function glossaryKey(text) { return text == null ? '' : String(text).replace(/\r\n/g, '\n'); }

module.exports = { decode, encode, encodeDetailed, glossaryKey, TABLES: { CMD, SJIS, SOFT, LEAD } };
