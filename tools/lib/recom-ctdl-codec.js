'use strict';

// Re:Chain of Memories CTDL text codec.
// Окремий від BBS CTD codec — формат байтів інший:
//   • Базова кодірівка: Shift-JIS (lead bytes 0x81-0x9F, 0xE0-0xFC)
//   • Newline: 0x0A
//   • Latin Extended (À, é, ß, тощо) і символи (©, ®, ™, ♥, €, °, etc.):
//       0x99 0x80..0xD0 (одна 2-байтова послідовність на символ)
//   • Іконки кнопок (geyemepad/keyboard): 0xFF 0x00..0x14 → токен `{BTN_X}`
//   • Альтернативні (ширші) іконки кнопок: 0xF5 0x64..0x7E → теж `{BTN_X}`
//     (ці використовуються в гідах/підказках там, де треба інша геометрія)
//   • Командні маркери: 0xF9 0x41 / 0xF9 0x59 / 0xF9 0xFF → токени
//     `<Unk41>` / `<Unk59>` / `<EMPTYBLOCK>`
//   • Невідомі окремі байти ≥ 0x80 → `<XX>` hex-токен (щоб не втратити при
//     re-encode)
//
// Експорти:
//   decode(buf) → string  (сирі байти повідомлення → tokenized text)
//   encode(str) → Buffer  (tokenized text → байти, без 0x00 терминатора)
//   glossaryKey(str) → string  (нормалізація для словника)

const iconv = require('iconv-lite');

// ---- Mapping tables ----------------------------------------------------

// Іконки кнопок 0xFF 0x00..0x14 → токени.
// Беремо мапу 1:1 з C# джерела (CtdlFile.cs ButtonIconMap), але форматуємо
// як `{BTN_X}` (з фігурними дужками) — щоб збігатися зі стилем токенів,
// які вже використовуються в інших codec'ах застосунку.
const BTN_FF = {
  0x00: 'BTN_A',         0x01: 'BTN_S',          0x02: 'BTN_LCLICK',
  0x03: 'BTN_SPACE',     0x04: 'BTN_RIGHT',      0x05: 'BTN_LEFT',
  0x06: 'BTN_DOWN',      0x07: 'BTN_UP',         0x08: 'BTN_LEFTRIGHT',
  0x09: 'BTN_UPDOWN',    0x0A: 'BTN_DPAD',       0x0B: 'BTN_W',
  0x0C: 'BTN_STICK',     0x0D: 'BTN_MOUSE',      0x0E: 'BTN_WASD',
  0x0F: 'BTN_R',         0x10: 'BTN_SHIFT',      0x11: 'BTN_F',
  0x12: 'BTN_RCLICK',    0x13: 'BTN_SPACE2',     0x14: 'BTN_LCLICK2'
};
// Reverse для encode: prefer specific codes, але і `BTN_SPACE` → 0xFF03 не 0xF565.
// (Альтернативні F5-version будуть кодуватись ТОЧНО якщо у тексті був той самий
// токен зі специфічним суфіксом, інакше defaults до FF-version.)
const BTN_FF_REV = {};
for (const [code, name] of Object.entries(BTN_FF)) {
  BTN_FF_REV[name] = parseInt(code, 10);
}

// Альтернативні button glyphs 0xF5 0x64..0x7E. У C# коді частина цих
// дублює FF-варіанти (BTN_LCLICK, BTN_SPACE, ...), але у файлі вони присутні
// як окремі байт-послідовності. Щоб не втрачати їх при round-trip, маркуємо
// унікальним суфіксом `_F5XX`.
const BTN_F5 = {
  0x64: 'BTN_LCLICK_F564', 0x65: 'BTN_SPACE_F565',  0x66: 'BTN_RCLICK_F566',
  0x67: 'BTN_F_F567',      0x68: 'BTN_SHIFT_F568',  0x69: 'BTN_R_F569',
  0x70: 'BTN_WASD_F570',   0x71: 'BTN_MOUSE_F571',  0x72: 'BTN_STICK_F572',
  0x73: 'BTN_W_F573',      0x74: 'BTN_DPAD_F574',   0x75: 'BTN_UPDOWN_F575',
  0x76: 'BTN_LEFTRIGHT_F576', 0x77: 'BTN_UP_F577',  0x78: 'BTN_DOWN_F578',
  0x79: 'BTN_LEFT_F579',   0x7A: 'BTN_RIGHT_F57A',  0x7B: 'BTN_SPACE_F57B',
  0x7C: 'BTN_LCLICK_F57C', 0x7D: 'BTN_S_F57D',      0x7E: 'BTN_A_F57E'
};
const BTN_F5_REV = {};
for (const [code, name] of Object.entries(BTN_F5)) {
  BTN_F5_REV[name] = parseInt(code, 10);
}

