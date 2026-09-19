'use strict';

// KH1 «Message v361» .binl (sysmsg). Слот = повідомлення; offset = абсолютний
// зсув байтів тексту (стабільний у межах файлу). Без RUS-оракула: усі записи
// з літерами вважаються перекладними. Compose — строгий: запис із символами
// без коду або з {eol} лишається англійським + error.

const fs = require('fs/promises');
const { parseMessageV361, composeMessageV361 } = require('../msg-v361');
const codec = require('../../../shared/codec');

const HAS_LETTERS = /[A-Za-zА-Яа-яЁёЇїІіЄєҐґ]/;
// Діалект команд sysmsg (0D/0E = i16, 08 = RGB …) — див. codec.SYSMSG_CMD_LEN.
const DECODE_OPTS = { overlay: false, cmd: 'sysmsg' };

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const parsed = parseMessageV361(buf);
  const slots = [];
  let skippedNoText = 0;
  for (const e of parsed.entries) {
    const english = codec.decode(e.bytes, DECODE_OPTS);
    if (!HAS_LETTERS.test(english)) { skippedNoText++; continue; }
    slots.push({
      index: e.index,
      offset: e.offset,
      byteLen: e.bytes.length,
      english,
      key: english
    });
  }
  const byOffset = new Map(slots.map(s => [s.offset, s]));

  return {
    slots,
    stats: {
      msgV361: true,
      engStrings: parsed.entries.length,
      translatable: slots.length,
      skippedNoText,
      fileSize: buf.length
    },
    engSize: buf.length,
    rusSize: 0,
    async compose(ukByOffset) {
      const rep = new Map();
      const errors = [];
      for (const [off, uk] of ukByOffset) {
        const s = byOffset.get(off);
        if (!s || !uk || uk === s.english) continue;
        try {
          // 0x00 всередині запису допустимий лише як байт параметра команди
          // (оригінали містять `{0x0D,0x06,0x00}`); «голий» {eol}/перенос — помилка.
          if (/\{eol\}|[\r\n]/.test(uk)) throw new Error('текст містить {eol}/перенос рядка — у Message v361 це термінатор запису; для переносу використовуй {lf}');
          rep.set(s.index, codec.encode(uk));
        } catch (e) {
          errors.push({ offset: off, message: (e && e.message) || String(e) });
        }
      }
      let composed;
      try { composed = composeMessageV361(parsed, rep); }
      catch (e) {
        errors.push({ offset: -1, message: (e && e.message) || String(e) });
        composed = Buffer.from(buf);
        rep.clear();
      }
      return {
        outputs: [{ buf: composed, pathFor: (outPath) => outPath }],
        applied: rep.size,
        skipped: slots.length - rep.size,
        errors,
        extra: { msgV361: { entryCount: parsed.entries.length, sizeDiff: composed.length - buf.length } }
      };
    }
  };
}

module.exports = { kind: 'binl-v361', preserveWhitespace: true, structuralGuard: true, parse };
