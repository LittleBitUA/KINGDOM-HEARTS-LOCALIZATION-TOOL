'use strict';

// CTD codec для Birth By Sleep (PC реліз).
// Власна реалізація — мапінги виведено емпірично з аналізу EN-файлів.
//
// Дизайн (узгоджено з користувачем, варіант B):
//  • Стандартна типографія декодується у звичайний Unicode (— ' " é …),
//    щоб перекладач бачив чистий текст.
//  • Іконки кнопок — Unicode-фігури (▲ ◯ □ ✕ ← → ↑ ↓ ●).
//  • Зміна кольору тексту → інлайн-маркер `[c:name]`.
//  • Невідомі байтові послідовності → graceful raw-escape `{0xXX}` /
//    `{0xXX,0xYY}` (round-trip без втрат).
//
// КРИТИЧНО: один байт ↔ один Unicode символ (1-к-1). Якщо мапінг не
// підтверджений візуально — лишаємо як raw escape, інакше encode втратить
// інформацію.
//
// Round-trip контракт: encode(decode(buf)) === buf (байт у байт).

// ---------------------------------------------------------------------
// Mapping tables — лише підтверджені 1-к-1 мапінги.
// ---------------------------------------------------------------------

// 0x81 0xXX → typography.
// LOSSY: декілька байтових послідовностей мапляться у ту саму ASCII-літеру,
// бо в самій грі font-atlas рендерить їх ідентично (підтверджено OpenKh
// CTD Editor — він теж колапсує). Round-trip для цих байтів не зберігається,
// зате glossary-import з HTML (де перекладачі пишуть звичайні '-' / "'")
// працює як треба, і в готовому файлі стоятимуть валідні ASCII-байти.
const PAIR_81 = {
  0x40: ' ',          // ideographic / fixed-width space — у грі візуально як ASCII space
  0x5C: '-',          // dash variant — рендериться як ASCII hyphen
  0x61: '-',          // інший dash variant — також рендериться як hyphen
  0x67: "'",          // smart left single quote — як ASCII '
  0x68: "'",          // smart right single quote — як ASCII '
  0x46: '·',          // middle dot — нема ASCII еквіваленту, безпечно
  0xA1: '■'           // square bullet — нема ASCII еквіваленту, безпечно
};

// 0x99 0xXX → extended Latin
const PAIR_99 = {
  0xA1: 'é'           // é — підтверджено "cliché."
};

// 0xF1 0xXX → button icons
// Лишаємо порожнім поки не підтвердимо — щоб не плутати кнопки між собою.
const PAIR_F1 = {
};

// 0xF2 0xXX → other icons
const PAIR_F2 = {
};

// 0xF5 0xXX → action/HUD icons
const PAIR_F5 = {
};

// 0xF9 0xXX → color state changes (інлайн `[c:name]`)
// Імена побудовані з контексту, але мапінг 1-к-1, тож round-trip ок.
const PAIR_F9 = {
  0x41: 'default',
  0x50: 'green',
  0x58: 'white',
  0x59: 'yellow'
};

// ---------------------------------------------------------------------
// Inverse maps — генеруються один раз.
// ---------------------------------------------------------------------
const INV_81 = invert(PAIR_81);
const INV_99 = invert(PAIR_99);
const INV_F1 = invert(PAIR_F1);
const INV_F2 = invert(PAIR_F2);
const INV_F5 = invert(PAIR_F5);
const INV_F9 = invert(PAIR_F9);    // color name → byte

function invert(t) {
  const o = Object.create(null);
  for (const [k, v] of Object.entries(t)) o[v] = parseInt(k, 10);
  return o;
}

const TWO_BYTE_LEADS = new Set([0x81, 0x99, 0xF1, 0xF2, 0xF5, 0xF9]);

// ---------------------------------------------------------------------
// decode(bytes) → string
// ---------------------------------------------------------------------
function decode(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];

    // ASCII printable
    if (b >= 0x20 && b < 0x7F) {
      out.push(String.fromCharCode(b));
      i++;
      continue;
    }
    // Newline ↔ \n
    if (b === 0x0A) {
      out.push('\n');
      i++;
      continue;
    }
    // Інші control 0x01-0x1F → raw escape
    if (b < 0x20) {
      out.push(`{0x${hex2(b)}}`);
      i++;
      continue;
    }

    // 2-byte sequences
    if (TWO_BYTE_LEADS.has(b) && i + 1 < bytes.length) {
      const p = bytes[i + 1];
      const decoded = decode2Byte(b, p);
      if (decoded !== null) {
        out.push(decoded);
        i += 2;
        continue;
      }
      out.push(`{0x${hex2(b)},0x${hex2(p)}}`);
      i += 2;
      continue;
    }

    // 1-байтний нерозпізнаний (0x80+ без префікс-таблиці)
    out.push(`{0x${hex2(b)}}`);
    i++;
  }
  return out.join('');
}

