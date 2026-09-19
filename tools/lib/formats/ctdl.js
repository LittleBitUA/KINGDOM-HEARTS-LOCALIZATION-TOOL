'use strict';

// Re:CoM .ctdl. Слот = text entry; offset = entry index (unique per file).

const fs = require('fs/promises');
const { parseCtdl, composeCtdl } = require('../recom-ctdl-format');
const recomCodec = require('../recom-ctdl-codec');

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = parseCtdl(buf);
  const slots = parsed.entries.map((e, i) => ({
    index: i,
    offset: e.index,
    absOffset: e.absoluteOffset,
    byteLen: e.originalLength,
    english: recomCodec.glossaryKey(e.text),
    key: recomCodec.glossaryKey(e.text),
    _fullText: e.text
  }));

  return {
    slots,
    stats: {
      ctdl: true,
      textboxCount: parsed.textboxes.length,
      entryCount: parsed.entries.length,
      fileSize: buf.length
    },
    engSize: buf.length,
    rusSize: 0,
    async compose(ukByOffset) {
      const composed = composeCtdl(parsed, ukByOffset);
      return {
        outputs: [{ buf: composed, pathFor: (outPath) => outPath }],
        applied: ukByOffset.size,
        skipped: parsed.entries.length - ukByOffset.size,
        errors: [],
        extra: { ctdl: { entryCount: parsed.entries.length, sizeDiff: composed.length - buf.length } }
      };
    }
  };
}

module.exports = { kind: 'ctdl', preserveWhitespace: false, parse };
