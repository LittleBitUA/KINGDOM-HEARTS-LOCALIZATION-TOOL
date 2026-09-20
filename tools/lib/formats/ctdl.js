'use strict';

// Re:CoM .ctdl. Слот = text entry; offset = entry index (unique per file).
// Compose — строгий: entry з символами без коду лишається англійським + error.
// Макети (хмаринки) можна підмінити через compose(…, { layouts }).

const fs = require('fs/promises');
const { parseCtdl, composeCtdl } = require('../recom-ctdl-format');
const { applyLayoutOverrides } = require('../recom-ctdl-layout');
const codec = require('../recom-ctdl-codec');

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = parseCtdl(buf);
  const slots = parsed.entries.map((e, i) => ({
    index: i,
    offset: e.index,
    absOffset: e.absoluteOffset,
    byteLen: e.originalLength,
    english: e.text,
    key: codec.glossaryKey(e.text)
  }));

  return {
    slots,
    stats: {
      ctdl: true,
      layoutCount: parsed.layouts.length,
      entryCount: parsed.entries.length,
      fileSize: buf.length
    },
    engSize: buf.length,
    rusSize: 0,
    // opts.layouts — { [msgId]: {x,y,w,h} } з PROGRESS/_bubbles.json («Хмаринки»):
    // геометрія макетів правиться у копії, текст — як завжди.
    async compose(ukByOffset, opts) {
      const rep = new Map();
      const errors = [];
      for (const [idx, uk] of ukByOffset || []) {
        try { codec.encode(uk); rep.set(idx, uk); }
        catch (e) { errors.push({ offset: idx, message: (e && e.message) || String(e) }); }
      }
      let layoutsChanged = 0;
      let src = parsed;
      if (opts && opts.layouts) {
        src = Object.assign({}, parsed, { layouts: parsed.layouts.map(l => Buffer.from(l)) });
        layoutsChanged = applyLayoutOverrides(src, opts.layouts);
      }
      const composed = composeCtdl(src, rep);
      return {
        outputs: [{ buf: composed, pathFor: (outPath) => outPath }],
        applied: rep.size,
        skipped: parsed.entries.length - rep.size,
        errors,
        extra: { ctdl: { entryCount: parsed.entries.length, sizeDiff: composed.length - buf.length, layoutsChanged } }
      };
    }
  };
}

module.exports = { kind: 'ctdl', preserveWhitespace: false, parse };
