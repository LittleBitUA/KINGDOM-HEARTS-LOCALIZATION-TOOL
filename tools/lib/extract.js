'use strict';

const { decode } = require('../../shared/codec');
const { splitSlots, walkFits } = require('../../shared/kh1-message');
const { splitEdges } = require('../../shared/kh1-tokens');
const { looksLikeText } = require('./text-quality');
const tsv = require('../../shared/tsv');

function splitStrings(buf, headerLen, footerLen) {
  if (buf.length < headerLen + footerLen) return [];
  const body = buf.subarray(headerLen, buf.length - footerLen);
  const segs = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === 0x00) {
      segs.push({ offset: headerLen + start, bytes: body.subarray(start, i) });
      start = i + 1;
    }
  }
  if (start <= body.length) {
    segs.push({ offset: headerLen + start, bytes: body.subarray(start) });
  }
  return segs;
}

// Перевірити чи `needle` міститься в `hay` як ЦІЛИЙ 0x00-розмежений сегмент
// (а не випадковий substring всередині іншого слова). Це уникає false-positive
// для дуже коротких рядків (наприклад "Log" як підрядок "Logo" чи "Catalog").
function containsExactSegment(hay, needle) {
  if (needle.length === 0) return true;
  let pos = 0;
  while (pos <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, pos);
    if (idx === -1) return false;
    const beforeOk = (idx === 0) || (hay[idx - 1] === 0x00);
    const afterIdx = idx + needle.length;
    const afterOk = (afterIdx === hay.length) || (hay[afterIdx] === 0x00);
    if (beforeOk && afterOk) return true;
    pos = idx + 1;
  }
  return false;
}

function hasTextContent(bytes) {
  let printable = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b >= 0x21 && b <= 0x79) || b === 0x01) printable++;
  }
  return printable >= 2;
}

// Множина всіх 0x00-розмежених сегментів reference-файла (як latin1-рядки).
// O(m) один раз замість O(n·m) indexOf-сканувань для кожного eng-рядка.
function segmentSet(buf) {
  const set = new Set();
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x00) {
      if (i > start) set.add(buf.toString('latin1', start, i));
      start = i + 1;
    }
  }
  return set;
}

// Сегменти файла для розбору. Основний шлях — обхід байткоду (одна сторінка =
// один слот). Якщо обхід не сходиться (файл лише схожий на діалоговий байткод
// або зсунутий футер) — падаємо назад на старий поділ по 0x00, щоб не зіпсувати
// такий файл.
function pageSegments(eng, header, footer) {
  const from = header;
  for (let extra = 0; extra <= footer; extra++) {
    const to = eng.length - footer + extra;
    if (to <= from) break;
    if (!walkFits(eng, from, to)) continue;
    let slots = splitSlots(eng, from, to);
    // У заголовку EvMsg ("EvMsg" + мова + u32) лежить кількість записів, і вона
    // збігається саме з кількістю СТОРІНОК (роздільники 0x00 і 0x04) — ще одне
    // підтвердження, що гра рахує сторінки. Усе після N-го запису — сміття від
    // попередніх, довших версій файла (у 135 файлах гри там висять хвости
    // на кшталт «xir.{wait2 45}»); у глосарій його не беремо.
    if (header === 11 && eng.length >= 11 && eng.subarray(0, 5).toString('latin1') === 'EvMsg') {
      const count = eng.readUInt32LE(7);
      if (count > 0 && count < slots.length) slots = slots.slice(0, count);
    }
    return slots.map(s => ({ offset: s.start, bytes: eng.subarray(s.start, s.end) }));
  }
  return null;
}

function extract(eng, rus, opts = {}) {
  const HEADER = opts.header != null ? opts.header : 11;
  const FOOTER = opts.footer != null ? opts.footer : 5;
  const MIN_LEN = opts.minLen != null ? opts.minLen : 3;

  const paged = opts.pages === false ? null : pageSegments(eng, HEADER, FOOTER);
  const engStrs = paged || splitStrings(eng, HEADER, FOOTER);
  // Неперекладні сегменти: з reference-файла (якщо є) + вбудований еталон
  // (opts.preservedSegs, data/kh1_oracle.json) — тека RUS більше не потрібна.
  const rusSegs = segmentSet(rus || Buffer.alloc(0));
  for (const str of (opts.preservedSegs || [])) rusSegs.add(str);

  const stats = {
    engStrings: engStrs.length,
    translatable: 0,
    preserved: 0,
    skippedShort: 0,
    skippedNoText: 0,
    skippedEmpty: 0
  };

  const slots = [];

  for (let i = 0; i < engStrs.length; i++) {
    const s = engStrs[i];
    if (s.bytes.length === 0) { stats.skippedEmpty++; continue; }
    if (s.bytes.length < MIN_LEN) { stats.skippedShort++; continue; }
    if (!hasTextContent(s.bytes)) { stats.skippedNoText++; continue; }

    const inRus = rusSegs.has(s.bytes.toString('latin1'));
    if (inRus) { stats.preserved++; continue; }

    // Без оракула сюди потрапляють і байти параметрів команд — відсіюємо те,
    // що не схоже на текст (`{0x19}`, `H`, `Bö ìoèy`).
    const full = decode(s.bytes, { overlay: false });
    // Службова обгортка сторінки (інтервал рядків, зсув, тривалість показу) —
    // не текст: ховаємо її з ключа й повертаємо назад при збірці.
    const { prefix, body, suffix } = paged ? splitEdges(full) : { prefix: '', body: full, suffix: '' };
    if (!looksLikeText(body)) { stats.skippedNoText++; continue; }

    stats.translatable++;
    slots.push({
      index: i,
      offset: s.offset,
      byteLen: s.bytes.length,
      english: body,
      prefix,
      suffix
    });
  }

  return { slots, stats };
}

function slotsToTsv(slots) {
  return tsv.build(slots, { ukOf: () => '' });
}

module.exports = { extract, splitStrings, slotsToTsv, containsExactSegment, segmentSet };
