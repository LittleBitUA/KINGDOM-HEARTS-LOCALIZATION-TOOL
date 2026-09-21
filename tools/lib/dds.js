'use strict';

// Мінімальний DDS-кодек для HD-текстур BBS (remastered/arc_*/…/US_*_arcN.dds):
// усі вони — нестиснені 32-bit RGB з масками (A8R8G8B8, pf_flags 0x41),
// один mip-рівень. Читаємо будь-який нестиснений 32/24-bit DDS у RGBA;
// пишемо назад З ОРИГІНАЛЬНИМ заголовком (128 байтів) — змінюються лише
// пікселі, тож формат/маски/прапорці лишаються такими, як очікує гра.
// Стиснені (DXT1/3/5, DX10) — лише info, заміна не підтримується.

const DDS_MAGIC = 0x20534444;   // 'DDS '
const DDPF_ALPHAPIXELS = 0x1, DDPF_FOURCC = 0x4, DDPF_RGB = 0x40;

// ddsInfo(buf) → { w, h, mips, bpp, fourcc, masks: {r,g,b,a}, dataOff, compressed }
function ddsInfo(buf) {
  if (buf.length < 128 || buf.readUInt32LE(0) !== DDS_MAGIC) throw new Error('not a DDS file');
  if (buf.readUInt32LE(4) !== 124) throw new Error('bad DDS header size');
  const h = buf.readUInt32LE(12), w = buf.readUInt32LE(16), mips = buf.readUInt32LE(28);
  const pfFlags = buf.readUInt32LE(80);
  const fourcc = buf.subarray(84, 88).toString('latin1');
  const bpp = buf.readUInt32LE(88);
  const masks = { r: buf.readUInt32LE(92) >>> 0, g: buf.readUInt32LE(96) >>> 0, b: buf.readUInt32LE(100) >>> 0, a: (pfFlags & DDPF_ALPHAPIXELS) ? buf.readUInt32LE(104) >>> 0 : 0 };
  const dx10 = (pfFlags & DDPF_FOURCC) && fourcc === 'DX10';
  const compressed = !!(pfFlags & DDPF_FOURCC);
  return { w, h, mips, bpp: compressed ? 0 : bpp, fourcc: compressed ? fourcc : '', masks, dataOff: dx10 ? 148 : 128, compressed, rgb: !!(pfFlags & DDPF_RGB) };
}

// зсув і ширина маски (наприклад 0x00FF0000 → shift 16, bits 8)
function maskInfo(mask) {
  if (!mask) return null;
  let shift = 0; while (!((mask >>> shift) & 1)) shift++;
  let bits = 0; while ((mask >>> (shift + bits)) & 1) bits++;
  return { shift, bits, max: (1 << bits) - 1 };
}

// decodeDds(buf) → { width, height, rgba: Buffer, bpp }
function decodeDds(buf) {
  const inf = ddsInfo(buf);
  if (inf.compressed) throw new Error('DDS ' + inf.fourcc + ' (стиснена) — не підтримується');
  if (inf.bpp !== 32 && inf.bpp !== 24) throw new Error('DDS ' + inf.bpp + ' bpp — не підтримується');
  const bpr = inf.bpp >> 3;
  const need = inf.dataOff + inf.w * inf.h * bpr;
  if (buf.length < need) throw new Error('DDS обрізаний: ' + buf.length + ' < ' + need);
  const mr = maskInfo(inf.masks.r), mg = maskInfo(inf.masks.g), mb = maskInfo(inf.masks.b), ma = maskInfo(inf.masks.a);
  const rgba = Buffer.alloc(inf.w * inf.h * 4);
  const take = (px, m) => (m ? Math.round(((px >>> m.shift) & m.max) * 255 / m.max) : 0);
  for (let i = 0, o = inf.dataOff; i < inf.w * inf.h; i++, o += bpr) {
    const px = bpr === 4 ? buf.readUInt32LE(o) : (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16)) >>> 0;
    rgba[i * 4] = take(px, mr); rgba[i * 4 + 1] = take(px, mg); rgba[i * 4 + 2] = take(px, mb);
    rgba[i * 4 + 3] = ma ? take(px, ma) : 255;
  }
  return { width: inf.w, height: inf.h, rgba, bpp: inf.bpp };
}

// encodeDds(origBuf, rgba) → Buffer: заголовок оригіналу + нові пікселі у його масках.
// Розмір має збігатися з оригіналом (перевіряє викликач через ddsInfo).
function encodeDds(origBuf, width, height, rgba) {
  const inf = ddsInfo(origBuf);
  if (inf.compressed) throw new Error('DDS ' + inf.fourcc + ' (стиснена) — заміна не підтримується');
  if (inf.w !== width || inf.h !== height) throw new Error('розмір ' + width + '×' + height + ' ≠ ' + inf.w + '×' + inf.h + ' в оригіналі');
  const bpr = inf.bpp >> 3;
  const mr = maskInfo(inf.masks.r), mg = maskInfo(inf.masks.g), mb = maskInfo(inf.masks.b), ma = maskInfo(inf.masks.a);
  const out = Buffer.alloc(inf.dataOff + width * height * bpr);
  origBuf.copy(out, 0, 0, inf.dataOff);
  const put = (v, m) => (m ? (Math.round(v * m.max / 255) << m.shift) >>> 0 : 0);
  for (let i = 0, o = inf.dataOff; i < width * height; i++, o += bpr) {
    const px = (put(rgba[i * 4], mr) | put(rgba[i * 4 + 1], mg) | put(rgba[i * 4 + 2], mb) | put(rgba[i * 4 + 3], ma)) >>> 0;
    if (bpr === 4) out.writeUInt32LE(px, o);
    else { out[o] = px & 0xFF; out[o + 1] = (px >>> 8) & 0xFF; out[o + 2] = (px >>> 16) & 0xFF; }
  }
  return out;
}

module.exports = { ddsInfo, decodeDds, encodeDds };
