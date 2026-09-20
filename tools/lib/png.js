'use strict';

// Мінімальний PNG-кодек без залежностей (zlib з Node): читаємо 8-бітні
// неінтерлейсні PNG (Gray / Gray+A / RGB / RGBA / палітра + tRNS) у RGBA,
// пишемо RGBA. Потрібен для текстур Re:CoM: nativeImage Electron працює з
// premultiplied-альфою і спотворює напівпрозорі пікселі, а тут важлива
// точність (round-trip з IMGD має бути побайтовим).

const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

// decodePng(buf) → { width, height, rgba: Buffer }
function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('не PNG');
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!width || !height) throw new Error('PNG без IHDR');
  if (depth !== 8) throw new Error('PNG: підтримується лише 8 біт на канал (тут ' + depth + ')');
  if (interlace) throw new Error('PNG: interlaced не підтримується');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('PNG: невідомий тип кольору ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[rp++];
    raw.copy(cur, 0, rp, rp + stride); rp += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) cur[i] = (cur[i] + a) & 0xFF;
      else if (f === 2) cur[i] = (cur[i] + b) & 0xFF;
      else if (f === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xFF;
      else if (f === 4) cur[i] = (cur[i] + paeth(a, b, c)) & 0xFF;
    }
    let o = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = x * ch;
      if (ctype === 6) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = cur[i + 3]; }
      else if (ctype === 2) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = 255; }
      else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = 255; }
      else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = cur[i + 1]; }
      else { // палітра
        const p = cur[i] * 3;
        out[o] = palette ? palette[p] : 0; out[o + 1] = palette ? palette[p + 1] : 0; out[o + 2] = palette ? palette[p + 2] : 0;
        out[o + 3] = trns && cur[i] < trns.length ? trns[cur[i]] : 255;
      }
      o += 4;
    }
    cur.copy(prev);
  }
  return { width, height, rgba: out };
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

// encodePng(width, height, rgba) → Buffer (RGBA 8-біт, без фільтрів)
function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: розмір буфера не збігається');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { decodePng, encodePng };
