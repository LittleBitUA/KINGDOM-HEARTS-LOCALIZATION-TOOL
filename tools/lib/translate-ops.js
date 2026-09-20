'use strict';

// Generic-операції Translate-режиму поверх format-реєстру:
//   extractFile, composeFile, buildGlossaryIndex, composeAll.
// Жодного знання про конкретні формати — усе через tools/lib/formats.
// Використовується з main (IPC) і може — з CLI/тестів (без Electron).

const fs = require('fs');
const fsP = require('fs/promises');
const path = require('path');
const { classifyFile, parseFile } = require('./formats');
const { legacyCommandKey } = require('../../shared/codec');
const { preserveStructure, validateTokens, upgradeLegacyUk, lookupEolVariant, kh1OutRel, kh1SplitRel, patchOutRel } = require('../../shared/text-structure');

// Структурний guard (ідея з OpenKh PR #1275 ValidateBody): переклад не має
// губити керівні токени оригіналу і не може додавати «структурні» команди
// EvMsg (0x05/0x06 — кінець тіла, 0x0A/0x0B — початок запису), інакше гра
// зламає розбір повідомлення. Повертає текст помилки або null.
const STRUCTURAL_RAW = /^\{0x(05|06|0A|0B)(,|\})/i;
// Гліфи-токени ({-}, {mX}, {III}, {Potion}…) і кольори/змінні перекладач може
// прибирати — це не ламає розбір; guard стосується лише сирих `{0x..}`-команд.
const RAW_TOKEN = /^\{0x/i;
function structuralIssue(en, uk) {
  const v = validateTokens(en, uk);
  const missing = v.missing.filter(x => RAW_TOKEN.test(x.token));
  if (missing.length) {
    return 'втрачено токени: ' + missing.map(x => x.expected - x.got > 1 ? x.token + '×' + (x.expected - x.got) : x.token).join(', ');
  }
  const bad = v.extra.filter(x => STRUCTURAL_RAW.test(x.token)).map(x => x.token);
  if (bad.length) return 'додано структурні команди: ' + bad.join(', ');
  return null;
}
const tsv = require('../../shared/tsv');
const { writeFileAtomic } = require('../../shared/safe-fs');

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// Пошук перекладу у глосарії за ключем слота. mes-ofs/ev-слоти мають
// trailing `{eol}` у ключі, binl — ні; щоб «Potion» з binl і «Potion{eol}»
// з mes_data ділили один запис, пробуємо обидві форми.
function glossaryLookup(glossary, key) {
  if (!glossary || !key) return '';
  if (hasOwn(glossary, key)) return glossary[key] || '';
  const viaEol = lookupEolVariant(glossary, key);
  if (viaEol) return viaEol;
  // Старі ключі з 2-байтовими 05/06/07-токенами (до u16-параметрів): значення
  // теж у старій формі — переписуємо токени, інакше structural guard відкине.
  const legacy = legacyCommandKey(key);
  if (legacy) {
    const v = glossaryLookup(glossary, legacy);
    return v ? upgradeLegacyUk(key, legacy, v) : '';
  }
  return '';
}

// Reference-файл (MYFILES/RUS) для rel. Стара RUS-тека користувача плоска
// (лише kh1_first без префікса), нова розкладка — з `kh1_first/`: пробуємо
// обидва варіанти. Повертає шлях або undefined.
function rusPathFor(rusDir, rel) {
  if (!rusDir) return undefined;
  const cands = [path.join(rusDir, rel)];
  const { archive, rest } = kh1SplitRel(rel);
  if (archive === 'kh1_first') cands.push(path.join(rusDir, rest), path.join(rusDir, 'kh1_first', rest));
  for (const c of cands) if (fs.existsSync(c)) return c;
  return undefined;
}

function toUiSlot(s) {
  // Не віддаємо _fullText/key у renderer — UI працює з english/offset.
  // legacyKey — стара форма (2-байтові 05/06/07-токени), щоб UI переписав
  // значення зі старих TSV у нову форму.
  const legacy = legacyCommandKey(s.english);
  return {
    index: s.index,
    offset: s.offset,
    absOffset: s.absOffset,
    byteLen: s.byteLen,
    english: s.english,
    linkedCount: s.linkedCount,
    legacyKey: legacy || undefined
  };
}

// Значення зі старих per-file TSV мають 2-байтову форму токенів 05/06/07 —
// переписуємо у нову, інакше structural guard їх відкине.
function upgradeUkForSlot(slot, uk) {
  if (!uk) return uk;
  const legacy = legacyCommandKey(slot.english);
  return legacy ? upgradeLegacyUk(slot.english, legacy, uk) : uk;
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

// writeOutputs(outPath, result, resolveSrc?) — resolveSrc(srcAbs) → шлях у DONE для
// парного файла, що у джерелі лежить в іншій теці (SASAMSG.BIN у gumi/, зсуви — у exchange/).
async function writeOutputs(outPath, result, resolveSrc) {
  const written = [];
  for (const o of result.outputs) {
    const p = (o.srcPath && resolveSrc && resolveSrc(o.srcPath)) || o.pathFor(outPath);
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
  const guardErrors = [];
  for (const r of replacements || []) {
    if (!r || typeof r.offset !== 'number' || !r.ukText || !r.ukText.length) continue;
    const slot = byOffset.get(r.offset);
    let uk = slot ? upgradeUkForSlot(slot, r.ukText) : r.ukText;
    if (slot && h.prepareUk) uk = h.prepareUk(slot, uk);
    if (slot && h.structuralGuard && (!env || env.strictTokens !== false)) {
      const issue = structuralIssue(slot.english, uk);
      if (issue) { guardErrors.push({ offset: r.offset, message: issue + ' — лишено оригінал' }); continue; }
    }
    ukByOffset.set(r.offset, uk);
  }
  const result = await parsed.compose(ukByOffset);
  if (guardErrors.length) result.errors = guardErrors.concat(result.errors || []);
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

// Відповідь воркера формату — { id, ok, result }; в процесі — сам result.
function unwrap(msg) { return msg && msg.result !== undefined ? msg.result : msg; }

// Серіалізована частина env для воркера формату (без функцій).
function envForWorker(env) {
  return {
    engDir: env.engDir, rusDir: env.rusDir || null, outDir: env.outDir || null, tsvDir: env.tsvDir || null,
    safeMode: env.safeMode !== false, opts: env.opts || {}, outLayout: env.outLayout || null, gameId: env.gameId || null,
    strictTokens: env.strictTokens !== false, useTsvOverrides: !!env.useTsvOverrides
  };
}

// indexFileSlots(rel, env) → { status: 'ok'|'missing'|'unsafe'|'error', slots?: [{index, offset, byteLen, key}], error? }
// Один файл для індексу глосарію; виконується у воркері формату або в процесі.
async function indexFileSlots(rel, env) {
  const { engPath, cls } = classifyRel(env.engDir, rel);
  const rusPath = rusPathFor(env.rusDir || null, rel);
  if (!fs.existsSync(engPath)) return { status: 'missing' };
  if (env.safeMode !== false && !cls.isTranslatable) return { status: 'unsafe' };
  try {
    const parsed = await parseFile(engPath, { cls, rusPath, opts: env.opts, runWorker: env.runWorker });
    return { status: 'ok', slots: parsed.slots.map(s => ({ index: s.index, offset: s.offset, byteLen: s.byteLen, key: s.key })) };
  } catch (e) {
    return { status: 'error', error: (e && e.message) || String(e) };
  }
}

// buildGlossaryIndex(files, env) → { entries, processed, skipped, skippedUnsafe, total }
//   env: { engDir, rusDir?, safeMode, opts?, runWorker?, concurrency?, onProgress?(p) }
//   entries: [{ english, count, fileCount, file, index, offset, legacyKey?, occurrences?: [...] }] (у порядку гри: файл → позиція)
//   legacyKey — ключ у старій формі (2-байтові 05/06/07-токени), якщо відрізняється
//   env.withOccurrences=false — не збирати occurrences (економія IPC для UI).
async function buildGlossaryIndex(files, env) {
  const engDir = env.engDir;
  const rusDir = env.rusDir || null;   // без MYFILES — лише вбудований еталон (ENG як власний reference = усе «неперекладне»)
  const safeMode = env.safeMode !== false;
  const withOcc = env.withOccurrences !== false;
  const map = new Map();
  let processed = 0, skipped = 0, skippedUnsafe = 0;

  const fileNo = new Map(files.map((rel, i) => [rel, i]));
  function addSlot(rel, slot) {
    // Порожні/пробільні ключі (порожні повідомлення .ctd) — не переклад, у глосарій не потрапляють.
    if (!slot.key || !String(slot.key).trim()) return;
    let entry = map.get(slot.key);
    // first — найраніше входження у порядку гри (файл за списком, далі позиція у файлі);
    // файли обробляються паралельно, тому порівнюємо, а не беремо перше-побачене.
    const here = { rel, index: slot.index, offset: slot.offset, fileNo: fileNo.get(rel) || 0 };
    if (!entry) { entry = { count: 0, files: new Set(), occurrences: [], first: here }; map.set(slot.key, entry); }
    else if (here.fileNo < entry.first.fileNo || (here.fileNo === entry.first.fileNo && here.offset < entry.first.offset)) entry.first = here;
    entry.count++;
    entry.files.add(rel);
    if (withOcc) entry.occurrences.push({ rel, offset: slot.offset, byteLen: slot.byteLen, index: slot.index });
  }

  // env.runFormat(payload) — виконати у воркері формату (main); інакше — в процесі.
  const wenv = envForWorker({ engDir, rusDir, safeMode, opts: env.opts });
  async function processOne(rel) {
    const r = env.runFormat ? unwrap(await env.runFormat({ op: 'index', rel, env: wenv })) : await indexFileSlots(rel, Object.assign({}, wenv, { runWorker: env.runWorker }));
    if (r.status === 'ok') for (const s of r.slots) addSlot(rel, s);
    else if (r.status === 'unsafe') skippedUnsafe++;
    else skipped++;
    return { rel, status: r.status, error: r.error };
  }

  await mapLimited(files, env.concurrency || 4, processOne, (r) => {
    processed++;
    if (env.onProgress) env.onProgress({ phase: 'glossary-build', done: processed, total: files.length, currentFile: r.rel, skipped: r.status !== 'ok' ? r.status : undefined });
  });

  const entries = [];
  for (const [english, info] of map) {
    // file/index — перше входження (для колонки «Файл» та inspector'а; occurrences повністю — лише за запитом)
    const e = { english, count: info.count, fileCount: info.files.size, file: info.first.rel, index: info.first.index, offset: info.first.offset };
    const legacy = legacyCommandKey(english);
    if (legacy) e.legacyKey = legacy;   // renderer переносить переклад зі старого ключа
    if (withOcc) e.occurrences = info.occurrences;
    entries.push(e);
  }
  // Порядок «як у грі»: за файлом (порядок списку) і позицією першого входження —
  // репліки однієї сцени йдуть поспіль, дублікати згорнуті у перше входження (count).
  const firstOf = (e) => map.get(e.english).first;
  entries.sort((a, b) => firstOf(a).fileNo - firstOf(b).fileNo || firstOf(a).offset - firstOf(b).offset || a.english.localeCompare(b.english));
  return { ok: true, entries, processed, skipped, skippedUnsafe, total: files.length };
}

// composeOneFile(rel, env) → { status: 'ok'|'missing'|'unsafe'|'no-translations'|'error', applied, errors: [{offset,message}], error? }
//   env: { engDir, rusDir?, outDir, tsvDir?, glossary, safeMode, opts?, runWorker?, outLayout?, gameId?, strictTokens?, layouts? }
// Джерело перекладу — глосарій (за key). Per-file TSV (PROGRESS) — лише за
// env.useTsvOverrides (старий режим; UI його більше не вмикає — глосарій єдине джерело).
// Пише вихідні файли сам (виконується у воркері формату або в процесі).
async function composeOneFile(rel, env) {
  const engDir = env.engDir;
  const outDir = env.outDir;
  const glossary = env.glossary || {};
  const { engPath, cls } = classifyRel(engDir, rel);
  const rusPath = rusPathFor(env.rusDir || null, rel);
  // env.outLayout === 'patch' — тека, готова для KHPCPatchManager: <archive>/(original|remastered)/…
  // (env.gameId визначає правило); 'kh1-hedout' — старий синонім для KH1.
  const layoutRel = (r) => env.outLayout === 'patch' ? patchOutRel(env.gameId, r) : (env.outLayout === 'kh1-hedout' ? kh1OutRel(r) : r);
  const outPath = path.join(outDir, layoutRel(rel));
  // парний файл з іншої теки джерела → та сама розкладка від його власного rel
  const resolveSrc = (srcAbs) => {
    const r = path.relative(engDir, srcAbs).split(path.sep).join('/');
    return r.startsWith('..') ? null : path.join(outDir, layoutRel(r));
  };
  if (!fs.existsSync(engPath)) return { status: 'missing', applied: 0, errors: [] };
  if (env.safeMode !== false && !cls.isTranslatable) return { status: 'unsafe', applied: 0, errors: [] };
  try {
    let overrides = null;
    if (env.tsvDir && env.useTsvOverrides) {
      try { overrides = tsv.overridesByOffset(await fsP.readFile(path.join(env.tsvDir, rel) + '.tsv', 'utf8')); } catch (_) { overrides = null; }
    }
    // RUS-оракул потрібен лише binl/rawbin; для інших форматів (і коли файла
    // нема) parse працює без нього.
    const parsed = await parseFile(engPath, { cls, rusPath, opts: env.opts, runWorker: env.runWorker });
    const h = parsed.handler;
    const ukByOffset = new Map();
    const guardErrors = [];
    for (const s of parsed.slots) {
      let uk = upgradeUkForSlot(s, (overrides && overrides.get(s.offset)) || '');
      if (!uk) uk = glossaryLookup(glossary, s.key);
      if (!uk || !uk.trim() || uk === s.english) continue;
      if (h.prepareUk) uk = h.prepareUk(s, uk);
      if (h.preserveWhitespace) uk = preserveStructure(s.english, uk);
      if (h.structuralGuard && env.strictTokens !== false) {
        const issue = structuralIssue(s.english, uk);
        if (issue) { guardErrors.push({ offset: s.offset, message: issue + ' — лишено оригінал' }); continue; }
      }
      ukByOffset.set(s.offset, uk);
    }
    // Хмаринки Re:CoM (PROGRESS/_bubbles.json): макети правляться навіть там,
    // де перекладів нема.
    const layouts = (env.layouts && env.layouts[rel]) || null;
    const hasWork = ukByOffset.size > 0 || !!layouts;
    if (!hasWork && guardErrors.length === 0) return { status: 'no-translations', applied: 0, errors: [] };
    const result = hasWork ? await parsed.compose(ukByOffset, layouts ? { layouts } : undefined) : { outputs: [], applied: 0, skipped: 0, errors: [] };
    const errors = guardErrors.concat(result.errors || []);
    if (hasWork) await writeOutputs(outPath, result, resolveSrc);
    return { status: hasWork ? 'ok' : 'no-translations', applied: result.applied || 0, errors };
  } catch (e) {
    return { status: 'error', applied: 0, errors: [], error: (e && e.message) || String(e) };
  }
}

// composeAll(files, env) → { processed, written, skippedNoTranslations, skippedUnsafe, totalReplacements, errors }
//   env: { engDir, rusDir?, outDir, tsvDir?, glossary, safeMode, opts?, runWorker?, runFormat?, concurrency?, onProgress? }
//   env.runFormat(payload) — воркер формату (main); глосарій туди має бути надісланий
//   заздалегідь (op: 'setGlossary'), у payload він не входить.
async function composeAll(files, env) {
  let processed = 0, written = 0, skippedNoTranslations = 0, skippedUnsafe = 0, totalReplacements = 0;
  const errors = [];
  const wenv = envForWorker(env);

  async function processOne(rel) {
    const r = env.runFormat
      ? unwrap(await env.runFormat({ op: 'compose', rel, env: wenv }))
      : await composeOneFile(rel, Object.assign({}, wenv, { glossary: env.glossary || {}, runWorker: env.runWorker, layouts: env.layouts || null }));
    if (r.status === 'ok') written++;
    else if (r.status === 'unsafe') skippedUnsafe++;
    else if (r.status === 'no-translations') skippedNoTranslations++;
    else if (r.status === 'error') errors.push({ rel, error: r.error });
    totalReplacements += r.applied || 0;
    if (r.errors && r.errors.length) errors.push({ rel, count: r.errors.length, samples: r.errors.slice(0, 3) });
    return { rel, status: r.status };
  }

  await mapLimited(files, env.concurrency || 4, processOne, (r) => {
    processed++;
    if (env.onProgress) env.onProgress({ phase: 'compose-all', done: processed, total: files.length, currentFile: r.rel, skipped: r.status !== 'ok' ? r.status : undefined });
  });

  return { ok: true, processed, written, skippedNoTranslations, skippedUnsafe, totalReplacements, errors };
}

module.exports = {
  rusPathFor, extractFile, composeFile, indexFileSlots, composeOneFile, buildGlossaryIndex, composeAll, glossaryLookup, mapLimited, structuralIssue };

// =====================================================================
// text_all.txt — формат обміну Python-наборів (### шлях / #N / текст).
// =====================================================================
const textall = require('./textall');

// exportTextAll(files, env) → { content, files, lines, skipped }
//   env: { engDir, rusDir?, tsvDir?, glossary?, safeMode, runWorker?, all?, onProgress? }
//   Текст рядка = per-file TSV override → глосарій → англійський оригінал.
//   Без env.all пропускаються неперекладні (порожні/лише вставки), як у .py.
async function exportTextAll(files, env) {
  const engDir = env.engDir;
  const rusDir = env.rusDir || null;   // без MYFILES — лише вбудований еталон (ENG як власний reference = усе «неперекладне»)
  const glossary = env.glossary || {};
  const sections = [];
  let lines = 0, skipped = 0, done = 0;
  for (const rel of files) {
    const { engPath, cls } = classifyRel(engDir, rel);
    done++;
    if (env.onProgress) env.onProgress({ phase: 'textall-export', done, total: files.length, currentFile: rel });
    if (!fs.existsSync(engPath)) continue;
    if (env.safeMode !== false && !cls.isTranslatable) continue;
    let parsed;
    try { parsed = await parseFile(engPath, { cls, rusPath: rusPathFor(rusDir, rel), runWorker: env.runWorker }); }
    catch (_) { continue; }
    let overrides = null;
    if (env.tsvDir) {
      try { overrides = tsv.overridesByOffset(await fsP.readFile(path.join(env.tsvDir, rel) + '.tsv', 'utf8')); } catch (_) {}
    }
    const items = [];
    for (const s of parsed.slots) {
      if (!env.all && !textall.translatable(s.english)) { skipped++; continue; }
      let uk = (overrides && overrides.get(s.offset)) || glossaryLookup(glossary, s.key) || '';
      if (!uk.trim()) uk = s.english;
      items.push({ id: s.index, text: uk });
      lines++;
    }
    if (items.length) sections.push({ file: rel.split('/').join('\\'), items });
  }
  return { ok: true, content: textall.build(sections), files: sections.length, lines, skipped };
}

// importTextAll(content, files, env) → статистика.
//   env: { engDir, rusDir?, tsvDir, glossary?, safeMode, runWorker?, toGlossary?, onProgress? }
//   Для кожної секції знаходимо файл застосунку (суфіксний збіг шляху), парсимо,
//   #N → slot.index (DDD: @0xID → messageId). Переклад ≠ EN пишеться у per-file
//   TSV (offset слота) і, якщо toGlossary, у glossaryOut[key].
async function importTextAll(content, files, env) {
  const engDir = env.engDir;
  const rusDir = env.rusDir || null;   // без MYFILES — лише вбудований еталон (ENG як власний reference = усе «неперекладне»)
  const sections = textall.parse(content);
  const glossaryOut = Object.create(null);
  const stats = { ok: true, sections: sections.length, matchedFiles: 0, unmatchedFiles: [], applied: 0, sameAsEn: 0, missingIds: 0, errors: [], tsvWritten: 0 };
  let done = 0;
  for (const sec of sections) {
    done++;
    if (env.onProgress) env.onProgress({ phase: 'textall-import', done, total: sections.length, currentFile: sec.file });
    const rel = textall.matchRel(sec.file, files);
    if (!rel) { stats.unmatchedFiles.push(sec.file); continue; }
    const { engPath, cls } = classifyRel(engDir, rel);
    if (!fs.existsSync(engPath) || (env.safeMode !== false && !cls.isTranslatable)) { stats.unmatchedFiles.push(sec.file); continue; }
    let parsed;
    try { parsed = await parseFile(engPath, { cls, rusPath: rusPathFor(rusDir, rel), runWorker: env.runWorker }); }
    catch (e) { stats.errors.push({ file: sec.file, error: e.message }); continue; }
    stats.matchedFiles++;
    const byIndex = new Map(parsed.slots.map(s => [s.index, s]));
    const byMsgId = new Map(parsed.slots.filter(s => s.messageId != null).map(s => ['0x' + (s.messageId >>> 0).toString(16).toUpperCase().padStart(8, '0'), s]));
    let overrides = null;
    const tsvPath = env.tsvDir ? path.join(env.tsvDir, rel) + '.tsv' : null;
    if (tsvPath) { try { overrides = tsv.overridesByOffset(await fsP.readFile(tsvPath, 'utf8')); } catch (_) {} }
    const merged = new Map(overrides || []);
    let changed = false;
    for (const it of sec.items) {
      const slot = typeof it.id === 'number' ? byIndex.get(it.id) : byMsgId.get(it.id);
      if (!slot) { stats.missingIds++; continue; }
      const uk = String(it.text || '');
      if (!uk.trim() || uk === slot.english) { stats.sameAsEn++; continue; }
      if (merged.get(slot.offset) !== uk) { merged.set(slot.offset, uk); changed = true; }
      if (env.toGlossary !== false) glossaryOut[slot.key] = uk;
      stats.applied++;
    }
    if (changed && tsvPath) {
      const content2 = tsv.build(parsed.slots, { ukOf: s => merged.get(s.offset) || '' });
      await writeFileAtomic(tsvPath, content2, { encoding: 'utf8' });
      stats.tsvWritten++;
    }
  }
  stats.glossary = glossaryOut;
  return stats;
}

// importTextAllPair(enContent, ukContent) → { pairs, glossary } — два text_all
// з однаковими маркерами (Re:CoM text_uniq.txt + text_ua.txt) → EN→UK.
function importTextAllPair(enContent, ukContent) {
  const pairs = textall.pair(textall.parse(enContent), textall.parse(ukContent));
  const glossary = Object.create(null);
  let same = 0;
  for (const p of pairs) {
    if (!p.uk.trim() || p.uk === p.en) { same++; continue; }
    glossary[p.en] = p.uk;
  }
  return { ok: true, pairs: pairs.length, translated: Object.keys(glossary).length, sameAsEn: same, glossary };
}

module.exports.exportTextAll = exportTextAll;
module.exports.importTextAll = importTextAll;
module.exports.importTextAllPair = importTextAllPair;
