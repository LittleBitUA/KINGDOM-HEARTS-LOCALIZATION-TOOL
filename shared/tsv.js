'use strict';

// Per-file TSV progress format — ЄДИНЕ місце, де визначено формат.
// Використовується і main (composeAll → per-file overrides), і renderer
// (save/load прогресу), і CLI-tools (extract). Раніше три копії парсера
// жили окремо і могли розійтися.
//
// Формат:
//   index<TAB>offset<TAB>bytes<TAB>english<TAB>ukrainian
//   0<TAB>0x001A<TAB>12<TAB>Hello{lf}World<TAB>Привіт{lf}Світе
//
// Екранування комірки: \t → "\\t", \n → "\\n", \\ → "\\\\" (порядок важливий:
// спершу backslash). Старі файли без екранованого backslash читаються так само,
// бо "\\" не зустрічався у KH-тексті.
//
// UMD: module.exports для Node, window.KH.tsv для renderer.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KH = root.KH || {}; root.KH.tsv = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const HEADER = ['index', 'offset', 'bytes', 'english', 'ukrainian'];

  function escapeCell(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\r?\n/g, '\\n');
  }

  function unescapeCell(s) {
    if (!s) return '';
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length) {
        const nx = s[i + 1];
        if (nx === 'n') { out += '\n'; i++; continue; }
        if (nx === 't') { out += '\t'; i++; continue; }
        if (nx === '\\') { out += '\\'; i++; continue; }
      }
      out += ch;
    }
    return out;
  }

  function formatOffset(off) {
    return '0x' + Number(off).toString(16).toUpperCase().padStart(4, '0');
  }

  // build(slots, opts?) → string
  //   slots: [{ index, offset, byteLen, english, ukText? }]
  //   opts.ukOf(slot) — що писати в колонку ukrainian (дефолт: slot.ukText || '')
  function build(slots, opts) {
    const ukOf = (opts && opts.ukOf) || (s => (s.ukText || ''));
    const lines = [HEADER.join('\t')];
    for (const s of slots) {
      lines.push([
        s.index,
        formatOffset(s.offset),
        s.byteLen,
        escapeCell(s.english),
        escapeCell(ukOf(s))
      ].join('\t'));
    }
    return lines.join('\n') + '\n';
  }

  // parse(content) → { header: string[], rows: [{ index, offset, byteLen, english, ukrainian }] }
  // Пропускає порожні рядки; offset читається як hex (0x…) або decimal.
  function parse(content) {
    const lines = String(content || '').split(/\r?\n/);
    if (!lines.length) return { header: [], rows: [] };
    const header = lines[0].split('\t');
    const col = (name) => header.indexOf(name);
    const iIdx = col('index'), iOff = col('offset'), iBytes = col('bytes'), iEn = col('english'), iUk = col('ukrainian');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split('\t');
      const offRaw = iOff >= 0 ? c[iOff] : undefined;
      const offset = offRaw == null ? NaN : (/^0x/i.test(offRaw) ? parseInt(offRaw, 16) : parseInt(offRaw, 10));
      rows.push({
        index: iIdx >= 0 ? parseInt(c[iIdx], 10) : i - 1,
        offset,
        byteLen: iBytes >= 0 ? parseInt(c[iBytes], 10) : NaN,
        english: iEn >= 0 ? unescapeCell(c[iEn]) : '',
        ukrainian: iUk >= 0 ? unescapeCell(c[iUk]) : ''
      });
    }
    return { header, rows };
  }

  // overridesByOffset(content) → Map<offset, ukrainian> | null
  // null — якщо файл не має потрібних колонок (не наш формат).
  function overridesByOffset(content) {
    const { header, rows } = parse(content);
    if (header.indexOf('offset') < 0 || header.indexOf('ukrainian') < 0) return null;
    const map = new Map();
    for (const r of rows) {
      if (Number.isFinite(r.offset) && r.ukrainian) map.set(r.offset, r.ukrainian);
    }
    return map;
  }

  return { HEADER, build, parse, overridesByOffset, escapeCell, unescapeCell, formatOffset };
}));