// Командні маркери 0xF9 + low byte. C# знає лише три, інші — лишимо raw.
const CMD_F9 = {
  0x41: 'Unk41',
  0x59: 'Unk59',
  0xFF: 'EMPTYBLOCK'
};
const CMD_F9_REV = {};
for (const [code, name] of Object.entries(CMD_F9)) {
  CMD_F9_REV[name] = parseInt(code, 10);
}

// Latin Extended і символи 0x99 0x80..0xD0. 1:1 з C# (ExtendedCharMap).
const EXT_99 = {
  0x80: 'À', 0x81: 'Á', 0x82: 'Â', 0x83: 'Ä',
  0x84: 'Æ', 0x85: 'Ç', 0x86: 'È', 0x87: 'É',
  0x88: 'Ê', 0x89: 'Ë', 0x8A: 'Ì', 0x8B: 'Í',
  0x8C: 'Î', 0x8D: 'Ï', 0x8E: 'Ñ', 0x8F: 'Ò',
  0x90: 'Ó', 0x91: 'Ô', 0x92: 'Õ', 0x93: 'Ö',
  0x94: 'Œ', 0x95: 'Ù', 0x96: 'Ú', 0x97: 'Û',
  0x98: 'Ü', 0x99: 'ß', 0x9A: 'à', 0x9B: 'á',
  0x9C: 'â', 0x9D: 'ä', 0x9E: 'æ', 0x9F: 'ç',
  0xA0: 'è', 0xA1: 'é', 0xA2: 'ê', 0xA3: 'ë',
  0xA4: 'ì', 0xA5: 'í', 0xA6: 'î', 0xA7: 'ï',
  0xA8: 'ñ', 0xA9: 'ò', 0xAA: 'ó', 0xAB: 'ô',
  0xAC: 'õ', 0xAD: 'ö', 0xAE: 'ù', 0xAF: 'ú',
  0xB0: 'û', 0xB1: 'ü', 0xB2: 'œ', 0xB3: '¿',
  0xB4: '¡', 0xB5: ',', 0xB6: '—' /* — */, 0xB7: '–',
  0xB8: '⁰', 0xB9: '«', 0xBA: '»', 0xBB: '≤',
  0xBC: '≥', 0xBD: '♥', 0xBE: '¹', 0xBF: '²',
  0xC0: '³', 0xC1: '⁴', 0xC2: '⁵', 0xC3: '£',
  0xC4: '€', 0xC5: '§', 0xC6: '∂', 0xC7: '¢',
  0xC8: '"', 0xC9: '`', 0xCA: '´', 0xCB: '©',
  0xCC: '®', 0xCD: '™', 0xCE: '-', 0xCF: '°',
  0xD0: '□'
};
const EXT_99_REV = {};
for (const [code, ch] of Object.entries(EXT_99)) {
  // Якщо символ дублюється (наприклад "," чи "-" чи "‒"), reverse-map
  // лишає першу появу — це дозволяє не перетворювати ASCII-кому/дефіс
  // у 2-байтову послідовність 0x99 при encode.
  if (!(ch in EXT_99_REV)) EXT_99_REV[ch] = parseInt(code, 10);
}
// Прибираємо ASCII-look-alikes з reverse мапи: ASCII символи `,`, `-`, `"`,
// `\``, ` ` ніколи не мають кодуватись як 0x99 NN — інакше ми зламаємо файл.
delete EXT_99_REV[','];
delete EXT_99_REV['-'];
delete EXT_99_REV['"'];
delete EXT_99_REV['`'];

// ---- Helpers ------------------------------------------------------------

function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function isSjisLead(b) {
  return (b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC);
}

// ---- decode(bytes) → string --------------------------------------------

