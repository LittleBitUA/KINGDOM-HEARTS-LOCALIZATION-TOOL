'use strict';

const path = require('path');
const fs = require('fs');

const BASE_PATH = path.join(__dirname, '..', 'data', 'kh1sys_text.json');
const OVERLAY_PATH = path.join(__dirname, '..', 'data', 'ukrainian.json');
const MULTI_PATH = path.join(__dirname, '..', 'data', 'kh1sys_multi.json');

// 2-байтові керівні префікси: після такого байта йде ОБОВʼЯЗКОВО ще один
// параметр-байт (тривалість паузи, ID кольору тощо). Якщо комбінація
// невідома — декодер вертає її як один токен `{0xAA,0xBB}`, щоб перекладач
// випадково не порвав команду посередині (інакше параметр може потрапити
// у літерний діапазон і виглядати як «R», «v», «7» — і його видалять).
//
// Mapping (на основі syscall-таблиці gg3502/KH1-EVDL-ARD-EDITOR):
//   0x05 — Set Window Type    (param: тип рамки)
//   0x06 — Set Window Opening Speed (param: швидкість відкриття)
//   0x07 — Set Message Display Speed (param: швидкість виводу букв)
//   0x09 — Display Register Value   (param: ID регістру/іконки кнопки)
//   0x0C — (в тексті) Color prefix  (param: колір)
//   0x0E — (в тексті) VarItem prefix (param: ID змінної)
// Не включено:
//   0x08 (Set Wait Timer): дані неоднозначні — інколи виглядає як single-byte
//        маркер «початок повідомлення» (`{0x08}Obtained...`).
//   0x0A/0x0B: завжди йдуть з 0x00 і працюють як «end-message» single-byte
//        маркери. Зробити їх 2-байтовими — поглине {eol} і зламає рядки.
const PREFIX_BYTES = new Set([0x05, 0x06, 0x07, 0x09, 0x0C, 0x0E]);

// Режими decode:
//   'overlay' — overlay повністю перекриває base (UA-файл: усі байти → кирилиця,
//               включно з байтами латинських A/B/C/…, які UA-шрифт
//               перевикористовує як А/В/С/…).
//   'base'    — лише KH1SYS_Text (ENG-файл: чиста латиниця; використовується
//               для extract/glossary-ключів, щоб «Potion» завжди був Latin).
//   'smart'   — overlay лише для байтів, чий base-гліф НЕ є ASCII (тобто для
//               «справжніх» нових кириличних кліток ≥0xC8 і `<`/`>`), а спільні
//               latin-lookalike байти показуються латиницею. Для Editor-режиму:
//               ENG-файл читається як ENG, а UA-файл — без втрат (encode
//               мапить і 'A', і 'А' у той самий байт).
const MODES = ['overlay', 'base', 'smart'];
const cache = { overlay: null, base: null, smart: null };

