'use strict';

// Re:CoM .ctdl. Слот = text entry; offset = entry index (unique per file).
// Compose — строгий: entry з символами без коду лишається англійським + error.
// Макети (хмаринки) можна підмінити через compose(…, { layouts }).

const fs = require('fs/promises');
const path = require('path');
const { parseCtdl, composeCtdl } = require('../recom-ctdl-format');
const { applyLayoutOverrides } = require('../recom-ctdl-layout');
const codec = require('../recom-ctdl-codec');

// Ліміти байтів для рядків, які гра sprintf-ить у фіксований стековий буфер
// (data/recom/limits.json, знайдено у exe): довший переклад = краш гри.
const LIMITS = (() => {
  try { return require('../../../data/recom/limits.json').limits || []; } catch (_) { return []; }
})();
function limitsFor(engPath) {
  const rel = String(engPath).split(path.sep).join('/');
  const out = {};
  for (const l of LIMITS) {
    if (!new RegExp(l.path).test(rel)) continue;
    for (const [k, v] of Object.entries(l.max || {})) out[Number(k)] = { max: v, why: l.why || '' };
  }
  return out;
}

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = parseCtdl(buf);
  const limits = limitsFor(engPath);
  const slots = parsed.entries.map((e, i) => ({
    index: i,
    offset: e.index,
    absOffset: e.absoluteOffset,
    byteLen: e.originalLength,
    english: e.text,
    key: codec.glossaryKey(e.text),
    maxBytes: limits[i] ? limits[i].max : undefined
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
    refSize: 0,
    // opts.layouts — { [msgId]: {x,y,w,h} } з PROGRESS/_bubbles.json («Хмаринки»):
    // геометрія макетів правиться у копії, текст — як завжди.
    async compose(ukByOffset, opts) {
      const rep = new Map();
      const errors = [];
      for (const [idx, uk] of ukByOffset || []) {
        try {
          const bytes = codec.encode(uk);
          const lim = limits[idx];
          if (lim && bytes.length > lim.max) {
            errors.push({ offset: idx, message: 'переклад ' + bytes.length + ' Б > ліміт ' + lim.max + ' Б (' + lim.why + ') — лишено оригінал, інакше гра вилетить' });
            continue;
          }
          rep.set(idx, uk);
        } catch (e) { errors.push({ offset: idx, message: (e && e.message) || String(e) }); }
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
