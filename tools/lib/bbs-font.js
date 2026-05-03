'use strict';

// BBS Font format library — parser + composer для INF / COD.
// Опціонально (поки не реалізовано): MTX/CLU для SD-fallback.
//
// Структура per-font у розпакованому FontEn.arc:
//   <font>.inf  (8 b)        — texture metadata
//   <font>.cod  (8 b/entry)  — per-character data (ID, X, Y, palette, width)
//   <font>.mtx               — 4-bit indexed atlas з 256-byte swizzle (SD)
//   <font>.clu  (1024 b)     — RGBA palette
// HD remastered має PNG атлас замість MTX+CLU.
//
// Reference: openkh.dev/bbs/font.html + reverse-engineering on CTdi400.cod

const path = require('path');
const fs = require('fs');

// === INF ===
// 8 bytes:
//   0x00 short charCount
//   0x02 short textureWidth
//   0x04 short textureHeight
//   0x06 byte  charWidth   (cell width у пікселях)
//   0x07 byte  charHeight  (cell height у пікселях)
function parseInf(buf) {
  if (buf.length < 8) throw new Error('bbs-font: .inf too short (' + buf.length + ' < 8 bytes)');
  return {
    charCount:     buf.readUInt16LE(0x00),
    textureWidth:  buf.readUInt16LE(0x02),
    textureHeight: buf.readUInt16LE(0x04),
    charWidth:     buf.readUInt8(0x06),
    charHeight:    buf.readUInt8(0x07)
  };
}

function composeInf(meta) {
  const out = Buffer.alloc(8);
  out.writeUInt16LE(meta.charCount, 0x00);
  out.writeUInt16LE(meta.textureWidth, 0x02);
  out.writeUInt16LE(meta.textureHeight, 0x04);
  out.writeUInt8(meta.charWidth, 0x06);
  out.writeUInt8(meta.charHeight, 0x07);
  return out;
}

// === COD ===
// 8 bytes per entry:
//   0x00 short charID  (encoding-byte, e.g. 0x817E = 'X')
//   0x02 short posX    (pixels у межах block)
//   0x04 short posY    (pixels)
//   0x06 byte  palette
//   0x07 byte  width   (advance width у пікселях)
function parseCod(buf) {
  const ENTRY = 8;
  const count = Math.floor(buf.length / ENTRY);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = i * ENTRY;
    entries.push({
      index: i,
      id:      buf.readUInt16LE(off + 0x00),
      posX:    buf.readUInt16LE(off + 0x02),
      posY:    buf.readUInt16LE(off + 0x04),
      palette: buf.readUInt8(off + 0x06),
      width:   buf.readUInt8(off + 0x07)
    });
  }
  return entries;
}

function composeCod(entries) {
  const ENTRY = 8;
  const out = Buffer.alloc(entries.length * ENTRY);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = i * ENTRY;
    out.writeUInt16LE(e.id & 0xFFFF, off + 0x00);
    out.writeUInt16LE(e.posX & 0xFFFF, off + 0x02);
    out.writeUInt16LE(e.posY & 0xFFFF, off + 0x04);
    out.writeUInt8(e.palette & 0xFF, off + 0x06);
    out.writeUInt8(e.width & 0xFF, off + 0x07);
  }
  return out;
}

// === Font discovery ===
// Скан тек з FontEn.arc-розпакуванням → список усіх font-types
// (cmdfont, mesfont, helpfont, fonticon, menufont, numeral).
// Повертає масив { name, infPath, codPath, mtxPath?, cluPath?, hdPngPath? }.
function discoverFonts(unpackDir, opts) {
  const remasteredDir = opts && opts.remasteredDir;
  let entries;
  try { entries = fs.readdirSync(unpackDir); }
  catch (e) { throw new Error('bbs-font: cannot read unpack dir: ' + e.message); }

  const byName = new Map();
  for (const name of entries) {
    const m = name.match(/^(.+?)\.(inf|cod|mtx|clu)$/i);
    if (!m) continue;
    const fontName = m[1].toLowerCase();
    const ext = m[2].toLowerCase();
    if (!byName.has(fontName)) byName.set(fontName, { name: fontName });
    byName.get(fontName)[ext + 'Path'] = path.join(unpackDir, name);
  }

  // HD-remastered PNG: shape `US_FontEn_arcN.png` → треба знайти який N відповідає
  // якому font-name. Нумерація = порядок entries у ARC. Це треба з'ясовувати окремо;
  // поки складаємо за іменем якщо є аналогічний у remastered.
  if (remasteredDir) {
    try {
      const rmEntries = fs.readdirSync(remasteredDir);
      // PNG-файли мають назви типу `<arc-name>_arc<N>.png`. Без додаткової мапи
      // не можемо точно зіставити. Записуємо всі для UI вибору.
      const pngs = rmEntries.filter(f => /\.png$/i.test(f)).map(f => path.join(remasteredDir, f));
      for (const f of byName.values()) f._availableHdPngs = pngs;
    } catch (_) {}
  }

  return [...byName.values()].filter(f => f.infPath && f.codPath);
}

// === High-level load helper ===
// Читає INF + COD одного шрифту, повертає об'єкт з даними.
function loadFont(fontFiles) {
  const infBuf = fs.readFileSync(fontFiles.infPath);
  const codBuf = fs.readFileSync(fontFiles.codPath);
  return {
    name: fontFiles.name,
    inf: parseInf(infBuf),
    entries: parseCod(codBuf),
    infPath: fontFiles.infPath,
    codPath: fontFiles.codPath,
    mtxPath: fontFiles.mtxPath || null,
    cluPath: fontFiles.cluPath || null
  };
}

function saveCod(codPath, entries) {
  const buf = composeCod(entries);
  fs.writeFileSync(codPath, buf);
  return buf.length;
}

module.exports = {
  parseInf,
  composeInf,
  parseCod,
  composeCod,
  discoverFonts,
  loadFont,
  saveCod
};
