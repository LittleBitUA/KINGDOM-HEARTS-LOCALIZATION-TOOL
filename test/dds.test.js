'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ddsInfo, decodeDds, encodeDds } = require('../tools/lib/dds');

// синтетичний нестиснений DDS (як HD-текстури BBS: A8R8G8B8, pf_flags 0x41)
function makeDds(w, h, masks, bpp, fill) {
  const bpr = bpp >> 3;
  const buf = Buffer.alloc(128 + w * h * bpr);
  buf.write('DDS ', 0, 'ascii'); buf.writeUInt32LE(124, 4); buf.writeUInt32LE(0x1007, 8);
  buf.writeUInt32LE(h, 12); buf.writeUInt32LE(w, 16); buf.writeUInt32LE(w * bpr, 20); buf.writeUInt32LE(1, 28);
  buf.writeUInt32LE(32, 76); buf.writeUInt32LE(masks.a ? 0x41 : 0x40, 80); buf.writeUInt32LE(bpp, 88);
  buf.writeUInt32LE(masks.r, 92); buf.writeUInt32LE(masks.g, 96); buf.writeUInt32LE(masks.b, 100); buf.writeUInt32LE(masks.a || 0, 104);
  buf.writeUInt32LE(0x1000, 108);
  for (let i = 0; i < w * h; i++) fill(buf, 128 + i * bpr, i);
  return buf;
}
const ARGB = { r: 0x00FF0000, g: 0x0000FF00, b: 0x000000FF, a: 0xFF000000 };

test('dds: info + decode A8R8G8B8 (BGRA у пам’яті) → RGBA', () => {
  const dds = makeDds(3, 2, ARGB, 32, (b, o, i) => { b[o] = 10 + i; b[o + 1] = 20 + i; b[o + 2] = 30 + i; b[o + 3] = 200 + i; });   // B G R A
  const inf = ddsInfo(dds);
  assert.deepStrictEqual([inf.w, inf.h, inf.bpp, inf.compressed, inf.dataOff], [3, 2, 32, false, 128]);
  const img = decodeDds(dds);
  assert.strictEqual(img.width, 3); assert.strictEqual(img.height, 2);
  assert.deepStrictEqual([...img.rgba.subarray(0, 4)], [30, 20, 10, 200]);
  assert.deepStrictEqual([...img.rgba.subarray(20, 24)], [35, 25, 15, 205]);
});

test('dds: encode повертає оригінальний заголовок і нові пікселі (round-trip побайтовий)', () => {
  const dds = makeDds(4, 4, ARGB, 32, (b, o, i) => { b.writeUInt32LE((i * 0x01010101) >>> 0, o); });
  const img = decodeDds(dds);
  const back = encodeDds(dds, img.width, img.height, img.rgba);
  assert.ok(back.equals(dds));
  const edited = Buffer.from(img.rgba); edited[0] = 1; edited[1] = 2; edited[2] = 3; edited[3] = 4;
  const out = encodeDds(dds, 4, 4, edited);
  assert.ok(out.subarray(0, 128).equals(dds.subarray(0, 128)));
  assert.deepStrictEqual([...out.subarray(128, 132)], [3, 2, 1, 4]);   // B G R A
  assert.deepStrictEqual([...decodeDds(out).rgba.subarray(0, 4)], [1, 2, 3, 4]);
});

test('dds: 24-bit RGB без альфи → alpha 255; інший розмір і стиснені — помилка', () => {
  const rgb = makeDds(2, 1, { r: 0xFF0000, g: 0xFF00, b: 0xFF }, 24, (b, o, i) => { b[o] = 1; b[o + 1] = 2; b[o + 2] = 3 + i; });
  const img = decodeDds(rgb);
  assert.deepStrictEqual([...img.rgba], [3, 2, 1, 255, 4, 2, 1, 255]);
  assert.ok(encodeDds(rgb, 2, 1, img.rgba).equals(rgb));
  assert.throws(() => encodeDds(rgb, 2, 2, Buffer.alloc(16)), /розмір/);
  const dxt = makeDds(4, 4, ARGB, 32, () => {}); dxt.writeUInt32LE(0x4, 80); dxt.write('DXT5', 84, 'ascii');
  assert.strictEqual(ddsInfo(dxt).compressed, true);
  assert.throws(() => decodeDds(dxt), /DXT5/);
});
