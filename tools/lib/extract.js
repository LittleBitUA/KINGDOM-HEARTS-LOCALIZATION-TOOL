'use strict';

const { decode } = require('../../shared/codec');

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

function extract(eng, rus, opts = {}) {
  const HEADER = opts.header != null ? opts.header : 11;
  const FOOTER = opts.footer != null ? opts.footer : 5;
  const MIN_LEN = opts.minLen != null ? opts.minLen : 3;

  const engStrs = splitStrings(eng, HEADER, FOOTER);

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

    const inRus = containsExactSegment(rus, s.bytes);
    if (inRus) { stats.preserved++; continue; }

    stats.translatable++;
    slots.push({
      index: i,
      offset: s.offset,
      byteLen: s.bytes.length,
      english: decode(s.bytes, { overlay: false })
    });
  }

  return { slots, stats };
}

function slotsToTsv(slots) {
  const lines = ['index\toffset\tbytes\tenglish\tukrainian'];
  for (const slot of slots) {
    const offHex = '0x' + slot.offset.toString(16).toUpperCase().padStart(4, '0');
    const en = slot.english.replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n');
    lines.push([slot.index, offHex, slot.byteLen, en, ''].join('\t'));
  }
  return lines.join('\n') + '\n';
}

module.exports = { extract, splitStrings, slotsToTsv, containsExactSegment };