function modeFromOpts(opts) {
  if (!opts || opts.overlay === undefined || opts.overlay === true) return 'overlay';
  if (opts.overlay === false) return 'base';
  if (opts.overlay === 'smart') return 'smart';
  return 'overlay';
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readJsonOptional(p) {
  try { return readJson(p); } catch (_) { return null; }
}

function isAsciiGlyph(v) {
  return typeof v === 'string' && v.length === 1 && v.charCodeAt(0) < 0x80;
}

function load(mode = 'overlay') {
  if (mode === true) mode = 'overlay';
  if (mode === false) mode = 'base';
  if (!MODES.includes(mode)) mode = 'overlay';
  if (cache[mode]) return cache[mode];

  const base = readJson(BASE_PATH);
  const overlay = mode !== 'base' ? readJsonOptional(OVERLAY_PATH) : null;
  const multi = readJsonOptional(MULTI_PATH) || {};

  // ---- single-byte decode map ----
  const singleMap = new Map();
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith('_')) continue;
    singleMap.set(Number(k), v);
  }
  if (overlay && overlay.decode) {
    for (const [k, v] of Object.entries(overlay.decode)) {
      if (k.startsWith('_')) continue;
      const byte = Number(k);
      // 'smart': не перекриваємо ASCII-гліфи base (latin lookalikes).
      if (mode === 'smart' && isAsciiGlyph(base[k])) continue;
      singleMap.set(byte, v);
    }
  }

  // ---- multi-byte decode map: (b1<<8 | b2) -> token ----
  const multiMap = new Map();
  for (const [token, pair] of Object.entries(multi)) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    multiMap.set(((pair[0] & 0xFF) << 8) | (pair[1] & 0xFF), token);
  }

  // ---- reverse map for encode: [[token, [byte, ...]], ...] ----
  // Для encode overlay-режими ('overlay' і 'smart') ідентичні: приймаємо і
  // латиницю, і кирилицю; різниця лише у decode.
  const seen = new Set();
  const reverse = [];

  function pushEntry(token, bytesArr) {
    if (typeof token !== 'string' || token.length === 0) return;
    const key = token + '|' + bytesArr.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    reverse.push([token, bytesArr]);
  }

  const overlayDecode = (overlay && overlay.decode) || {};
  const overlayEncodeOnly = (overlay && overlay.encodeOnly) || {};

  const allBytes = new Set();
  for (const k of Object.keys(base)) if (!k.startsWith('_')) allBytes.add(Number(k));
  for (const k of Object.keys(overlayDecode)) if (!k.startsWith('_')) allBytes.add(Number(k));
  const sortedBytes = [...allBytes].sort((a, b) => a - b);

  // For each byte (ascending): overlay value first (preferred), then base
  // value as fallback for input. Lower byte wins on string-collision ties
  // (stable sort preserves insertion order).
  for (const byte of sortedBytes) {
    const ov = overlayDecode[byte];
    const baseVal = base[byte];
    if (typeof ov === 'string' && ov.length > 0) pushEntry(ov, [byte]);
    if (typeof baseVal === 'string' && baseVal.length > 0 && baseVal !== ov) {
      pushEntry(baseVal, [byte]);
    }
  }

  for (const [str, b] of Object.entries(overlayEncodeOnly)) {
    if (str.startsWith('_')) continue;
    const byte = Number(b);
    if (Number.isFinite(byte)) pushEntry(str, [byte]);
  }

  for (const [token, pair] of Object.entries(multi)) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    pushEntry(token, [pair[0] & 0xFF, pair[1] & 0xFF]);
  }

  // encodeAliases: альтернативні імена токенів (Pro100luk-style з пробілами)
  // або типографічні замінники (№ → "no." як 3 байти).
  // Лише для encode — на decode зберігається канонічна назва.
  // Підтримуємо arbitrary-length byte arrays.
  if (multi && multi.encodeAliases && typeof multi.encodeAliases === 'object') {
    for (const [token, pair] of Object.entries(multi.encodeAliases)) {
      if (!Array.isArray(pair) || pair.length === 0) continue;
      pushEntry(token, pair.map(b => b & 0xFF));
    }
  }

  reverse.sort((a, b) => {
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return 0;
  });

  // Індекс за першим символом токена: encode дивиться лише на кандидати, що
  // починаються з поточного символу (замість лінійного перебору всіх ~300).
  // Порядок усередині bucket'а — той самий (довші перші), тож результат
  // ідентичний старому лінійному пошуку.
  const byFirstChar = new Map();
  for (const entry of reverse) {
    const c = entry[0].charCodeAt(0);
    let bucket = byFirstChar.get(c);
    if (!bucket) { bucket = []; byFirstChar.set(c, bucket); }
    bucket.push(entry);
  }

  cache[mode] = { singleMap, multiMap, reverse, byFirstChar, mode };
  return cache[mode];
}

