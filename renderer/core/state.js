// =====================================================================
// State
// =====================================================================
export const state = {
  loadedFileName: null,
  byteLength: 0,
  lastSearch: '',
  lastSearchCase: false,
  busy: false,
  mode: 'editor'
};

export const tState = {
  settings: { engDir: '', rusDir: '', tsvDir: '', outDir: '' },
  files: [],
  currentRel: null,
  slots: [],
  dirty: false,
  filter: { search: '', mode: 'all' },
  subtab: 'files',
  safeMode: true
};

export const gState = {
  entries: [],            // [{ english, count, fileCount, occurrences? }]
  translations: {},       // english -> ukText (persisted)
  dirty: false,
  filter: { search: '', mode: 'all' },
  busy: false
};