// Set of characters що не вдалось замапити при ОСТАННЬОМУ виклику encode().
// Скидається в кожному виклику. Зовнішній код може прочитати після encode().
let _lastEncodeUnmapped = new Set();
function getLastEncodeUnmapped() { return [..._lastEncodeUnmapped]; }
function resetLastEncodeUnmapped() { _lastEncodeUnmapped = new Set(); }

// === Cyrillic → Latin font-hack mapping ===
// Стратегія: BBS font-atlas НЕ містить кирилиці нативно. Замість додавання
// нових glyph-слотів ми ПЕРЕМАЛЬОВУЄМО existing Latin Extended cells
// (À, à, Á, á, ...) щоб виглядали як cyrillic. Файл .ctd зберігає байти
// існуючих Latin chars, а атлас рендерить їх як cyrillic — гра ні про що
// не здогадується. Потребує модифікованого FontEn.arc/PNG.
//
// Мапа задана користувачем (KH1 Final Mix BBS UA локалізація).
const CYRILLIC_TO_LATIN = {
  // Lowercase
  'а':'à','б':'á','в':'â','г':'ã','ґ':'´','д':'ä','е':'å','є':'º',
  'ж':'æ','з':'ç','и':'è','і':'³','ї':'¿','й':'é','к':'ê','л':'ë',
  'м':'ì','н':'í','о':'î','п':'ï','р':'ð','с':'ñ','т':'ò','у':'ó',
  'ф':'ô','х':'õ','ц':'ö','ч':'÷','ш':'ø','щ':'ù','ь':'ü',
  'ю':'þ','я':'ÿ',
  // Uppercase
  'А':'À','Б':'Á','В':'Â','Г':'Ã','Ґ':'¥','Д':'Ä','Е':'Å','Є':'ª',
  'Ж':'Æ','З':'Ç','И':'È','І':'²','Ї':'¯','Й':'É','К':'Ê','Л':'Ë',
  'М':'Ì','Н':'Í','О':'Î','П':'Ï','Р':'Ð','С':'Ñ','Т':'Ò','У':'Ó',
  'Ф':'Ô','Х':'Õ','Ц':'Ö','Ч':'×','Ш':'Ø','Щ':'Ù',
  'Ю':'Þ','Я':'ß',
  // Apostrophe variants (U+02BC modifier letter apostrophe, U+2019 right single quote)
  '\u02BC': "'", '\u2019': "'"
};

function decode2Byte(lead, param) {
  let table;
  if (lead === 0x81) table = PAIR_81;
  else if (lead === 0x99) table = PAIR_99;
  else if (lead === 0xF1) table = PAIR_F1;
  else if (lead === 0xF2) table = PAIR_F2;
  else if (lead === 0xF5) table = PAIR_F5;
  else if (lead === 0xF9) {
    const name = PAIR_F9[param];
    return name ? `[c:${name}]` : null;
  }
  if (!table) return null;
  const v = table[param];
  return v == null ? null : v;
}

