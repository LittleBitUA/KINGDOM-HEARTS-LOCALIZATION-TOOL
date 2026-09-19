'use strict';

// BBS .ctd (версія 1). Слот = message; offset = message.id (unique per file).
// Кодек — bbs-codec (порт еталонного bbstext.py): текст decode'иться у
// канонічну форму з іменованими вставками ({icon triangle}, {color white}),
// тому ключ глосарія = сам текст. Compose — строгий: повідомлення з символами,
// яких гра не вміє показати, лишається англійським і потрапляє в errors.

const fs = require('fs/promises');
const { parseCtd, composeCtd } = require('../ctd-format');
const codec = require('../bbs-codec');

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = parseCtd(buf);
  const slots = parsed.messages.map((m, i) => ({
    index: i,
    offset: m.id,
    absOffset: m.textOffset,
    byteLen: m._origByteLen,
    english: m.text,
    key: codec.glossaryKey(m.text)
  }));

  return {
    slots,
    stats: {
      ctd: true,
      fileId: parsed.header.fileId,
      messageCount: parsed.messages.length,
      layoutCount: parsed.layouts.count,
      fileSize: buf.length
    },
    engSize: buf.length,
    rusSize: 0,
    async compose(ukByOffset) {
      let applied = 0;
      const errors = [];
      const missing = new Set();
      for (const m of parsed.messages) {
        if (!ukByOffset.has(m.id)) continue;
        const uk = ukByOffset.get(m.id);
        try {
          m.raw = codec.encode(uk);
          m.text = uk;
          m._rawText = uk;
          applied++;
          for (const g of codec.missingGlyphs(m.raw)) missing.add(g);
        } catch (e) {
          errors.push({ offset: m.id, message: (e && e.message) || String(e) });
        }
      }
      if (missing.size) {
        errors.push({ offset: -1, message: 'У шрифті FontEn.arc немає гліфів: ' + [...missing].slice(0, 12).map(h => '0x' + h).join(' ') + (missing.size > 12 ? ' …' : '') });
      }
      const composed = composeCtd(parsed);
      return {
        outputs: [{ buf: composed, pathFor: (outPath) => outPath }],
        applied,
        skipped: parsed.messages.length - applied,
        errors,
        extra: { ctd: { messageCount: parsed.messages.length, sizeDiff: composed.length - buf.length } }
      };
    }
  };
}

module.exports = { kind: 'ctd', preserveWhitespace: false, parse };
