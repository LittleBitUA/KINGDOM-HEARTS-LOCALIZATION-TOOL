'use strict';

const fs = require('fs');
const path = require('path');

const GLOSSARY_FILENAME = '_glossary.json';

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
  fs.mkdirSync(tsvDir, { recursive: true });
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    entries: entries || {}
  };
  fs.writeFileSync(glossaryPath(tsvDir), JSON.stringify(payload, null, 2), 'utf8');
}

module.exports = { readGlossary, saveGlossary, glossaryPath, GLOSSARY_FILENAME };
