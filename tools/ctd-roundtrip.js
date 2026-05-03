#!/usr/bin/env node
'use strict';

// CTD round-trip test:  parse → compose → compare bytes.
// Якщо output != original → друкуємо diff і список месаджів які різняться.

const fs = require('fs');
const path = require('path');
const { parseCtd, composeCtd } = require('./lib/ctd-format');

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

function compareBuffers(a, b) {
  if (a.length !== b.length) return { ok: false, reason: `length mismatch: ${a.length} vs ${b.length}` };
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return { ok: false, reason: `first diff at offset 0x${i.toString(16)} — orig=0x${a[i].toString(16)} new=0x${b[i].toString(16)}` };
    }
  }
  return { ok: true };
}

function testFile(file) {
  const orig = fs.readFileSync(file);
  let parsed, recomposed;
  try { parsed = parseCtd(orig); }
  catch (e) { return { ok: false, stage: 'parse', error: e.message }; }
  try { recomposed = composeCtd(parsed); }
  catch (e) { return { ok: false, stage: 'compose', error: e.message }; }
  const cmp = compareBuffers(orig, recomposed);
  if (!cmp.ok) {
    // знайти перший проблемний message (тільки якщо є offset у reason)
    let firstBadMsg = -1;
    const offsetMatch = cmp.reason.match(/0x([0-9a-f]+)/);
    if (offsetMatch) {
      const off = parseInt(offsetMatch[1], 16);
      for (let i = 0; i < parsed.messages.length; i++) {
        const m = parsed.messages[i];
        if (m.textOffset <= off && off < m.textOffset + m._origByteLen + 1) {
          firstBadMsg = i;
          break;
        }
      }
    }
    return { ok: false, stage: 'compare', error: cmp.reason, firstBadMsg, messages: parsed.messages.length };
  }
  return { ok: true, messages: parsed.messages.length };
}

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node ctd-roundtrip.js <root-dir>');
    process.exit(1);
  }
  const files = walkCtd(root);
  console.log('testing', files.length, 'CTD files\n');

  let passed = 0, failed = 0;
  const fails = [];
  for (const f of files) {
    const r = testFile(f);
    if (r.ok) {
      passed++;
      console.log(`✓ ${path.basename(f)}  (${r.messages} msgs)`);
    } else {
      failed++;
      fails.push({ file: f, ...r });
      console.log(`✗ ${path.basename(f)}  [${r.stage}] ${r.error}`);
    }
  }
  console.log(`\n${passed}/${files.length} passed`);
  if (failed > 0) {
    console.log('\n=== first 5 failures with details ===');
    for (const f of fails.slice(0, 5)) {
      console.log(`\n${path.basename(f.file)}:`);
      console.log('  stage:', f.stage);
      console.log('  error:', f.error);
      if (f.firstBadMsg != null) console.log('  first bad message idx:', f.firstBadMsg);
    }
    process.exit(1);
  }
}

main();
