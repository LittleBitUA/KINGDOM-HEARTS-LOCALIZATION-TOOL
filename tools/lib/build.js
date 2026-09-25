'use strict';

const { encode } = require('../../shared/codec');

/**
 * Збирає новий буфер з оригіналу + замін.
 * @param {Buffer} eng оригінальні байти
 * @param {Array<{offset:number, oldLen:number, ukText:string}>} replacements
 * @returns {{buffer: Buffer, errors: Array, applied: number, skipped: number}}
 */
// opts.sysfont — текст малюється СИСТЕМНИМ шрифтом (меню, назви вмінь,
// команди бою): кирилиця туди йде однобайтовими кодами, бо малювальник
// меню двобайтового екрана `19 NN` не розуміє — байти < 0x20 для нього
// службові, і рядок просто зникає.
function compose(eng, replacements, opts) {
  const sorted = [...replacements]
    .filter(r => r && typeof r.ukText === 'string' && r.ukText.length > 0)
    .sort((a, b) => a.offset - b.offset);

  const errors = [];
  const out = [];
  let cursor = 0;
  let applied = 0;
  let skipped = 0;

  for (const r of sorted) {
    if (r.offset < cursor) {
      errors.push({ offset: r.offset, message: 'Перетин з попередньою заміною — пропущено' });
      skipped++;
      continue;
    }
    if (r.offset > eng.length) {
      errors.push({ offset: r.offset, message: 'Offset за межами файлу' });
      skipped++;
      continue;
    }

    if (r.offset > cursor) {
      out.push(eng.subarray(cursor, r.offset));
    }

    let bytes;
    try {
      bytes = encode(r.ukText, { sysfont: !!(opts && opts.sysfont) });
    } catch (e) {
      errors.push({ offset: r.offset, message: (e && e.message) || String(e) });
      out.push(eng.subarray(r.offset, r.offset + r.oldLen));
      cursor = r.offset + r.oldLen;
      skipped++;
      continue;
    }

    if (typeof r.padTo === 'number' && r.padTo > 0) {
      if (bytes.length > r.padTo) {
        errors.push({
          offset: r.offset,
          message: `Переклад довший за слот (${bytes.length} > ${r.padTo} байт), фіксована довжина обов'язкова — пропущено`
        });
        out.push(eng.subarray(r.offset, r.offset + r.oldLen));
        cursor = r.offset + r.oldLen;
        skipped++;
        continue;
      }
      if (bytes.length < r.padTo) {
        const pad = Buffer.alloc(r.padTo - bytes.length, 0x00);
        bytes = Buffer.concat([Buffer.from(bytes), pad]);
      }
    }

    out.push(bytes);
    cursor = r.offset + r.oldLen;
    applied++;
  }

  if (cursor < eng.length) {
    out.push(eng.subarray(cursor));
  }

  return { buffer: Buffer.concat(out), errors, applied, skipped };
}

module.exports = { compose };
