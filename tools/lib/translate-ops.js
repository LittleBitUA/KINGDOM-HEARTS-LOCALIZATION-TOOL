'use strict';

// Generic-операції Translate-режиму поверх format-реєстру:
//   extractFile, composeFile, buildGlossaryIndex, composeAll.
// Жодного знання про конкретні формати — усе через tools/lib/formats.
// Використовується з main (IPC) і може — з CLI/тестів (без Electron).

const fs = require('fs');
const fsP = require('fs/promises');
const path = require('path');
const { classifyFile, parseFile } = require('./formats');
const { preserveStructure } = require('../../shared/text-structure');
const tsv = require('../../shared/tsv');
const { writeFileAtomic } = require('../../shared/safe-fs');

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// Пошук перекладу у глосарії за ключем слота. mes-ofs/ev-слоти мають
// trailing `{eol}` у ключі, binl — ні; щоб «Potion» з binl і «Potion{eol}»
// з mes_data ділили один запис, пробуємо обидві форми.
function glossaryLookup(glossary, key) {
  if (!glossary || !key) return '';
  if (hasOwn(glossary, key)) return glossary[key] || '';
  if (key.endsWith('{eol}')) {
    const bare = key.slice(0, -5);
    if (hasOwn(glossary, bare)) {
      const v = glossary[bare] || '';
      return v ? v + '{eol}' : '';
    }
  } else if (hasOwn(glossary, key + '{eol}')) {
    const v = glossary[key + '{eol}'] || '';
    return v.endsWith('{eol}') ? v.slice(0, -5) : v;
  }
  return '';
}

function toUiSlot(s) {
  // Не віддаємо _fullText/key у renderer — UI працює з english/offset.
  return {
    index: s.index,
    offset: s.offset,
    absOffset: s.absOffset,
    byteLen: s.byteLen,
    english: s.english,
    linkedCount: s.linkedCount
  };
}

// extractFile(engPath, env) → { slots, stats, engSize, rusSize, kind }
async function extractFile(engPath, env) {
  const parsed = await parseFile(engPath, env);
  return {
    kind: parsed.kind,
    slots: parsed.slots.map(toUiSlot),
    stats: parsed.stats,
    engSize: parsed.engSize,
    rusSize: parsed.rusSize
  };
}

async function writeOutputs(outPath, result) {
  const written = [];
  for (const o of result.outputs) {
    const p = o.pathFor(outPath);
    await writeFileAtomic(p, o.buf);
    written.push({ path: p, byteLength: o.buf.length });
  }
  return written;
}

// composeFile(engPath, replacements, outPath, env) — один файл з UI-редактора.
// replacements: [{ offset, ukText }]. Пише результат у outPath (+ парні файли).
async function composeFile(engPath, replacements, outPath, env) {
  const parsed = await parseFile(engPath, env);
  const h = parsed.handler;
  const byOffset = new Map(parsed.slots.map(s => [s.offset, s]));
  const ukByOffset = new Map();
  for (const r of replacements || []) {
    if (!r || typeof r.offset !== 'number' || !r.ukText || !r.ukText.length) continue;
    const slot = byOffset.get(r.offset);
    let uk = r.ukText;
    if (slot && h.prepareUk) uk = h.prepareUk(slot, uk);
    ukByOffset.set(r.offset, uk);
  }
  const result = await parsed.compose(ukByOffset);
  const written = await writeOutputs(outPath, result);
  return Object.assign({
    ok: true,
    outPath,
    byteLength: written.reduce((a, w) => a + w.byteLength, 0),
    written,
    applied: result.applied,
    skipped: result.skipped,
    errors: result.errors
  }, result.extra);
}

