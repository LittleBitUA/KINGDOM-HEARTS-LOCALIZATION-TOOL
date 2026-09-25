'use strict';

// KH1 *_mes_ofs.bin + *_mes_data.bin (парний формат). Один UI-слот на
// унікальний offset у .data; кілька pointer'ів на той самий offset =
// linkedCount. Compose пише ДВА файли: ofs → outPath, data → pairedDataName.

const fs = require('fs/promises');
const path = require('path');
const codec = require('../../../shared/codec');
const { parsePair, composePair, pairedDataName } = require('../mes-ofs');

async function parse(engPath, env) {
  const dataPath = env.cls && env.cls.extractOpts && env.cls.extractOpts.dataPath;
  if (!dataPath) throw new Error('Не знайдено пару _mes_data.bin для ' + path.basename(engPath));
  const cmd = (env.cls && env.cls.extractOpts && env.cls.extractOpts.cmd) || 'evmsg';
  const ofsBuf = await fs.readFile(engPath);
  const dataBuf = await fs.readFile(dataPath);
  const parsed = parsePair(ofsBuf, dataBuf, codec, { cmd });

  // Унікальні offsets у порядку першої появи в ofs (зручно для UI).
  const seen = new Map();
  for (const s of parsed.slots) {
    if (!seen.has(s.offset)) seen.set(s.offset, { count: 1, firstIdx: s.index, byteLen: s.byteLen, english: s.english });
    else seen.get(s.offset).count++;
  }
  const slots = [...seen.entries()]
    .sort((a, b) => a[1].firstIdx - b[1].firstIdx)
    .map(([off, info], idx) => ({
      index: idx,
      offset: off,
      byteLen: parsed.cellLengthByOffset.get(off) || info.byteLen,
      english: info.english,
      key: info.english,
      linkedCount: info.count
    }));

  return {
    slots,
    stats: {
      mesofs: true,
      pointerCount: parsed.pointerCount,
      uniqueStrings: parsed.uniqueStrings,
      ofsPadding: parsed.ofsPadding,
      dataPadding: parsed.dataPadding
    },
    engSize: ofsBuf.length + dataBuf.length,
    refSize: 0,
    async compose(ukByOffset) {
      const slotsForCompose = parsed.slots.map(s => ({
        offset: s.offset,
        english: s.english,
        ukText: ukByOffset.has(s.offset) ? ukByOffset.get(s.offset) : s.english
      }));
      const c = composePair(slotsForCompose, {
        ofsLength: ofsBuf.length,
        dataLength: dataBuf.length,
        cellLengthByOffset: parsed.cellLengthByOffset
      }, codec);
      return {
        outputs: [
          { buf: c.ofsBuf, pathFor: (outPath) => outPath },
          // data-половина: поруч з ofs у DONE; якщо у джерелі вона в іншій теці
          // (SASAMSG) — composeAll кладе її за srcPath у тій самій розкладці.
          { buf: c.dataBuf, srcPath: dataPath, pathFor: (outPath) => path.join(path.dirname(outPath), pairedDataName(path.basename(outPath))) }
        ],
        applied: ukByOffset.size,
        skipped: parsed.uniqueStrings - ukByOffset.size,
        errors: [],
        extra: { mesofs: { layout: c.layout, cmd } }
      };
    }
  };
}

module.exports = { kind: 'mesofs', preserveWhitespace: true, structuralGuard: true, parse };
