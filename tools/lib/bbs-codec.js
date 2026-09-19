'use strict';

// Кодек тексту Birth by Sleep (PC, KH HD 1.5+2.5 ReMIX) — порт еталонного
// DropDistanceHD/BBS/tools/bbstext.py (+ bbsctd.py таблиці, cyrmap.py).
// Таблиці — у data/bbs/tables.json (згенеровано з тих самих .py, не передрук).
//
// Байти → текст:
//   0x0A                     → '\n'
//   <0x20                    → {U+00XX}
//   0x20..0x7E               → ASCII за таблицею m0 (0x5C = '¥'); '{' → '{{'
//   F1/F2/F5/F9 + param      → {icon triangle} {icon2 unk} {icon3 unk} {color white}
//                              (невідомий param — {icon 42})
//   0x99 + param             → латинська діакритика з таблиці m99, інакше {sjis 99xx}
//   інші lead (0x81-0x9F, 0xE0-0xEF) + trail
//                            → кирилиця (cyr: «переселена» на коди катакани 0x83xx),
//                              або символ cp932, якщо він однозначно кодується назад,
//                              інакше {sjis xxxx}
//   інший байт               → {b xx}
//
// Текст → байти: строго. Символ, якого гра не вміє показати, → помилка з
// переліком (encode) або '?' + список (encodeDetailed lenient).
// Додатково приймаємо старий синтаксис цього застосунку: {0xF1,0x30} і
// {:unk XX} (OpenKh) — як сирі байти.

const path = require('path');
const fs = require('fs');
const iconv = require('iconv-lite');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'bbs', 'tables.json'), 'utf8'));
const FONT_IDS = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'bbs', 'font-ids.json'), 'utf8')));

const M0 = [...T.m0];      // масиви code point'ів, бо у таблицях є не-BMP? (ні, але безпечно)
const M99 = [...T.m99];
const CMD = new Map(Object.entries(T.cmd).map(([k, v]) => [parseInt(k, 16), v]));      // lead → name
const CMD_REV = new Map([...CMD].map(([k, v]) => [v, k]));
const ICON = new Map(Object.entries(T.icon).map(([lead, tbl]) =>
  [parseInt(lead, 16), new Map(Object.entries(tbl).map(([p, n]) => [parseInt(p, 16), n]))]));
const ICON_REV = new Map([...ICON].map(([lead, tbl]) => [lead, new Map([...tbl].map(([p, n]) => [n, p]))]));
const LEAD = new Set(T.lead);
const CYR = new Map(Object.entries(T.cyr).map(([ch, hex]) => [ch, parseInt(hex, 16)]));   // char → code
const CYR_REV = new Map([...CYR].map(([ch, code]) => [code, ch]));
const INV0 = new Map(M0.map((ch, i) => [ch, 0x20 + i]));
const INV99 = new Map(M99.map((ch, i) => [ch, 0x80 + i]));

const hex2 = (n) => n.toString(16).padStart(2, '0');
const hex4 = (n) => n.toString(16).padStart(4, '0');

// cp932 через iconv-lite. Python-еталон: decode(pair) має дати рівно 1 символ.
function cp932DecodePair(lead, trail) {
  const s = iconv.decode(Buffer.from([lead, trail]), 'cp932');
  if (s.length !== 1 || s === '�') return null;
  return s;
}
function cp932EncodeChar(ch) {
  const b = iconv.encode(ch, 'cp932');
  if (b.length !== 2) return null;            // однобайтові й нерозпізнані ('?')
  if (b[0] === 0x99) return null;             // 0x99 у грі — латиниця, не кандзі
  return b;
}

// символ → 2-байтова послідовність або null (Python: _sjis_encode)
function sjisEncode(ch) {
  const code = CYR.get(ch);
  if (code !== undefined) return Buffer.from([code >> 8, code & 0xFF]);
  return cp932EncodeChar(ch);
}
// пара → символ або null (Python: _sjis_decode)
function sjisDecode(lead, trail) {
  const ch = CYR_REV.get((lead << 8) | trail);
  if (ch !== undefined) return ch;
  return cp932DecodePair(lead, trail);
}

function decode(bytes) {
  const out = [];
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const c = bytes[i++];
    if (c < 0x20) { out.push(c === 0x0A ? '\n' : '{U+' + hex4(c).toUpperCase() + '}'); continue; }
    if (c < 0x7F) { const ch = M0[c - 0x20]; out.push(ch === '{' ? '{{' : ch); continue; }
    if (CMD.has(c) && i < n) {
      const p = bytes[i++];
      const name = ICON.get(c).get(p);
      out.push('{' + CMD.get(c) + ' ' + (name || hex2(p)) + '}');
      continue;
    }
    if (LEAD.has(c) && i < n) {
      const p = bytes[i++];
      if (c === 0x99) {
        const k = p - 0x80;
        out.push(k >= 0 && k < M99.length ? M99[k] : '{sjis ' + hex2(c) + hex2(p) + '}');
        continue;
      }
      const ch = sjisDecode(c, p);
      if (ch !== null) {
        const back = sjisEncode(ch);
        if (back && back[0] === c && back[1] === p) { out.push(ch); continue; }
      }
      out.push('{sjis ' + hex2(c) + hex2(p) + '}');
      continue;
    }
    out.push('{b ' + hex2(c) + '}');
  }
  return out.join('');
}