// Паралельна обробка списку з обмеженням concurrency; onEach після кожного.
async function mapLimited(items, limit, fn, onEach) {
  let next = 0;
  const results = new Array(items.length);
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      if (onEach) onEach(results[i], i);
    }
  }
  const n = Math.max(1, Math.min(limit || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

function classifyRel(engDir, rel) {
  const engPath = path.join(engDir, rel);
  return { engPath, cls: classifyFile(engPath, path.extname(rel).toLowerCase()) };
}

// buildGlossaryIndex(files, env) → { entries, processed, skipped, skippedUnsafe, total }
//   env: { engDir, rusDir?, safeMode, opts?, runWorker?, concurrency?, onProgress?(p) }
//   entries: [{ english, count, fileCount, occurrences?: [...] }] (most-frequent first)
//   env.withOccurrences=false — не збирати occurrences (економія IPC для UI).
async function buildGlossaryIndex(files, env) {
  const engDir = env.engDir;
  const rusDir = env.rusDir || engDir;
  const safeMode = env.safeMode !== false;
  const withOcc = env.withOccurrences !== false;
  const map = new Map();
  let processed = 0, skipped = 0, skippedUnsafe = 0;

  function addSlot(rel, slot) {
    let entry = map.get(slot.key);
    if (!entry) { entry = { count: 0, files: new Set(), occurrences: [] }; map.set(slot.key, entry); }
    entry.count++;
    entry.files.add(rel);
    if (withOcc) entry.occurrences.push({ rel, offset: slot.offset, byteLen: slot.byteLen, index: slot.index });
  }

  async function processOne(rel) {
    const { engPath, cls } = classifyRel(engDir, rel);
    const rusPath = path.join(rusDir, rel);
    if (!fs.existsSync(engPath) || !fs.existsSync(rusPath)) { skipped++; return { rel, status: 'missing' }; }
    if (safeMode && !cls.isTranslatable) { skippedUnsafe++; return { rel, status: 'unsafe' }; }
    try {
      const parsed = await parseFile(engPath, { cls, rusPath, opts: env.opts, runWorker: env.runWorker });
      for (const s of parsed.slots) addSlot(rel, s);
      return { rel, status: 'ok' };
    } catch (e) {
      skipped++;
      return { rel, status: 'error', error: e && e.message };
    }
  }

  await mapLimited(files, env.concurrency || 4, processOne, (r) => {
    processed++;
    if (env.onProgress) env.onProgress({ phase: 'glossary-build', done: processed, total: files.length, currentFile: r.rel, skipped: r.status !== 'ok' ? r.status : undefined });
  });

  const entries = [];
  for (const [english, info] of map) {
    const e = { english, count: info.count, fileCount: info.files.size };
    if (withOcc) e.occurrences = info.occurrences;
    entries.push(e);
  }
  entries.sort((a, b) => b.count - a.count || a.english.localeCompare(b.english));
  return { ok: true, entries, processed, skipped, skippedUnsafe, total: files.length };
}

// composeAll(files, env) → { processed, written, skippedNoTranslations, skippedUnsafe, totalReplacements, errors }
//   env: { engDir, rusDir?, outDir, tsvDir?, glossary, safeMode, opts?, runWorker?, concurrency?, onProgress? }
// Пріоритет перекладу: per-file TSV override (за offset) → глосарій (за key).
async function composeAll(files, env) {
  const engDir = env.engDir;
  const rusDir = env.rusDir || engDir;
  const outDir = env.outDir;
  const tsvDir = env.tsvDir || null;
  const glossary = env.glossary || {};
  const safeMode = env.safeMode !== false;
  let processed = 0, written = 0, skippedNoTranslations = 0, skippedUnsafe = 0, totalReplacements = 0;
  const errors = [];

  async function readOverrides(rel) {
    if (!tsvDir) return null;
    const p = path.join(tsvDir, rel) + '.tsv';
    try { return tsv.overridesByOffset(await fsP.readFile(p, 'utf8')); }
    catch (_) { return null; }
  }

  async function processOne(rel) {
    const { engPath, cls } = classifyRel(engDir, rel);
    const rusPath = path.join(rusDir, rel);
    const outPath = path.join(outDir, rel);
    if (!fs.existsSync(engPath) || !fs.existsSync(rusPath)) return { rel, status: 'missing' };
    if (safeMode && !cls.isTranslatable) { skippedUnsafe++; return { rel, status: 'unsafe' }; }
    try {
      const parsed = await parseFile(engPath, { cls, rusPath, opts: env.opts, runWorker: env.runWorker });
      const h = parsed.handler;
      const overrides = await readOverrides(rel);
      const ukByOffset = new Map();
      for (const s of parsed.slots) {
        let uk = (overrides && overrides.get(s.offset)) || '';
        if (!uk) uk = glossaryLookup(glossary, s.key);
        if (!uk || !uk.trim() || uk === s.english) continue;
        if (h.prepareUk) uk = h.prepareUk(s, uk);
        if (h.preserveWhitespace) uk = preserveStructure(s.english, uk);
        ukByOffset.set(s.offset, uk);
      }
      if (ukByOffset.size === 0) { skippedNoTranslations++; return { rel, status: 'no-translations' }; }
      const result = await parsed.compose(ukByOffset);
      await writeOutputs(outPath, result);
      written++;
      totalReplacements += result.applied || 0;
      if (result.errors && result.errors.length) {
        errors.push({ rel, count: result.errors.length, samples: result.errors.slice(0, 3) });
      }
      return { rel, status: 'ok' };
    } catch (e) {
      errors.push({ rel, error: (e && e.message) || String(e) });
      return { rel, status: 'error' };
    }
  }

  await mapLimited(files, env.concurrency || 4, processOne, (r) => {
    processed++;
    if (env.onProgress) env.onProgress({ phase: 'compose-all', done: processed, total: files.length, currentFile: r.rel, skipped: r.status !== 'ok' ? r.status : undefined });
  });

  return { ok: true, processed, written, skippedNoTranslations, skippedUnsafe, totalReplacements, errors };
}

module.exports = { extractFile, composeFile, buildGlossaryIndex, composeAll, glossaryLookup, mapLimited };
