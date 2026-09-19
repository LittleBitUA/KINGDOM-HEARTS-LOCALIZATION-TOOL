'use strict';

// Синтетичні бінарні фікстури для тестів — жодних файлів з гри.

const kh1 = require('../../shared/codec');
const ctdCodec = require('../../tools/lib/bbs-codec');
const ctdFmt = require('../../tools/lib/ctd-format');
const ctdlCodec = require('../../tools/lib/recom-ctdl-codec');
const ctdlFmt = require('../../tools/lib/recom-ctdl-format');

// ---- KH1 .binl: header(11) + null-terminated KH1-strings + footer(5) ----
function buildBinl(strings, opts) {
  const header = (opts && opts.header != null) ? opts.header : 11;
  const footer = (opts && opts.footer != null) ? opts.footer : 5;
  const parts = [Buffer.from('EvMsg\0\0\0\0\0\0'.slice(0, header).padEnd(header, '\0'), 'latin1')];
  for (const s of strings) {
    parts.push(kh1.encode(s, { overlay: false }));
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.alloc(footer, 0));
  return Buffer.concat(parts);
}

// ---- KH1 *_mes_ofs.bin + *_mes_data.bin ----
// strings: масив унікальних рядків; pointers: масив індексів у strings (для linked).
function buildMesOfs(strings, pointers, opts) {
  const pad = (opts && opts.pad) || 0;
  const chunks = [];
  const offsets = [];
  let cur = 0;
  for (const s of strings) {
    const enc = kh1.encode(s, { overlay: false });
    const chunk = Buffer.concat([enc, Buffer.from([0])]);
    offsets.push(cur);
    chunks.push(chunk);
    cur += chunk.length;
  }
  const data = Buffer.concat([...chunks, Buffer.alloc(pad, 0xCD)]);
  const ofs = Buffer.alloc(pointers.length * 2 + pad, 0xCD);
  pointers.forEach((si, i) => ofs.writeUInt16LE(offsets[si], i * 2));
  return { ofs, data, offsets };
}

// ---- KH1 .ev: 3 counts + textOffset + pointers + text + footer ----
function buildEv(strings, footerBytes) {
  const footer = footerBytes || Buffer.from([0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22]);
  const textParts = [];
  for (const s of strings) {
    textParts.push(kh1.encode(s, { overlay: false }), Buffer.from([0]));
  }
  let text = Buffer.concat(textParts);
  const padLen = (4 - (text.length % 4)) % 4;
  if (padLen) text = Buffer.concat([text, Buffer.alloc(padLen, 0)]);
  // header: 0x00 c1,c2,c3; 0x0C textOffset; 0x10.. pointers (2 шт.)
  const ptrCount = 2;
  const textOffset = 16 + ptrCount * 4;
  const footerOffset = textOffset + text.length;
  const header = Buffer.alloc(textOffset);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(3, 8);
  header.writeUInt32LE(textOffset, 12);
  header.writeUInt32LE(footerOffset, 16);        // pointer у footer (реалокується)
  header.writeUInt32LE(footerOffset + 4, 20);    // ще один у footer
  return { buf: Buffer.concat([header, text, footer]), textOffset, footerOffset };
}

// ---- BBS .ctd ----
// messages: [{ id, text, layoutIndex?, waitFrames? }], layoutCount
function buildCtd(messages, layoutCount) {
  const HEADER = 0x20;
  const msgTable = messages.length * 12;
  const layoutOffset = alignUp(HEADER + msgTable, 16);
  const layoutSize = (layoutCount || 1) * 32;
  const textStart = layoutOffset + layoutSize;
  const encoded = messages.map(m => ctdCodec.encode(m.text));
  let cursor = textStart;
  const textOffsets = encoded.map(e => { const o = cursor; cursor += e.length + 1; return o; });
  const total = alignUp(cursor, 16);
  const buf = Buffer.alloc(total, 0);
  buf.fill(0xCD, textStart, total);
  buf.writeUInt32LE(ctdFmt.MAGIC, 0);
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(0x1234, 8);
  buf.writeUInt16LE(layoutCount || 1, 0x0C);
  buf.writeUInt16LE(messages.length, 0x0E);
  buf.writeUInt32LE(HEADER, 0x10);
  buf.writeUInt32LE(layoutOffset, 0x14);
  buf.writeUInt32LE(textStart, 0x18);
  buf.writeUInt32LE(0, 0x1C);
  messages.forEach((m, i) => {
    const off = HEADER + i * 12;
    buf.writeUInt32LE(m.id, off);
    buf.writeUInt32LE(textOffsets[i], off + 4);
    buf.writeUInt16LE(m.layoutIndex || 0, off + 8);
    buf.writeUInt16LE(m.waitFrames || 0, off + 10);
  });
  for (let i = 0; i < layoutSize; i++) buf[layoutOffset + i] = (i * 7) & 0xFF; // будь-який blob
  encoded.forEach((e, i) => { e.copy(buf, textOffsets[i]); buf[textOffsets[i] + e.length] = 0; });
  return buf;
}

// ---- Re:CoM .ctdl (портовано з tools/ctdl-roundtrip.js) ----
function buildCtdl(textsIn) {
  const texts = (textsIn || ['Hello', 'Sora\nDonald', 'Press {icon 66}\nfor menu.']).map(t => ctdlCodec.encode(t));
  const headerSize = 0x10;
  const textboxCount = 1;
  const ptOff = headerSize + textboxCount * 48;
  const blockBase = ptOff + texts.length * 4;
  const align4 = (n) => ((n + 4) >> 2) << 2;                    // len + NUL, вирівняно на 4 (як у грі)
  const total = blockBase + texts.reduce((s, t) => s + align4(t.length), 0) + 4;
  const buf = Buffer.alloc(total);
  buf.writeUInt32LE(ctdlFmt.MAGIC, 0x00);
  buf.writeUInt16LE(textboxCount, 0x04);
  buf.writeUInt16LE(texts.length, 0x06);
  buf.writeUInt32LE(ptOff, 0x08);
  buf.writeUInt32LE(blockBase, 0x0C);
  const off = headerSize;
  buf.writeUInt16LE(0, off);
  buf[off + 0x02] = 0x04; buf[off + 0x03] = 0x50;
  buf.fill(0xFF, off + 0x04, off + 0x08);
  buf[off + 0x0B] = 0xFF;
  buf.fill(0xFF, off + 0x0C, off + 0x10);
  buf.writeUInt32LE(0, off + 0x10);
  buf[off + 0x14] = 1;
  buf.writeUInt16LE(120, off + 0x16);
  buf.writeUInt16LE(80, off + 0x18);
  buf.writeUInt16LE(400, off + 0x1A);
  buf.writeUInt16LE(80, off + 0x1C);
  buf[off + 0x20] = 2;
  buf.writeUInt16LE(22, off + 0x22);
  buf.writeUInt16LE(0xFFFF, off + 0x24);
  let cur = blockBase;
  texts.forEach((t, i) => { buf.writeUInt32LE(cur - blockBase, ptOff + i * 4); cur += align4(t.length); });
  cur = blockBase;
  for (const t of texts) { t.copy(buf, cur); cur += align4(t.length); }
  return buf;
}

function alignUp(v, m) { const r = v % m; return r === 0 ? v : v + (m - r); }

module.exports = { buildBinl, buildMesOfs, buildEv, buildCtd, buildCtdl };