function decode(buf) {
  if (!buf || !buf.length) return '';
  const parts = [];
  let i = 0;
  // Накопичувач ASCII/SJIS пар, який потім декодуємо одним викликом iconv.
  let sjisRun = [];
  const flushSjis = () => {
    if (!sjisRun.length) return;
    parts.push(iconv.decode(Buffer.from(sjisRun), 'shift_jis'));
    sjisRun = [];
  };

  while (i < buf.length) {
    const b = buf[i];

    // 0xFF 0xXX → button icon
    if (b === 0xFF && i + 1 < buf.length) {
      const lo = buf[i + 1];
      const name = BTN_FF[lo];
      if (name) {
        flushSjis();
        parts.push('{' + name + '}');
        i += 2;
        continue;
      }
    }

    // 0xF5 0xXX → alt button icon
    if (b === 0xF5 && i + 1 < buf.length) {
      const lo = buf[i + 1];
      const name = BTN_F5[lo];
      if (name) {
        flushSjis();
        parts.push('{' + name + '}');
        i += 2;
        continue;
      }
    }

    // 0xF9 0xXX → command marker
    if (b === 0xF9 && i + 1 < buf.length) {
      const lo = buf[i + 1];
      const name = CMD_F9[lo];
      if (name) {
        flushSjis();
        parts.push('<' + name + '>');
        i += 2;
        continue;
      }
    }

    // 0x99 0xXX → Latin Extended / symbol
    if (b === 0x99 && i + 1 < buf.length) {
      const lo = buf[i + 1];
      const ch = EXT_99[lo];
      if (ch) {
        flushSjis();
        parts.push(ch);
        i += 2;
        continue;
      }
    }

    // newline
    if (b === 0x0A) {
      flushSjis();
      parts.push('\n');
      i++;
      continue;
    }

    // Shift-JIS 2-byte
    if (isSjisLead(b) && i + 1 < buf.length) {
      sjisRun.push(b, buf[i + 1]);
      i += 2;
      continue;
    }

    // ASCII single byte
    if (b < 0x80) {
      sjisRun.push(b);
      i++;
      continue;
    }

    // Невідомий ≥ 0x80 байт — вивід як hex token, щоб не втратити при
    // повторному encode.
    flushSjis();
    parts.push('<' + hex2(b) + '>');
    i++;
  }
  flushSjis();
  return parts.join('');
}

// ---- encode(string) → Buffer -------------------------------------------

// Regex для розпізнавання токенів у тексті:
//   {BTN_XXX[_F5XX]}     — button icon
//   <Unk41>/<Unk59>/<EMPTYBLOCK>  — known commands
//   <XX>                 — raw single-byte hex
//   <XXXX>               — raw two-byte hex
const TOKEN_RE = /\{(BTN_[A-Z0-9_]+)\}|<(Unk41|Unk59|EMPTYBLOCK)>|<([0-9A-Fa-f]{4})>|<([0-9A-Fa-f]{2})>/g;

function encode(text) {
  if (text == null) return Buffer.alloc(0);
  const out = [];

  // Розбиваємо текст на сегменти "звичайний текст" і "токен".
  // Між токенами — звичайний текст обробляємо char-by-char.
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > cursor) {
      _encodeRun(text.slice(cursor, m.index), out);
    }
    if (m[1]) {
      // {BTN_X}
      const name = m[1];
      // Спочатку перевіряємо суфіксовану F5-версію
      if (name in BTN_F5_REV) {
        out.push(0xF5, BTN_F5_REV[name]);
      } else if (name in BTN_FF_REV) {
        out.push(0xFF, BTN_FF_REV[name]);
      } else {
        // Невідомий BTN-токен — пишемо як literal `{BTN_...}` у SJIS
        _encodeRun(m[0], out);
      }
    } else if (m[2]) {
      // <Unk41> etc
      const code = CMD_F9_REV[m[2]];
      out.push(0xF9, code);
    } else if (m[3]) {
      // <XXXX>
      out.push(parseInt(m[3].slice(0, 2), 16), parseInt(m[3].slice(2, 4), 16));
    } else if (m[4]) {
      // <XX>
      out.push(parseInt(m[4], 16));
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    _encodeRun(text.slice(cursor), out);
  }
  return Buffer.from(out);
}

// Кодування "звичайного" сегмента (без токенів). Перебираємо char-by-char,
// бо SJIS — змінна довжина і extended символи — окремі 2-байтові послідовності.
function _encodeRun(seg, out) {
  let pendingSjis = '';
  const flushSjis = () => {
    if (!pendingSjis) return;
    const enc = iconv.encode(pendingSjis, 'shift_jis');
    for (let i = 0; i < enc.length; i++) out.push(enc[i]);
    pendingSjis = '';
  };
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === '\r') continue; // Windows CRLF — тільки \n у форматі
    if (ch === '\n') {
      flushSjis();
      out.push(0x0A);
      continue;
    }
    if (ch in EXT_99_REV) {
      flushSjis();
      out.push(0x99, EXT_99_REV[ch]);
      continue;
    }
    pendingSjis += ch;
  }
  flushSjis();
}

// ---- Glossary key ------------------------------------------------------
// Нормалізація тексту для словника: ми беремо чистий текст без runtime-
// специфічних маркерів. У Re:CoM немає special "F1/F2/F5" 2-byte sequences
// які треба було б "відкидати" для канонічної форми (як у BBS), тому
// glossaryKey просто збігається з вихідним рядком.
function glossaryKey(text) {
  if (text == null) return '';
  // Прибираємо trailing whitespace, нормалізуємо CRLF → LF.
  return String(text).replace(/\r\n/g, '\n');
}

module.exports = {
  decode,
  encode,
  glossaryKey,
  TABLES: { BTN_FF, BTN_F5, CMD_F9, EXT_99 }
};
