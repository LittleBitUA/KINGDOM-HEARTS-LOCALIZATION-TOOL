// =====================================================================
// State
// =====================================================================
export const state = {
  mode: 'translate'
};

// Translate-режим: налаштування гри, список файлів (для індексу глосарію та
// збірки), safe-режим (лише підтримувані формати).
export const tState = {
  settings: { engDir: '', rusDir: '', tsvDir: '', outDir: '' },
  files: [],
  safeMode: true
};

export const gState = {
  entries: [],            // [{ english, count, fileCount, occurrences? }]
  translations: Object.create(null),   // english -> ukText (persisted); null-proto: ключ 'constructor' безпечний
  dirty: false,
  filter: { search: '', mode: 'all' },
  busy: false
};

