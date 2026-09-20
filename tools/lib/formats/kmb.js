'use strict';

// KH1 `menu/md_*.kmb` (словник, гімн, Jiminy, синопсис): `u32 count` + рядки з
// термінатором 0x00 у діалекті меню (див. tools/lib/menu-msg.js). Слот =
// рядок; offset = індекс (стабільний у межах файлу). Compose — строгий: рядок
// із символами без коду або з {eol} лишається англійським + error.

const fs = require('fs/promises');
const codec = require('../../../shared/codec');
const { parseCounted, composeCounted } = require('../menu-msg');
const { looksLikeText } = require('../text-quality');

const DECODE_OPTS = { cmd: 'sysmsg' };

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = parseCounted(buf);
  const slots = [];
  let skippedNoText = 0;
  for (const e of parsed.entries) {
    const english = codec.decode(e.bytes, DECODE_OPTS);
    if (!looksLikeText(english)) { skippedNoText++; continue; }
    slots.push({ index: e.index, offset: e.index, byteLen: e.bytes.length, english, key: english });
  }
  const byOffset = new Map(slots.map(s => [s.offset, s]));

  return {
    slots,
    stats: { kmb: true, engStrings: parsed.count, translatable: slots.length, skippedNoText, fileSize: buf.length },
    engSize: buf.length,
    rusSize: 0,
    async compose(ukByOffset) {
      const rep = new Map();
      const errors = [];
      for (const [off, uk] of ukByOffset) {
        const s = byOffset.get(off);
        if (!s || !uk || uk === s.english) continue;
        try {
          if (/\{eol\}|[\r\n]/.test(uk)) throw new Error('текст містить {eol}/перенос рядка — у .kmb це термінатор запису; для переносу використовуй {lf}');
          rep.set(s.index, codec.encode(uk));
        } catch (e) {
          errors.push({ offset: off, message: (e && e.message) || String(e) });
        }
      }
      const composed = composeCounted(parsed, rep);
      return {
        outputs: [{ buf: composed, pathFor: (outPath) => outPath }],
        applied: rep.size,
        skipped: slots.length - rep.size,
        errors,
        extra: { kmb: { entryCount: parsed.count, sizeDiff: composed.length - buf.length } }
      };
    }
  };
}

module.exports = { kind: 'kmb', preserveWhitespace: true, structuralGuard: true, parse };
