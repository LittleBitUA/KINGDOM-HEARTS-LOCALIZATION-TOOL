'use strict';

// Текстури Re:Chain of Memories (HD): IMGD (як у KH2) і контейнер IMGZ.
//   IMGZ: 'IMGZ', u32 версія (0x100), u32 зсув таблиці (0x10), u32 кількість;
//         таблиця — (offset u32, size u32) на кожну текстуру; далі IMGD-блоки.
//   IMGD: 'IMGD', u32 версія, u32 bitmapOff, u32 bitmapLen, u32 clutOff, u32 clutLen,
//         i32, u16 w, u16 h, u16 powW, u16 powH, u16, u16, u32 fmt.
//         32bpp — RGBA; 8bpp — індекси + CLUT 256×RGBA зі swizzle PS2 (блоки по 8:
//         0,2,1,3). Альфа PS2: 0x80 = непрозоро (→ ×2 при читанні, ÷2 при записі).
// Написи інтерфейсу (FRIENDS, CARDS, LEVEL UP!…) — remastered/FORM/<n>/FOxxxx.RTM/UK_*.imz.

function parseImgz(buf) {
  if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'IMGZ') throw new Error('не IMGZ');
  const tab = buf.readUInt32LE(8), count = buf.readUInt32LE(12);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = buf.readUInt32LE(tab + i * 8), size = buf.readUInt32LE(tab + i * 8 + 4);
    if (off + size > buf.length) throw new Error('IMGZ: запис #' + i + ' поза файлом');
    entries.push({ index: i, off, size });
  }
  return entries;
}

function imgdInfo(sub) {
  if (sub.length < 0x40 || sub.toString('ascii', 0, 4) !== 'IMGD') throw new Error('не IMGD');
  const bo = sub.readUInt32LE(8), bl = sub.readUInt32LE(12), co = sub.readUInt32LE(16), cl = sub.readUInt32LE(20);
  const w = sub.readUInt16LE(0x1C), h = sub.readUInt16LE(0x1E);
  const bpp = bl === w * h * 4 ? 32 : (bl === w * h ? 8 : (bl * 2 === w * h ? 4 : 0));
  return { bo, bl, co, cl, w, h, bpp };
}

const swz = (i) => { const blk = i >> 5, j = i & 31, sub = [0, 2, 1, 3][j >> 3], k = j & 7; return blk * 32 + sub * 8 + k; };

// decodeImgd(sub) → { width, height, rgba } (альфа вже ×2)
function decodeImgd(sub) {
  const inf = imgdInfo(sub);
  const { w, h } = inf;
  const out = Buffer.alloc(w * h * 4);
  if (inf.bpp === 32) {
    sub.copy(out, 0, inf.bo, inf.bo + inf.bl);
    for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, out[i] * 2);
  } else if (inf.bpp === 8) {
    const clut = sub.subarray(inf.co, inf.co + 1024);
    for (let i = 0; i < w * h; i++) {
      const p = swz(sub[inf.bo + i]) * 4, o = i * 4;
      out[o] = clut[p]; out[o + 1] = clut[p + 1]; out[o + 2] = clut[p + 2]; out[o + 3] = Math.min(255, clut[p + 3] * 2);
    }
  } else throw new Error('IMGD ' + w + '×' + h + ': підтримуються лише 32bpp і 8bpp');
  return { width: w, height: h, rgba: out, bpp: inf.bpp };
}

// encodeImgd(sub, rgba) → новий IMGD-блок тієї самої довжини (лише 32bpp)
function encodeImgd(sub, width, height, rgba) {
  const inf = imgdInfo(sub);
  if (width !== inf.w || height !== inf.h) throw new Error('розмір PNG ' + width + '×' + height + ' ≠ ' + inf.w + '×' + inf.h);
  if (inf.bpp !== 32) throw new Error('заміна 8bpp-текстур (з палітрою) не підтримується — лише 32bpp');
  const out = Buffer.from(sub);
  rgba.copy(out, inf.bo, 0, inf.bl);
  for (let i = inf.bo + 3; i < inf.bo + inf.bl; i += 4) out[i] = (out[i] + 1) >> 1;
  return out;
}

// replaceImgz(buf, { index: rgbaInfo }) → новий буфер контейнера
function replaceImgz(buf, replacements) {
  const out = Buffer.from(buf);
  for (const e of parseImgz(buf)) {
    const r = replacements[e.index];
    if (!r) continue;
    const sub = encodeImgd(buf.subarray(e.off, e.off + e.size), r.width, r.height, r.rgba);
    sub.copy(out, e.off);
  }
  return out;
}

module.exports = { parseImgz, imgdInfo, decodeImgd, encodeImgd, replaceImgz };
