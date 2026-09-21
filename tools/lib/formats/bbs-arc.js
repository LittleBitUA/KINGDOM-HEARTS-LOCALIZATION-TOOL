'use strict';

// BBS .arc з розкладками меню (.l2d), у яких зашитий текст: original/arc_en/system/
// commonGame.arc (пауза: Continue/Resume/Skip Scene/Help/Quit/Retry), menu/camp.arc
// (Command Decks/Items/Abilities/Stats…), menu/Select_2D.arc + title_txt.arc (вибір
// режиму гри), common_wm.arc (Destination) тощо. Слот = один рядок одного .l2d;
// offset = індекс_запису_arc * 4096 + індекс_рядка. Японські рядки інших мов і
// заглушки-шаблони (AAAAAAA, x, WWWW) не показуємо. Compose: змінені рядки
// кодуються BBS-кодеком (кирилиця на 0x83xx, як у .ctd), .l2d перезбирається
// (bbs-l2d), .arc пакується заново (bbs-arc) → DONE/<archive>/original/arc_en/….

const fs = require('fs/promises');
const { parseArc, buildArc } = require('../bbs-arc');
const { parseL2d, rebuildL2d } = require('../bbs-l2d');
const codec = require('../bbs-codec');

const PER_ENTRY = 4096;
// текст для перекладу: є латинська літера, не шаблон-заглушка з одних A/W/x/пробілів
function translatable(text) {
  const t = text.replace(/\{[^}]*\}/g, '');          // без тегів іконок/кольорів
  return /[A-Za-z]/.test(t) && !/^[AaWwXx .:]+$/.test(t);
}

async function parse(engPath) {
  const buf = await fs.readFile(engPath);
  const arc = parseArc(buf);
  const slots = [];
  const layouts = [];   // { entry, parsed }
  let index = 0;
  for (const e of arc.entries) {
    if (!e.data || !/\.l2d$/i.test(e.name)) continue;
    let p;
    try { p = parseL2d(e.data); } catch (_) { continue; }
    layouts.push({ entry: e, parsed: p });
    for (const s of p.entries) {
      if (!s.raw.length) continue;
      let text;
      try { text = codec.decode(s.raw); } catch (_) { continue; }
      if (!translatable(text)) continue;
      slots.push({ index: index++, offset: e.i * PER_ENTRY + s.index, absOffset: e.off, byteLen: s.raw.length, english: text, key: codec.glossaryKey(text), layout: e.name });
    }
  }
  return {
    slots,
    stats: { arc: true, entries: arc.count, layouts: layouts.length, fileSize: buf.length },
    engSize: buf.length,
    rusSize: 0,
    async compose(ukByOffset) {
      let applied = 0;
      const errors = [];
      const missing = new Set();
      const replace = new Map();
      for (const { entry, parsed } of layouts) {
        const raws = new Map();
        for (const s of parsed.entries) {
          const off = entry.i * PER_ENTRY + s.index;
          if (!ukByOffset.has(off)) continue;
          try {
            const raw = codec.encode(ukByOffset.get(off));
            raws.set(s.index, raw); applied++;
            for (const g of codec.missingGlyphs(raw)) missing.add(g);
          } catch (e2) { errors.push({ offset: off, message: entry.name + ': ' + ((e2 && e2.message) || String(e2)) }); }
        }
        if (raws.size) replace.set(entry.name, rebuildL2d(entry.data, raws));
      }
      if (missing.size) errors.push({ offset: -1, message: 'У шрифті FontEn.arc немає гліфів: ' + [...missing].slice(0, 12).map(h => '0x' + h).join(' ') + (missing.size > 12 ? ' …' : '') });
      const composed = replace.size ? buildArc(buf, replace) : Buffer.from(buf);
      return {
        outputs: [{ buf: composed, pathFor: (outPath) => outPath }],
        applied,
        skipped: slots.length - applied,
        errors,
        extra: { arc: { layouts: replace.size, sizeDiff: composed.length - buf.length } }
      };
    }
  };
}

module.exports = { kind: 'bbs-arc', preserveWhitespace: false, parse };
