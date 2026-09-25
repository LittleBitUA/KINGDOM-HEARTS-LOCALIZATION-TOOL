'use strict';

// =====================================================================
// KH1 *_mes_ofs.bin + *_mes_data.bin — paired format.
//
// .ofs structure:
//   - sequence of int16 LE pointers into .data
//   - 0x00 0x00 = pointer to first string (multiple repeated 0x0000 = links to same)
//   - last N bytes are CD-padding
//
// .data structure:
//   - concatenated strings, each terminated by 0x00 ({eol})
//   - encoded with the standard KH1 codec
//   - last byte(s) are CD-padding
//
// Slots model (for the editor):
//   Each slot represents ONE pointer in .ofs (slot.index = position in pointer array).
//   slot.offset = pointer value (data-offset in .data). Multiple slots can share the
//   same offset → "linked". When user edits a string, the change propagates to all
//   slots with matching offset.
// =====================================================================

const PAD_BYTE = 0xCD;
const { scanMsgEnd } = require('./menu-msg');

function naiveEnd(buf, start, end) {
  let e = start;
  while (e < end && buf[e] !== 0x00) e++;
  return e;
}

function trimCdPadding(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === PAD_BYTE) end--;
  return { length: end, padCount: buf.length - end };
}

// parsePair(ofsBuf, dataBuf, codec, opts?) — opts.cmd: 'evmsg' (default) | 'sysmsg'
// (діалект команд: SAW*/SASA/Challenge — текст меню, 0x00 усередині команд).
function parsePair(ofsBuf, dataBuf, codec, opts) {
  const cmd = (opts && opts.cmd) || 'evmsg';
  const ofsTrim = trimCdPadding(ofsBuf);
  const dataTrim = trimCdPadding(dataBuf);

  const pointers = [];
  for (let i = 0; i + 1 < ofsTrim.length; i += 2) {
    pointers.push(ofsBuf.readUInt16LE(i));
  }

  // Extract unique offsets and decode each string.
  const stringByOffset = new Map(); // offset -> { english, byteLen }
  const sortedOffsets = [...new Set(pointers)].sort((a, b) => a - b);
  for (let i = 0; i < sortedOffsets.length; i++) {
    const off = sortedOffsets[i];
    if (off >= dataTrim.length) continue; // pointer лежить у padding-зоні?
    const end = cmd === 'sysmsg' ? scanMsgEnd(dataBuf, off, dataTrim.length) : naiveEnd(dataBuf, off, dataTrim.length);
    const sliceWithEol = dataBuf.slice(off, end + 1); // include 0x00
    let decoded = '';
    try { decoded = codec.decode(sliceWithEol, { cmd }); } catch (_) { decoded = ''; }
    stringByOffset.set(off, {
      english: decoded.replace(/\n$/, ''), // codec додає '\n' після {eol} — приберемо
      byteLen: sliceWithEol.length,
      rawOffset: off
    });
  }

  // Build slots: one per pointer.
  const slots = pointers.map((off, idx) => {
    const info = stringByOffset.get(off);
    return {
      index: idx,
      offset: off,                     // оригінальна data-offset
      ptrFileOffset: idx * 2,          // байтовий offset у .ofs файлі
      english: info ? info.english : '',
      byteLen: info ? info.byteLen : 0
    };
  });

  // Розрахунок cellLength для кожного унікального offset:
  //   cellLength[i] = sortedOffsets[i+1] - sortedOffsets[i]   (gap до наступного)
  //   cellLength[last] = dataTrim.length - sortedOffsets[last] (до кінця даних
  //                      без CD-padding'у)
  const cellLengthByOffset = new Map();
  for (let i = 0; i < sortedOffsets.length; i++) {
    const here = sortedOffsets[i];
    const next = (i + 1 < sortedOffsets.length) ? sortedOffsets[i + 1] : dataTrim.length;
    cellLengthByOffset.set(here, next - here);
  }

  return {
    slots,
    pointerCount: pointers.length,
    ofsPadding: ofsTrim.padCount,
    dataPadding: dataTrim.padCount,
    ofsLength: ofsBuf.length,
    dataLength: dataBuf.length,
    uniqueStrings: sortedOffsets.length,
    cellLengthByOffset
  };
}