// Розбір `{...}` вставки → масив байтів або null (невідома вставка).
function encodeTag(body) {
  const sp = body.indexOf(' ');
  const name = sp < 0 ? body : body.slice(0, sp);
  const arg = sp < 0 ? '' : body.slice(sp + 1);
  if (CMD_REV.has(name)) {
    const lead = CMD_REV.get(name);
    const rev = ICON_REV.get(lead);
    if (rev.has(arg)) return [lead, rev.get(arg)];
    if (/^[0-9a-fA-F]{1,2}$/.test(arg)) return [lead, parseInt(arg, 16)];
    return null;
  }
  if (name === '81' || name === '99') {
    const a = arg || body.slice(2);
    if (!/^[0-9a-fA-F]{1,2}$/.test(a)) return null;
    return [parseInt(name, 16), parseInt(a, 16)];
  }
  if (name === 'sjis') {
    const a = arg.replace(/\s+/g, '');
    if (!/^([0-9a-fA-F]{2})+$/.test(a)) return null;
    return [...Buffer.from(a, 'hex')];
  }
  if (name === 'b') {
    if (!/^[0-9a-fA-F]{1,2}$/.test(arg)) return null;
    return [parseInt(arg, 16)];
  }
  if (/^U\+[0-9a-fA-F]{1,4}$/.test(name)) {
    const v = parseInt(name.slice(2), 16);
    return v < 0x100 ? [v] : null;
  }
  // Сумісність зі старим синтаксисом цього застосунку / OpenKh.
  if (/^0x[0-9a-fA-F]{1,2}(,0x[0-9a-fA-F]{1,2})*$/i.test(body)) {
    return body.split(',').map(p => parseInt(p.trim().slice(2), 16));
  }
  const unk = body.match(/^:unk\s+([0-9a-fA-F]{1,2})$/);
  if (unk) return [parseInt(unk[1], 16)];
  return null;
}

// encodeDetailed(text, { lenient }) → { bytes, unmapped: [{char, index, context}] }
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
      if (s.startsWith('{{', i)) { out.push(INV0.get('{')); i += 2; continue; }
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
    if (INV0.has(ch)) { out.push(INV0.get(ch)); continue; }
    // Surrogate pair (емодзі) — один символ.
    const code = ch.charCodeAt(0);
    let full = ch;
    if (code >= 0xD800 && code <= 0xDBFF && i < n) { full = ch + s[i]; i++; }
    const pair = sjisEncode(full);
    if (pair) { out.push(pair[0], pair[1]); continue; }
    if (INV99.has(full)) { out.push(0x99, INV99.get(full)); continue; }
    fail(full, i - full.length);
  }
  return { bytes: Buffer.from(out), unmapped };
}

function encode(text) {
  const r = encodeDetailed(text);
  if (r.unmapped.length) {
    const uniq = [...new Set(r.unmapped.map(u => u.char))];
    const err = new Error('Гра не вміє показати: ' + uniq.slice(0, 8).map(c => '«' + c + '»').join(' ') +
      (uniq.length > 8 ? ' (+' + (uniq.length - 8) + ')' : '') + ' — біля: "' + r.unmapped[0].context + '"');
    err.unmapped = r.unmapped;
    throw err;
  }
  return r.bytes;
}

// Коди гліфів (2-байтові), яких немає у пропатченому FontEn.arc — щоб
// попередити перекладача (як bbstext.missing_glyphs). ASCII рушій мапить сам.
function missingGlyphs(bytes) {
  const out = new Set();
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const c = bytes[i++];
    if (c < 0x20) continue;
    if (CMD.has(c)) { i++; continue; }
    if (c < 0x7F) continue;
    if (LEAD.has(c) && i < n) {
      const cid = (c << 8) | bytes[i++];
      if (!FONT_IDS.has(cid)) out.add(hex4(cid).toUpperCase());
    }
  }
  return [...out];
}

// Ключ глосарія: decode вже канонічний (усі параметри команд видимі).
function glossaryKey(text) { return text == null ? '' : String(text).replace(/\r\n/g, '\n'); }

module.exports = {
  decode, encode, encodeDetailed, missingGlyphs, glossaryKey,
  TABLES: { M0, M99, CMD, ICON, CYR, LEAD }
};