function hex2(b) {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

function decode(bytes, opts) {
  const { singleMap, multiMap } = load(modeFromOpts(opts));
  const NL = '\n';
  const len = bytes.length;
  let out = '';
  let i = 0;

  while (i < len) {
    const b = bytes[i];

    if (PREFIX_BYTES.has(b) && i + 1 < len) {
      const combo = (b << 8) | bytes[i + 1];
      const tok = multiMap.get(combo);
      if (tok !== undefined) {
        out += tok;
        i += 2;
        continue;
      }
      // Невідома 2-байтова команда — пакуємо в один токен `{0xAA,0xBB}`,
      // щоб параметр не «потрапив» у літерний діапазон і не був випадково
      // видалений перекладачем (типовий випадок: `0x06 0x3C` показувалося
      // як `{0x06}R` і зникало при HTML-імпорті).
      out += '{0x' + hex2(b) + ',0x' + hex2(bytes[i + 1]) + '}';
      i += 2;
      continue;
    }

    let v = singleMap.get(b);
    if (v === undefined) {
      v = '{0x' + hex2(b) + '}';
    }
    if (v === '{eol}') out += '{eol}' + NL;
    else out += v;
    i++;
  }

  return out;
}

function isHex(c) {
  return (c >= 0x30 && c <= 0x39) ||
         (c >= 0x41 && c <= 0x46) ||
         (c >= 0x61 && c <= 0x66);
}

// encodeDetailed(text, opts?) → { bytes: Buffer, unmapped: [{index, char, context}] }
//   opts.overlay — true|false|'smart' (для encode 'smart' ≡ true)
//   opts.lenient — не кидати на незакодованих символах: писати 0x3F ('?') і
//                  повертати їх у result.unmapped.
// Без lenient кидає Error зі СПИСКОМ усіх незакодованих символів (не лише
// першого), щоб composeAll міг показати перекладачу, що саме виправляти.
function encodeDetailed(text, opts) {
  const { byFirstChar } = load(modeFromOpts(opts));
  const lenient = !!(opts && opts.lenient);
  let s = text == null ? '' : String(text);

  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.split('{eol}\n').join('{eol}');
  s = s.split('\n').join('{eol}');

  const len = s.length;
  const bytes = [];
  const unmapped = [];
  let i = 0;

  while (i < len) {
    const c0 = s.charCodeAt(i);
    // 2-байтове hex-комбо `{0xAA,0xBB}` — 11 символів. Парсимо першим,
    // щоб не з'їстися single-byte парсером нижче.
    if (c0 === 0x7B) {
      if (i + 11 <= len &&
          s.charCodeAt(i + 1)  === 0x30 &&    // 0
          (s.charCodeAt(i + 2) === 0x78 || s.charCodeAt(i + 2) === 0x58) &&
          isHex(s.charCodeAt(i + 3)) &&
          isHex(s.charCodeAt(i + 4)) &&
          s.charCodeAt(i + 5)  === 0x2C &&    // ,
          s.charCodeAt(i + 6)  === 0x30 &&    // 0
          (s.charCodeAt(i + 7) === 0x78 || s.charCodeAt(i + 7) === 0x58) &&
          isHex(s.charCodeAt(i + 8)) &&
          isHex(s.charCodeAt(i + 9)) &&
          s.charCodeAt(i + 10) === 0x7D) {    // }
        bytes.push(parseInt(s.substr(i + 3, 2), 16));
        bytes.push(parseInt(s.substr(i + 8, 2), 16));
        i += 11;
        continue;
      }
      if (i + 6 <= len &&
          s.charCodeAt(i + 1) === 0x30 &&
          (s.charCodeAt(i + 2) === 0x78 || s.charCodeAt(i + 2) === 0x58) &&
          isHex(s.charCodeAt(i + 3)) &&
          isHex(s.charCodeAt(i + 4)) &&
          s.charCodeAt(i + 5) === 0x7D) {
        bytes.push(parseInt(s.substr(i + 3, 2), 16));
        i += 6;
        continue;
      }
    }

    let matched = false;
    const bucket = byFirstChar.get(c0);
    if (bucket) {
      for (let j = 0; j < bucket.length; j++) {
        const token = bucket[j][0];
        const tlen = token.length;
        if (i + tlen > len) continue;
        let ok = true;
        for (let k = 1; k < tlen; k++) {
          if (s.charCodeAt(i + k) !== token.charCodeAt(k)) { ok = false; break; }
        }
        if (ok) {
          const bs = bucket[j][1];
          for (let m = 0; m < bs.length; m++) bytes.push(bs[m]);
          i += tlen;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // Surrogate pair (емодзі тощо) — беремо обидва code units як один символ.
      const isHigh = c0 >= 0xD800 && c0 <= 0xDBFF;
      const chLen = (isHigh && i + 1 < len) ? 2 : 1;
      unmapped.push({ index: i, char: s.substr(i, chLen), context: s.substring(i, Math.min(i + 16, len)) });
      if (lenient) bytes.push(0x3F);
      // Продовжуємо сканувати, щоб зібрати ВСІ проблемні символи для помилки.
      i += chLen;
    }
  }

  if (unmapped.length && !lenient) {
    const uniq = [];
    const seenCh = new Set();
    for (const u of unmapped) {
      if (seenCh.has(u.char)) continue;
      seenCh.add(u.char);
      uniq.push(u);
    }
    const list = uniq.slice(0, 8).map(u => '«' + u.char + '»').join(' ');
    const more = uniq.length > 8 ? ' (+' + (uniq.length - 8) + ')' : '';
    const err = new Error(
      'Не вдалося закодувати символи: ' + list + more +
      ' — біля: "' + unmapped[0].context + '"'
    );
    err.unmapped = unmapped;
    throw err;
  }

  return { bytes: Buffer.from(bytes), unmapped };
}

function encode(text, opts) {
  return encodeDetailed(text, opts).bytes;
}

function loadMap() {
  return load('overlay').singleMap;
}

module.exports = { decode, encode, encodeDetailed, loadMap, load, PREFIX_BYTES };
