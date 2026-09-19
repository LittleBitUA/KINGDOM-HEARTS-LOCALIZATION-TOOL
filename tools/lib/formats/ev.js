'use strict';

// KH1 .ev / .evdl event-script container. UI бачить лише translatable слоти
// (з літерами); compose використовує ВСІ слоти (padding теж) для round-trip.

const fs = require('fs/promises');
const codec = require('../../../shared/codec');
const { parseEv, composeEv } = require('../ev-format');

async function parse(engPath, env) {
  const buf = await fs.readFile(engPath);
  const parsed = parseEv(buf, codec);
  const visible = parsed.slots.filter(s => s.translatable);
  const slots = visible.map((s, idx) => ({
    index: idx,
    offset: s.offset,           // відносно textOffset
    absOffset: s.absOffset,
    byteLen: s.byteLen,
    english: s.english,
    key: s.english
  }));
  const cellPreserving = !!(env.opts && env.opts.cellPreserving);

  return {
    slots,
    stats: {
      ev: true,
      totalSlots: parsed.slots.length,
      translatableSlots: visible.length,
      textOffset: parsed.textOffset,
      footerOffset: parsed.footerOffset,
      fileSize: parsed.fileSize
    },
    engSize: buf.length,
    rusSize: 0,
    async compose(ukByOffset) {
      const slotsForCompose = parsed.slots.map(s => ({
        offset: s.offset,
        english: s.english,
        ukText: ukByOffset.has(s.offset) ? ukByOffset.get(s.offset) : s.english
      }));
      const c = composeEv(buf, slotsForCompose, codec, { cellPreserving });
      return {
        outputs: [{ buf: c.buf, pathFor: (outPath) => outPath }],
        applied: ukByOffset.size,
        skipped: visible.length - ukByOffset.size,
        errors: [],
        extra: { ev: { sizeDiff: c.sizeDiff, relocCount: c.relocCount, layout: c.layout, overflowCount: c.overflowCount || 0 } }
      };
    }
  };
}

module.exports = { kind: 'ev', preserveWhitespace: true, parse };
