'use strict';

// BBS .ctd. Слот = message; offset = message.id (unique per file).
// english/key — у канонічній OpenKh-формі (без 2-х байтів F1/F2/F5), щоб
// збігатися з тим, що бачать у OpenKh CTD Editor і з ключами HTML-глосарія.
// prepareUk відновлює втрачені 2-і байти з оригінального EN перед compose.

const fs = require('fs/promises');
const { parseCtd, composeCtd } = require('../ctd-format');
const ctdCodec = require('../ctd-codec');

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = parseCtd(buf);
  const slots = parsed.messages.map((m, i) => ({
    index: i,
    offset: m.id,
    absOffset: m.textOffset,
    byteLen: m._origByteLen,
    english: ctdCodec.glossaryKey(m.text),
    key: ctdCodec.glossaryKey(m.text),
    _fullText: m.text
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
      const unmapped = new Set();
      for (const m of parsed.messages) {
        if (!ukByOffset.has(m.id)) continue;
        m.text = ctdCodec.restore2ndBytes(ukByOffset.get(m.id), m.text);
        applied++;
      }
      const composed = composeCtd(parsed);
      for (const ch of ctdCodec.getLastEncodeUnmapped()) unmapped.add(ch);
      const errors = unmapped.size
        ? [{ offset: -1, message: 'Символи без мапінгу у BBS-шрифті (записано як ?): ' + [...unmapped].join(' ') }]
        : [];
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

function prepareUk(slot, uk) {
  return ctdCodec.restore2ndBytes(uk, slot._fullText || slot.english);
}

module.exports = { kind: 'ctd', preserveWhitespace: false, parse, prepareUk };
