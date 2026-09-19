'use strict';

const { decode } = require('../../shared/codec');
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

function extract(eng, rus, opts = {}) {
  const HEADER = opts.header != null ? opts.header : 11;
  const FOOTER = opts.footer != null ? opts.footer : 5;
  const MIN_LEN = opts.minLen != null ? opts.minLen : 3;

  const engStrs = splitStrings(eng, HEADER, FOOTER);
  const rusSegs = segmentSet(rus);

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
  return tsv.build(slots, { ukOf: () => '' });
}

module.exports = { extract, splitStrings, slotsToTsv, containsExactSegment, segmentSet };
