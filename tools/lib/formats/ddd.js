'use strict';

// KH3D Dream Drop Distance .ctd (v0x1F7, UTF-16LE). Слот = entry;
// offset = entry index (unique per file); id — messageId для довідки.

const fs = require('fs/promises');
const ddd = require('../ddd-ctd');

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = ddd.parseDddCtd(buf);
  const slots = parsed.entries.map((e, i) => ({
    index: i,
    offset: e.index,
    absOffset: e.addr,
    byteLen: e.codes.length * 2,
    english: e.text,
    key: e.text,
    messageId: e.id
  }));
  return {
    slots,
    stats: {
      ddd: true,
      baseId: parsed.header.baseId,
      entryCount: parsed.entries.length,
      layoutCount: parsed.header.layoutCount,
      fileSize: buf.length
    },
    engSize: buf.length,
    rusSize: 0,
    async compose(ukByOffset) {
      const rep = new Map();
      const errors = [];
      const missing = new Set();
      for (const [idx, uk] of ukByOffset) {
        try {
          ddd.encodeCodes(uk);
          rep.set(idx, uk);
          for (const ch of ddd.missingGlyphs(uk, 'mesfont')) missing.add(ch);
        } catch (e) {
          errors.push({ offset: idx, message: (e && e.message) || String(e) });
        }
      }
      if (missing.size) {
        errors.push({ offset: -1, message: 'У шрифті mesfont.bcfnt немає гліфів: ' + [...missing].slice(0, 20).join(' ') + (missing.size > 20 ? ' …' : '') });
      }
      const composed = ddd.composeDddCtd(parsed, rep);
      return {
        outputs: [{ buf: composed, pathFor: (outPath) => outPath }],
        applied: rep.size,
        skipped: parsed.entries.length - rep.size,
        errors,
        extra: { ddd: { entryCount: parsed.entries.length, sizeDiff: composed.length - buf.length } }
      };
    }
  };
}

module.exports = { kind: 'ctd-ddd', preserveWhitespace: false, parse };
