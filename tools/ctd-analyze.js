#!/usr/bin/env node
'use strict';

// CTD byte analyzer — сканує всі .ctd-файли під заданою текою,
// рознімає header → message-table → текстові блоки і збирає статистику:
//   • кожен унікальний 1-байт у тексті (поза 0x20-0x7E)
//   • кожна 2-байтна послідовність типу 0x81 xx, 0x99 xx, 0xF1/F2/F5/F9 xx
//   • контекст (по 1 семплу з кожного типу: 12 байт до + після)
//
// Запуск:
//   node tools/ctd-analyze.js <root-dir>
// Результат: stdout таблиця + JSON-дамп в .ctd-bytes.json поряд.

const fs = require('fs');
const path = require('path');

const HEADER_SIZE = 0x20;
const MSG_ENTRY_SIZE = 12;

function walkCtd(root) {
  const out = [];
  function rec(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) rec(full);
      else if (e.isFile() && /\.ctd$/i.test(e.name)) out.push(full);
    }
  }
  rec(root);
  return out;
}

function parseHeaderAndMessages(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x44544340) throw new Error('not a CTD: bad magic');
  const layoutCount = buf.readUInt16LE(0x0C);
  const messageCount = buf.readUInt16LE(0x0E);
  const messageOffset = buf.readUInt32LE(0x10);
  const textStart = buf.readUInt32LE(0x18);

  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    const off = messageOffset + i * MSG_ENTRY_SIZE;
    messages.push({
      id: buf.readUInt32LE(off + 0x00),
      textOffset: buf.readUInt32LE(off + 0x04),
      layoutIndex: buf.readUInt16LE(off + 0x08),
      waitFrames: buf.readUInt16LE(off + 0x0A)
    });
  }
  return { layoutCount, messageCount, textStart, messages };
}

function extractMessageBytes(buf, textOffset) {
  // Читаємо до першого 0x00 (термінатор).
  const out = [];
  for (let p = textOffset; p < buf.length; p++) {
    const b = buf[p];
    if (b === 0x00) break;
    out.push(b);
  }
  return out;
}

const SINGLE_BYTES = new Map();   // byte → { count, sample: { file, ctxBefore, ctxAfter } }
const PAIRS = new Map();          // 'XXYY' → { count, sample, leadByte }

function recordSingle(b, file, msgIdx, bytes, pos) {
  if (!SINGLE_BYTES.has(b)) {
    SINGLE_BYTES.set(b, {
      count: 0,
      sample: {
        file: path.basename(file),
        msgIdx,
        ctxBefore: bytesToAscii(bytes.slice(Math.max(0, pos - 16), pos)),
        ctxAfter: bytesToAscii(bytes.slice(pos + 1, pos + 17))
      }
    });
  }
  SINGLE_BYTES.get(b).count++;
}

function recordPair(b1, b2, file, msgIdx, bytes, pos) {
  const key = b1.toString(16).padStart(2, '0') + b2.toString(16).padStart(2, '0');
  if (!PAIRS.has(key)) {
    PAIRS.set(key, {
      count: 0,
      leadByte: b1,
      sample: {
        file: path.basename(file),
        msgIdx,
        ctxBefore: bytesToAscii(bytes.slice(Math.max(0, pos - 16), pos)),
        ctxAfter: bytesToAscii(bytes.slice(pos + 2, pos + 18))
      }
    });
  }
  PAIRS.get(key).count++;
}

function bytesToAscii(bytes) {
  return bytes.map(b => (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b)
    : (b === 0x0A ? '\\n' : '·')).join('');
}

function analyzeFile(file) {
  const buf = fs.readFileSync(file);
  let info;
  try { info = parseHeaderAndMessages(buf); }
  catch (e) { console.error('skip', file, '-', e.message); return; }
  for (let m = 0; m < info.messages.length; m++) {
    const bytes = extractMessageBytes(buf, info.messages[m].textOffset);
    let p = 0;
    while (p < bytes.length) {
      const b = bytes[p];
      // ASCII friendly range — не записуємо, занадто шумно
      if (b >= 0x20 && b < 0x7F) { p++; continue; }
      if (b === 0x0A) { p++; continue; } // newline ок

      // 2-byte sequences за специфікацією
      if (b === 0x81 || b === 0x99 ||
          b === 0xF1 || b === 0xF2 || b === 0xF5 || b === 0xF9) {
        if (p + 1 < bytes.length) {
          recordPair(b, bytes[p + 1], file, m, bytes, p);
          p += 2;
          continue;
        }
      }
      // Інше = 1-байтний tag (control 0x00-0x1F тощо)
      recordSingle(b, file, m, bytes, p);
      p++;
    }
  }
}

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node ctd-analyze.js <root-dir>');
    process.exit(1);
  }
  const files = walkCtd(root);
  console.log('found', files.length, 'CTD files');
  for (const f of files) analyzeFile(f);

  const singleSorted = [...SINGLE_BYTES.entries()].sort((a, b) => b[1].count - a[1].count);
  const pairSorted = [...PAIRS.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log('\n=== Single bytes (non-ASCII, non-LF) ===');
  console.log('byte  count    context');
  for (const [b, info] of singleSorted) {
    console.log(`0x${b.toString(16).padStart(2, '0').toUpperCase()}  ${String(info.count).padStart(7)}  ${info.sample.ctxBefore}❰❱${info.sample.ctxAfter}  (${info.sample.file}#${info.sample.msgIdx})`);
  }

  console.log('\n=== 2-byte sequences ===');
  console.log('seq    count    context');
  // Згрупувати за лідер-байтом
  const groups = new Map();
  for (const [k, v] of pairSorted) {
    const g = groups.get(v.leadByte) || [];
    g.push([k, v]);
    groups.set(v.leadByte, g);
  }
  for (const lead of [0x81, 0x99, 0xF1, 0xF2, 0xF5, 0xF9]) {
    const g = groups.get(lead);
    if (!g) continue;
    console.log(`-- 0x${lead.toString(16).toUpperCase()} prefix (${g.length} unique pairs) --`);
    for (const [k, v] of g) {
      console.log(`${k}   ${String(v.count).padStart(7)}  ${v.sample.ctxBefore}❰❱${v.sample.ctxAfter}  (${v.sample.file}#${v.sample.msgIdx})`);
    }
  }

  // JSON dump поряд з root
  const dumpPath = path.join(path.resolve(root), '..', '_ctd-bytes.json');
  const dump = {
    scanned: files.length,
    singleBytes: singleSorted.map(([b, v]) => ({ byte: b, hex: '0x' + b.toString(16).padStart(2, '0').toUpperCase(), count: v.count, sample: v.sample })),
    pairs: pairSorted.map(([k, v]) => ({ seq: k, leadByte: v.leadByte, count: v.count, sample: v.sample }))
  };
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  console.log('\nDump written to', dumpPath);
}

main();