function composePair(slots, originalInfo, codec, opts) {
  // slots: масив { offset, english, ukText? }
  // originalInfo: { ofsLength, dataLength, cellLengthByOffset?: Map<oldOffset, byteCellLength> }
  //
  // Стратегія «cell-preserving»:
  //   Якщо передано originalInfo.cellLengthByOffset — кожен рядок займає
  //   рівно стільки байтів скільки його cell у оригіналі (encoded + 0x00 +
  //   zero-pad до cellLength). Це зберігає original layout 1:1 у round-trip
  //   з англ. та зручно для гри (offsets лишаються незмінні).
  //
  //   Якщо UK encoded.length + 1 > cellLength → fallback до COMPACT-режиму:
  //   string зміщує наступні, пере-підраховуються offsets. Але offsets
  //   все одно вкладаються в int16 (65535).

  // Step 1: unique strings.
  const stringByOffset = new Map();
  for (const s of slots) {
    if (!stringByOffset.has(s.offset)) {
      const text = (s.ukText && s.ukText.length) ? s.ukText : (s.english || '');
      stringByOffset.set(s.offset, text);
    }
  }
  const orderedOffsets = [...stringByOffset.keys()].sort((a, b) => a - b);

  const cellMap = (originalInfo && originalInfo.cellLengthByOffset) || null;

  // Step 2: encode кожен рядок ОДИН раз (раніше — двічі: перевірка + запис).
  const encodedByOffset = new Map();
  for (const oldOff of orderedOffsets) {
    encodedByOffset.set(oldOff, codec.encode(stringByOffset.get(oldOff)));
  }
  const dataChunks = [];
  const newOffsetByOld = new Map();
  let cursor = 0;
  let usedCellLayout = !!cellMap;

  // Перевіримо чи всі влізають у cells; збираємо overflow для повідомлення.
  const overflow = [];
  if (cellMap) {
    for (const oldOff of orderedOffsets) {
      const encoded = encodedByOffset.get(oldOff);
      const needLen = encoded.length + (encoded[encoded.length - 1] === 0x00 ? 0 : 1);
      const cellLen = cellMap.get(oldOff) || 0;
      if (needLen > cellLen) {
        usedCellLayout = false;
        overflow.push({ offset: oldOff, need: needLen, cell: cellLen, text: stringByOffset.get(oldOff) });
      }
    }
  }

  if (usedCellLayout) {
    // Cell-preserving режим: кожна строка → encoded + 0x00 (якщо нема) + zero-pad
    // до cellLength. Old offsets зберігаються 1:1.
    for (const oldOff of orderedOffsets) {
      newOffsetByOld.set(oldOff, oldOff);
    }
    // Вибудовуємо в порядку offset'ів — між cells може бути «розрив»
    // (хоча для round-trip-EN це не повинно бути; cells суміжні за визначенням).
    const totalDataLen = (originalInfo && originalInfo.dataLength) || 0;
    const dataBufFull = Buffer.alloc(totalDataLen, PAD_BYTE);
    for (const oldOff of orderedOffsets) {
      const encoded = encodedByOffset.get(oldOff);
      const cellLen = cellMap.get(oldOff);
      // Записати encoded
      encoded.copy(dataBufFull, oldOff);
      // Додати 0x00 якщо encoded не закінчується ним
      let writePos = oldOff + encoded.length;
      if (!encoded.length || encoded[encoded.length - 1] !== 0x00) {
        dataBufFull[writePos++] = 0x00;
      }
      // Pad залишок cell нулями
      for (let p = writePos; p < oldOff + cellLen; p++) dataBufFull[p] = 0x00;
    }
    // Build ofs з оригінальними offsets
    const ofsBuf = Buffer.alloc(slots.length * 2);
    for (let i = 0; i < slots.length; i++) {
      ofsBuf.writeUInt16LE(slots[i].offset, i * 2);
    }
    const targetOfsLen = (originalInfo && originalInfo.ofsLength) || ofsBuf.length;
    const ofsPad = Buffer.alloc(targetOfsLen - ofsBuf.length, PAD_BYTE);
    return {
      ofsBuf: Buffer.concat([ofsBuf, ofsPad]),
      dataBuf: dataBufFull,
      layout: 'cell-preserving'
    };
  }

  // Compact режим (UK задовгий — пакуємо щільно).
  for (const oldOff of orderedOffsets) {
    const encoded = encodedByOffset.get(oldOff);
    let chunk;
    if (encoded.length && encoded[encoded.length - 1] === 0x00) {
      chunk = encoded;
    } else {
      chunk = Buffer.concat([encoded, Buffer.from([0x00])]);
    }
    newOffsetByOld.set(oldOff, cursor);
    dataChunks.push(chunk);
    cursor += chunk.length;
  }
  if (cursor > 0xFFFF) {
    throw new Error('mes_data overflow: ' + cursor + ' bytes > int16 max (65535). UK переклад занадто довгий.' + describeOverflow(overflow));
  }
  let dataBuf = Buffer.concat(dataChunks);

  const ofsBuf = Buffer.alloc(slots.length * 2);
  for (let i = 0; i < slots.length; i++) {
    const newOff = newOffsetByOld.get(slots[i].offset);
    ofsBuf.writeUInt16LE(newOff, i * 2);
  }

  const targetOfsLen = (originalInfo && originalInfo.ofsLength) || ofsBuf.length;
  // .data може рости: у самій грі FR/GR/IT/SP-версії gumi_mes_data більші за UK
  // (5568–6064 проти 4816 байт) при тому самому .ofs, тож фіксований розмір — не
  // вимога формату. Тримаємо вирівнювання на 16 байт (усі оригінали кратні 16);
  // межа — лише uint16-вказівники.
  const origDataLen = (originalInfo && originalInfo.dataLength) || 0;
  const targetDataLen = Math.max(origDataLen, Math.ceil(dataBuf.length / 16) * 16);
  if (ofsBuf.length > targetOfsLen) {
    throw new Error('ofs buffer (' + ofsBuf.length + ') > target ofs length (' + targetOfsLen + ')');
  }
  if (dataBuf.length > 0xFFFF) {
    throw new Error('data buffer (' + dataBuf.length + ') > 65535 — вказівники .ofs 16-бітні. Переклад не вміщується у файл.' + describeOverflow(overflow));
  }
  const ofsPad = Buffer.alloc(targetOfsLen - ofsBuf.length, PAD_BYTE);
  const dataPad = Buffer.alloc(targetDataLen - dataBuf.length, PAD_BYTE);
  return {
    ofsBuf: Buffer.concat([ofsBuf, ofsPad]),
    dataBuf: Buffer.concat([dataBuf, dataPad]),
    layout: 'compact'
  };
}