// ---------------------------------------------------------------------
// encode(str) → Buffer
// ---------------------------------------------------------------------
function encode(str) {
  resetLastEncodeUnmapped();
  const out = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];

    // [c:name] color token
    if (ch === '[' && str.startsWith('[c:', i)) {
      const end = str.indexOf(']', i + 3);
      if (end > 0) {
        const name = str.slice(i + 3, end);
        const byte = INV_F9[name];
        if (byte != null) {
          out.push(0xF9, byte);
          i = end + 1;
          continue;
        }
      }
      // невпізнана color name → fall through, '[' як ASCII
    }

    // Raw byte escapes — два синтакси:
    //   {0xXX}        / {0xXX,0xYY}     — наш decoder
    //   {:unk XX}     / {:unk XX}{:unk YY}  — OpenKh CTD Editor decoder
    // Encoder приймає обидва, щоб HTML-glossary з OpenKh-style escape'ами
    // компонувався без правок.
    if (ch === '{') {
      const end = str.indexOf('}', i + 1);
      if (end > 0) {
        const inside = str.slice(i + 1, end);
        // {:unk XX} (OpenKh)
        const unkMatch = inside.match(/^:unk\s+([0-9a-fA-F]{1,2})$/);
        if (unkMatch) {
          out.push(parseInt(unkMatch[1], 16));
          i = end + 1;
          continue;
        }
        // {0xXX[,0xYY]...} (ours)
        if (inside.startsWith('0x')) {
          const parts = inside.split(',');
          const bytes = [];
          let valid = true;
          for (const p of parts) {
            const m = p.trim().match(/^0x([0-9a-fA-F]{1,2})$/);
            if (!m) { valid = false; break; }
            bytes.push(parseInt(m[1], 16));
          }
          if (valid && bytes.length > 0) {
            for (const b of bytes) out.push(b);
            i = end + 1;
            continue;
          }
        }
      }
    }

    // Newline → 0x0A
    if (ch === '\n') {
      out.push(0x0A);
      i++;
      continue;
    }

    // ASCII
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7F) {
      out.push(code);
      i++;
      continue;
    }

    // Інші control
    if (code < 0x20) {
      out.push(code);
      i++;
      continue;
    }

    // Лукап у inverse-таблицях
    let matched = false;
    for (const [lead, inv] of [[0x81, INV_81], [0x99, INV_99], [0xF1, INV_F1], [0xF2, INV_F2], [0xF5, INV_F5]]) {
      const byte = inv[ch];
      if (byte != null) {
        out.push(lead, byte);
        matched = true;
        break;
      }
    }
    if (matched) { i++; continue; }

    // Транслітерація кирилиці → латиниці (поки нема BBS font-hack'а).
    // Кожен ASCII-символ транслітерації пишеться окремим байтом.
    const translit = CYRILLIC_TO_LATIN[ch];
    if (translit) {
      // Кожен символ транслітерації кодуємо ТИМ САМИМ шляхом, що й звичайний
      // текст: ASCII → 1 байт, Latin-Extended → через PAIR_81/PAIR_99 таблиці
      // (2 байти). Раніше все не-ASCII тут ставало '?', тобто УСЯ кирилиця
      // компонувалась як '????'.
      for (let k = 0; k < translit.length; k++) {
        const tc = translit[k];
        const code = tc.charCodeAt(0);
        if (code >= 0x20 && code < 0x7F) { out.push(code); continue; }
        let found = false;
        for (const [lead, inv] of [[0x81, INV_81], [0x99, INV_99]]) {
          const byte = inv[tc];
          if (byte != null) { out.push(lead, byte); found = true; break; }
        }
        if (!found) { out.push(0x3F); _lastEncodeUnmapped.add(ch); }
      }
      i++;
      continue;
    }

    // Не вдалось замапити НІЯК — пишемо placeholder '?' (щоб compose
    // завершився) і реєструємо у _lastEncodeUnmapped для UI-warn.
    out.push(0x3F);
    _lastEncodeUnmapped.add(ch);
    i++;
  }
  return Buffer.from(out);
}

function hex2(n) { return n.toString(16).padStart(2, '0').toUpperCase(); }

// ---------------------------------------------------------------------
// Glossary-key канонікалізація.
// OpenKh CTD Editor при парсингу мовчки втрачає 2-й байт у sequences типу
// 0xF1/F2/F5 коли param не у їхній mapping table — відображає лише
// `{:unk f5}` без param-байта. Тому переклади підготовлені у OpenKh
// мають EN-ключі у "колапсованій" формі. Щоб imported HTML glossary
// знаходив наші decoded messages, використовуємо ту саму канонічну
// форму при ЗБЕРЕЖЕННІ та ПОШУКУ ключа.
//
// При compose використовуємо restore2ndBytes() щоб відновити втрачені
// param-байти у UK-перекладі — інакше encoded bytes були б неповні і
// гра могла б крашнути.
// ---------------------------------------------------------------------
function glossaryKey(text) {
  if (!text) return text;
  // Колапсуємо {0xF1,0xYY}, {0xF2,0xYY}, {0xF5,0xYY} → {0xF1}, {0xF2}, {0xF5}
  // (F9 не чіпаємо — там params добре відомі і у мапі)
  return text.replace(/\{0x(F[125]),0x[0-9A-Fa-f]{2}\}/g, '{0x$1}');
}

function restore2ndBytes(ukText, originalEnText) {
  if (!ukText || !originalEnText) return ukText;
  // У originalEnText шукаємо повні {0xF[125],0xYY} в порядку появи,
  // групуючи за prefix-байтом.
  const queues = { F1: [], F2: [], F5: [] };
  const re = /\{0x(F[125]),0x([0-9A-Fa-f]{2})\}/g;
  let m;
  while ((m = re.exec(originalEnText))) {
    queues[m[1].toUpperCase()].push(m[2].toUpperCase());
  }
  // У ukText замінюємо кожен {0xF[125]} на повний {0xF[125],0xYY}
  // використовуючи відповідний param з queue.
  return ukText.replace(/\{0x(F[125])\}/g, (whole, lead) => {
    const key = lead.toUpperCase();
    if (queues[key].length === 0) return whole;
    const param = queues[key].shift();
    return `{0x${key},0x${param}}`;
  });
}

module.exports = {
  decode,
  encode,
  glossaryKey,
  restore2ndBytes,
  getLastEncodeUnmapped,
  resetLastEncodeUnmapped,
  TABLES: {
    pair81: PAIR_81,
    pair99: PAIR_99,
    iconF1: PAIR_F1,
    iconF2: PAIR_F2,
    iconF5: PAIR_F5,
    colorF9: PAIR_F9
  }
};
