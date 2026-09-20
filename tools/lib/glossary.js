'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync, writeFileAtomic } = require('../../shared/safe-fs');

const GLOSSARY_FILENAME = '_glossary.json';
// Скільки попередніх версій глосарію тримати поряд (_glossary.json.bak.1..N).
// Глосарій — це місяці роботи перекладача; бекап коштує кілька сотень КБ.
const GLOSSARY_BACKUPS = 5;

function glossaryPath(tsvDir) {
  return path.join(tsvDir, GLOSSARY_FILENAME);
}

function readGlossary(tsvDir) {
  if (!tsvDir) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(glossaryPath(tsvDir), 'utf8'));
    return (raw && raw.entries) || {};
  } catch (_) {
    return {};
  }
}

function saveGlossary(tsvDir, entries) {
  if (!tsvDir) throw new Error('Не задано TSV-теку');
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    entries: entries || {}
  };
  writeFileAtomicSync(
    glossaryPath(tsvDir),
    JSON.stringify(payload, null, 2),
    { encoding: 'utf8', backups: GLOSSARY_BACKUPS }
  );
}

// Асинхронна версія для main (автозбереження кожні 1.5 с після правки — 0.5 МБ + 5 бекапів
// не мають блокувати IPC).
function saveGlossaryAsync(tsvDir, entries) {
  if (!tsvDir) return Promise.reject(new Error('Не задано TSV-теку'));
  const payload = { version: 1, savedAt: new Date().toISOString(), entries: entries || {} };
  return writeFileAtomic(glossaryPath(tsvDir), JSON.stringify(payload, null, 2), { encoding: 'utf8', backups: GLOSSARY_BACKUPS });
}

module.exports = { readGlossary, saveGlossary, saveGlossaryAsync, glossaryPath, GLOSSARY_FILENAME, GLOSSARY_BACKUPS };