// Топ-5 найдовших переповнень для повідомлення — щоб перекладач бачив, ЩО скорочувати.
function describeOverflow(overflow) {
  if (!overflow || !overflow.length) return '';
  const top = overflow.slice().sort((a, b) => (b.need - b.cell) - (a.need - a.cell)).slice(0, 5);
  return ' Найдовші: ' + top.map(o =>
    '0x' + o.offset.toString(16).toUpperCase() + ' (+' + (o.need - o.cell) + 'б) «' +
    String(o.text).slice(0, 40) + (o.text.length > 40 ? '…' : '') + '»').join('; ');
}

// Допоміжне: чи це файл-пара mes_ofs?
// Пари таблиця-зсувів + дані (u16-зсуви + 0xCD/0x00-доповнення):
//   `X_mes_ofs.bin`+`X_mes_data.bin`      — gummi-меню (діалект evmsg — команд меню там нема)
//   `X_offset.bin`+`X_data.bin`           — exchange/UK_wsysmsg_*, UK_wname_* (назви світів)
//   `X_ChallengeOfs.binl`+`X_ChallengeMsg.bin` — worldmap/challe.dat (діалект меню)
//   `X_SAWEOMSG.BIN`+`X_SAWEMSG.BIN`, `X_SAWDOMSG.BIN`+`X_SAWDMSG.BIN` — exchange (меню)
//   `X_SASAOMSG.BIN` (exchange) + `X_SASAMSG.BIN` (gumi/SASAMSG.BIN/ — інша тека!)
const PAIRS = [
  { ofs: /_mes_ofs\.bin$/i, data: '_mes_data.bin', cmd: 'evmsg' },
  { ofs: /_offset\.bin$/i, data: '_data.bin', cmd: 'evmsg' },
  { ofs: /ChallengeOfs\.binl$/i, data: 'ChallengeMsg.bin', cmd: 'sysmsg' },
  { ofs: /SAWEOMSG\.BIN$/i, data: 'SAWEMSG.BIN', cmd: 'sysmsg' },
  { ofs: /SAWDOMSG\.BIN$/i, data: 'SAWDMSG.BIN', cmd: 'sysmsg' },
  { ofs: /SASAOMSG\.BIN$/i, data: 'SASAMSG.BIN', cmd: 'sysmsg', dataDirs: ['../gumi/SASAMSG.BIN', '../../remastered/gumi/SASAMSG.BIN'] }
];
function pairRuleFor(ofsName) { return PAIRS.find(r => r.ofs.test(ofsName)) || null; }
function isMesOfsName(filename) { return !!pairRuleFor(filename); }
function pairedDataName(ofsName) {
  const r = pairRuleFor(ofsName);
  return r ? ofsName.replace(r.ofs, r.data) : null;
}
// Ім'я data-половини пари → ім'я таблиці зсувів (для класифікації).
function pairedOfsName(dataName) {
  for (const r of PAIRS) {
    const suffix = r.data;
    if (dataName.toLowerCase().endsWith(suffix.toLowerCase())) {
      // відновлюємо суфікс ofs з regex-джерела: `_mes_ofs.bin`, `SAWEOMSG.BIN`…
      const ofsSuffix = r.ofs.source.replace(/\\\./g, '.').replace(/\$$/, '');
      return dataName.slice(0, dataName.length - suffix.length) + ofsSuffix;
    }
  }
  return null;
}
// Де шукати data-половину відносно теки ofs-файла ('' = та сама тека).
function pairedDataDirs(ofsName) {
  const r = pairRuleFor(ofsName);
  return r ? [''].concat(r.dataDirs || []) : [''];
}
function pairDialect(ofsName) {
  const r = pairRuleFor(ofsName);
  return r ? r.cmd : 'evmsg';
}

module.exports = { parsePair, composePair, isMesOfsName, pairedDataName, pairedOfsName, pairedDataDirs, pairDialect, PAD_BYTE };
