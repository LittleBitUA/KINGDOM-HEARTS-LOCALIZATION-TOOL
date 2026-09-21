'use strict';

// Реєстр format-handler'ів. Один інтерфейс для всіх ігрових форматів, щоб
// extract / compose / buildGlossary / composeAll у main були generic-циклами,
// а не 4 копіями ланцюжка `if (kind === 'ctd') … else if (kind === 'ev') …`.
//
// Handler:
//   kind: string
//   preserveWhitespace: bool   — застосовувати preserveStructure(en, uk) при compose
//                                (KH1-формати: провідні пробіли = форматування гри)
//   structuralGuard: bool      — при compose відкидати переклад, що губить керівні
//                                токени EN або додає структурні команди EvMsg (KH1)
//   parse(engPath, env) → Promise<Parsed>
//     env: { cls, rusPath?, opts?, runWorker? }
//   prepareUk?(slot, uk) → uk'  — hook перед compose (CTD: відновити 2-і байти)
//
// Parsed:
//   kind, slots: [{ index, offset, byteLen, english, key, absOffset?, linkedCount?, _full? }]
//     offset — стабільний ключ слота в межах файлу (per-file TSV override key)
//     key    — ключ глосарія (канонічна форма english)
//   stats, engSize, rusSize
//   compose(ukByOffset: Map<offset, ukText>) → Promise<ComposeResult>
//
// ComposeResult:
//   outputs: [{ buf, pathFor(outPath) → string }]   — що і куди писати
//   applied, skipped, errors: [{offset, message}], extra: {} (kind-specific)

const path = require('path');
const { classifyFile, clearCache } = require('./classify');
const kh1Oracle = require('../kh1-oracle');

const handlers = {
  binl:   require('./binl'),
  'binl-v361': require('./binl-v361'),
  rawbin: require('./binl'),
  mesofs: require('./mesofs'),
  ev:     require('./ev'),
  ctd:    require('./ctd'),
  ctdl:   require('./ctdl'),
  'ctd-ddd': require('./ddd'),
  kmb:    require('./kmb'),
  'bbs-arc': require('./bbs-arc')
};

function getHandler(kind) {
  return handlers[kind] || null;
}

// parseFile(engPath, env) — класифікує і парсить. env.rusPath/opts/runWorker
// прокидаються у handler. Кидає, якщо формат не підтримується.
async function parseFile(engPath, env) {
  const e = env || {};
  const cls = e.cls || classifyFile(engPath, path.extname(engPath).toLowerCase());
  const h = getHandler(cls.kind);
  if (!h) {
    const err = new Error('Непідтримуваний формат: ' + cls.kind + ' (' + path.basename(engPath) + ')');
    err.kind = cls.kind;
    throw err;
  }
  // Вбудований еталон неперекладних рядків KH1 (замість теки RUS); handler'и,
  // яким він не потрібен, просто ігнорують opts.preservedSegs.
  const preservedSegs = e.preservedSegs || kh1Oracle.preservedFor(engPath);
  const opts = preservedSegs.length ? Object.assign({}, e.opts || {}, { preservedSegs }) : e.opts;
  const parsed = await h.parse(engPath, Object.assign({}, e, { cls, opts }));
  parsed.kind = cls.kind;
  parsed.handler = h;
  return parsed;
}

module.exports = { classifyFile, clearCache, getHandler, parseFile, handlers };
