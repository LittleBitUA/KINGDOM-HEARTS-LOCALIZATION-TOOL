'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { decodePng, encodePng } = require('../tools/lib/png');
const { parseImgz, decodeImgd, replaceImgz } = require('../tools/lib/recom-imgz');

// синтетичний IMGD 32bpp w×h
function makeImgd(w, h, fill) {
  const sub = Buffer.alloc(0x40 + w * h * 4);
  sub.write('IMGD', 0, 'ascii'); sub.writeUInt32LE(0x100, 4);
  sub.writeUInt32LE(0x40, 8); sub.writeUInt32LE(w * h * 4, 12); sub.writeUInt32LE(0x40 + w * h * 4, 16); sub.writeUInt32LE(0, 20);
  sub.writeUInt16LE(w, 0x1C); sub.writeUInt16LE(h, 0x1E);
  for (let i = 0; i < w * h; i++) fill(sub, 0x40 + i * 4, i);
  return sub;
}
function makeImgz(subs) {
  const tab = 0x10, dataStart = tab + subs.length * 8;
  const parts = [Buffer.alloc(dataStart)];
  parts[0].write('IMGZ', 0, 'ascii'); parts[0].writeUInt32LE(0x100, 4); parts[0].writeUInt32LE(tab, 8); parts[0].writeUInt32LE(subs.length, 12);
  let off = dataStart;
  subs.forEach((s, i) => { parts[0].writeUInt32LE(off, tab + i * 8); parts[0].writeUInt32LE(s.length, tab + i * 8 + 4); off += s.length; parts.push(s); });
  return Buffer.concat(parts);
}

test('png: encode → decode round-trip RGBA with partial alpha', () => {
  const w = 5, h = 3, rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = i * 13; rgba[i * 4 + 1] = 255 - i * 7; rgba[i * 4 + 2] = i * 3; rgba[i * 4 + 3] = (i * 37) & 0xFF; }
  const d = decodePng(encodePng(w, h, rgba));
  assert.strictEqual(d.width, w); assert.strictEqual(d.height, h);
  assert.ok(d.rgba.equals(rgba));
});

test('png: decodes RGB with filters and palette + tRNS', () => {
  // RGB 2×2 з фільтром Sub у другому рядку
  const raw = Buffer.from([0, 10, 20, 30, 40, 50, 60, 1, 5, 5, 5, 1, 1, 1]);
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); return Buffer.concat([len, Buffer.from(t), d, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const d = decodePng(png);
  assert.deepStrictEqual([...d.rgba], [10, 20, 30, 255, 40, 50, 60, 255, 5, 5, 5, 255, 6, 6, 6, 255]);
  // палітра 1×2 + tRNS
  const ihdr2 = Buffer.alloc(13); ihdr2.writeUInt32BE(1, 0); ihdr2.writeUInt32BE(2, 4); ihdr2[8] = 8; ihdr2[9] = 3;
  const png2 = Buffer.concat([sig, chunk('IHDR', ihdr2), chunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 255])), chunk('tRNS', Buffer.from([128])),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 1]))), chunk('IEND', Buffer.alloc(0))]);
  assert.deepStrictEqual([...decodePng(png2).rgba], [255, 0, 0, 128, 0, 0, 255, 255]);
});

test('imgz: parse, decode (alpha ×2) and replace keeps other entries byte-identical', () => {
  const a = makeImgd(4, 2, (b, o, i) => { b[o] = i; b[o + 1] = 2 * i; b[o + 2] = 3 * i; b[o + 3] = i % 2 ? 0x80 : 0x40; });
  const b = makeImgd(2, 2, (buf, o) => { buf[o] = 9; buf[o + 1] = 9; buf[o + 2] = 9; buf[o + 3] = 0x80; });
  const imgz = makeImgz([a, b]);
  const entries = parseImgz(imgz);
  assert.strictEqual(entries.length, 2);
  const d0 = decodeImgd(imgz.subarray(entries[0].off, entries[0].off + entries[0].size));
  assert.strictEqual(d0.width, 4); assert.strictEqual(d0.rgba[3], 0x80); assert.strictEqual(d0.rgba[7], 255);
  // заміна #0 тим самим зображенням → контейнер побайтово той самий
  const same = replaceImgz(imgz, { 0: d0 });
  assert.ok(same.equals(imgz));
  // заміна #1 новим кольором: #0 без змін, #1 — новий, альфа ÷2
  const rgba = Buffer.alloc(16, 0xFF);
  const out = replaceImgz(imgz, { 1: { width: 2, height: 2, rgba } });
  assert.ok(out.subarray(0, entries[1].off).equals(imgz.subarray(0, entries[1].off)));
  assert.strictEqual(out[entries[1].off + 0x40 + 3], 0x80);
  assert.throws(() => replaceImgz(imgz, { 1: { width: 3, height: 2, rgba: Buffer.alloc(24) } }), /розмір/);
});
