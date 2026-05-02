'use strict';

// =====================================================================
// DOM refs
// =====================================================================
const viewEditor = document.getElementById('view-editor');
const viewTranslate = document.getElementById('view-translate');
const viewKerning = document.getElementById('view-kerning');
const modeEditorBtn = document.getElementById('mode-editor');
const modeTranslateBtn = document.getElementById('mode-translate');
const modeKerningBtn = document.getElementById('mode-kerning');

// editor view
const editor = document.getElementById('editor');
const btnOpen = document.getElementById('btn-open');
const btnSave = document.getElementById('btn-save');
const btnFind = document.getElementById('btn-find');
const fileStatus = document.getElementById('file-status-text');
const cursorInfo = document.getElementById('cursor-info');
const byteInfo = document.getElementById('byte-info');

// find dialog
const findOverlay = document.getElementById('find-overlay');
const findInput = document.getElementById('find-input');
const findCase = document.getElementById('find-case');
const findNextBtn = document.getElementById('find-next');
const findCancelBtn = document.getElementById('find-cancel');
const findMessage = document.getElementById('find-message');

// about dialog
const aboutOverlay = document.getElementById('about-overlay');
const aboutBody = document.getElementById('about-body');
const aboutCloseBtn = document.getElementById('about-close');

// translate view — files subtab
const tFileSel = document.getElementById('t-file');
const tReload = document.getElementById('t-reload');
const tProgress = document.getElementById('t-progress');
const tSearchInput = document.getElementById('t-search');
const tFilterMode = document.getElementById('t-filter-mode');
const tSaveTsv = document.getElementById('t-save-tsv');
const tCompose = document.getElementById('t-compose');
const tExportTxt = document.getElementById('t-export-txt');
const tImportTxt = document.getElementById('t-import-txt');
const tAutoWrapBtn = document.getElementById('t-autowrap');
const tMaxWidthInput = document.getElementById('t-maxwidth');
const tSettingsBtn = document.getElementById('t-settings-btn');
const tRows = document.getElementById('t-rows');
const tStatus = document.getElementById('t-status');

// translate view — subtabs
const tabFiles = document.getElementById('tab-files');
const tabGlossary = document.getElementById('tab-glossary');
const subviewFiles = document.getElementById('t-subview-files');
const subviewGlossary = document.getElementById('t-subview-glossary');
const tSafeMode = document.getElementById('t-safe-mode');

// glossary subtab
const gBuild = document.getElementById('g-build');
const gImport = document.getElementById('g-import');
const gSearch = document.getElementById('g-search');
const gFilterMode = document.getElementById('g-filter-mode');
const gStat = document.getElementById('g-stat');
const gSave = document.getElementById('g-save');
const gComposeAll = document.getElementById('g-compose-all');
const gRows = document.getElementById('g-rows');

// replace modal (Ctrl+H)
const repOverlay = document.getElementById('replace-overlay');
const repFind = document.getElementById('rep-find');
const repReplace = document.getElementById('rep-replace');
const repCase = document.getElementById('rep-case');
const repStat = document.getElementById('rep-stat');
const repApply = document.getElementById('rep-apply');
const repCancel = document.getElementById('rep-cancel');

// import modal
const importOverlay = document.getElementById('import-overlay');
const importSummary = document.getElementById('import-summary');
const importConflicts = document.getElementById('import-conflicts');
const importApplyBtn = document.getElementById('import-apply');
const importOverwriteBtn = document.getElementById('import-overwrite');
const importCancelBtn = document.getElementById('import-cancel');

// in-flight import preview
let importPending = null;  // { matched: [{en, uk}], conflicts: [{en, oldUk, newUk}], unmatched: [{en, uk}] }

// settings modal
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const setEngDir = document.getElementById('set-eng-dir');
const setRusDir = document.getElementById('set-rus-dir');
const setTsvDir = document.getElementById('set-tsv-dir');
const setOutDir = document.getElementById('set-out-dir');

const toasts = document.getElementById('toasts');

// =====================================================================
// State
// =====================================================================
const state = {
  loadedFileName: null,
  byteLength: 0,
  lastSearch: '',
  lastSearchCase: false,
  busy: false,
  mode: 'editor'
};

const tState = {
  settings: { engDir: '', rusDir: '', tsvDir: '', outDir: '' },
  files: [],
  currentRel: null,
  slots: [],
  dirty: false,
  filter: { search: '', mode: 'all' },
  subtab: 'files',
  safeMode: true
};

const gState = {
  entries: [],            // [{ english, count, fileCount, occurrences? }]
  translations: {},       // english -> ukText (persisted)
  dirty: false,
  filter: { search: '', mode: 'all' },
  busy: false
};

// =====================================================================
// Toasts
// =====================================================================
function toast(message, kind, timeout) {
  if (!kind) kind = 'info';
  if (typeof timeout !== 'number') timeout = 3500;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  toasts.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('fade-out');
    window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
  }, timeout);
}

// =====================================================================
// Editor mode (existing)
// =====================================================================
function refreshStatus() {
  if (state.loadedFileName) {
    fileStatus.textContent = 'Завантажено: ' + state.loadedFileName;
    byteInfo.textContent = state.byteLength.toLocaleString('uk-UA') + ' байт';
  } else {
    fileStatus.textContent = 'Файл не завантажено';
    byteInfo.textContent = '';
  }
}

function updateCursor() {
  const pos = editor.selectionStart;
  const before = editor.value.substring(0, pos);
  let lineNum = 1;
  let lastNl = -1;
  for (let i = 0; i < before.length; i++) {
    if (before.charCodeAt(i) === 10) { lineNum++; lastNl = i; }
  }
  const colNum = pos - (lastNl + 1) + 1;
  cursorInfo.textContent = 'Рядок ' + lineNum + ', Стовпець ' + colNum;
}

editor.addEventListener('keyup', updateCursor);
editor.addEventListener('click', updateCursor);
editor.addEventListener('input', updateCursor);
editor.addEventListener('select', updateCursor);

async function doOpen() {
  if (state.busy) return;
  state.busy = true;
  btnOpen.disabled = true;
  try {
    const result = await window.kh1.openFile();
    if (result.canceled) return;
    if (result.error) {
      toast(window.i18n.t('toastImportError', {msg: result.error}), 'error', 6000);
      return;
    }
    editor.value = result.text;
    state.loadedFileName = result.fileName;
    state.byteLength = result.byteLength;
    btnSave.disabled = false;
    btnFind.disabled = false;
    refreshStatus();
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    updateCursor();
    toast(window.i18n.t('toastImported', {file: result.fileName}), 'success');
  } catch (e) {
    toast(window.i18n.t('toastImportError', {msg: (e && e.message) || String(e)}), 'error', 6000);
  } finally {
    btnOpen.disabled = false;
    state.busy = false;
  }
}

async function doSave() {
  if (state.busy) return;
  if (!state.loadedFileName) {
    toast(window.i18n.t('toastImportFirst'), 'error');
    return;
  }
  state.busy = true;
  btnSave.disabled = true;
  try {
    const result = await window.kh1.saveFile(editor.value, state.loadedFileName);
    if (result.canceled) return;
    if (result.error) {
      toast(window.i18n.t('toastExportError', {msg: result.error}), 'error', 6000);
      return;
    }
    state.byteLength = result.byteLength;
    state.loadedFileName = result.fileName;
    refreshStatus();
    toast(window.i18n.t('toastExported', {file: result.fileName}), 'success');
  } catch (e) {
    toast(window.i18n.t('toastExportError', {msg: (e && e.message) || String(e)}), 'error', 6000);
  } finally {
    btnSave.disabled = !state.loadedFileName;
    state.busy = false;
  }
}

// === Find ===
function showFind() {
  findInput.value = state.lastSearch;
  findCase.checked = state.lastSearchCase;
  findMessage.textContent = '';
  findMessage.className = 'find-message';
  findOverlay.classList.remove('hidden');
  findOverlay.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => { findInput.focus(); findInput.select(); }, 0);
}

function hideFind() {
  findOverlay.classList.add('hidden');
  findOverlay.setAttribute('aria-hidden', 'true');
  editor.focus();
}

function performFind(wrap) {
  if (typeof wrap !== 'boolean') wrap = true;
  const query = findInput.value;
  if (!query) {
    findMessage.textContent = 'Введіть текст для пошуку.';
    findMessage.className = 'find-message error';
    return;
  }
  state.lastSearch = query;
  state.lastSearchCase = findCase.checked;

  const haystack = state.lastSearchCase ? editor.value : editor.value.toLowerCase();
  const needle = state.lastSearchCase ? query : query.toLowerCase();
  const startFrom = editor.selectionStart + editor.selectionLength;

  let idx = haystack.indexOf(needle, startFrom);
  if (idx < 0 && wrap) idx = haystack.indexOf(needle, 0);

  if (idx < 0) {
    findMessage.textContent = 'Текст не знайдено.';
    findMessage.className = 'find-message error';
    return;
  }
  editor.focus();
  editor.setSelectionRange(idx, idx + query.length);
  scrollEditorTo(idx);
  findMessage.textContent = 'Знайдено.';
  findMessage.className = 'find-message success';
  updateCursor();
}

function scrollEditorTo(index) {
  const before = editor.value.substring(0, index);
  let lineCount = 1;
  for (let i = 0; i < before.length; i++) {
    if (before.charCodeAt(i) === 10) lineCount++;
  }
  const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight) || 21;
  const target = (lineCount - 1) * lineHeight;
  const visible = editor.clientHeight;
  if (target < editor.scrollTop || target > editor.scrollTop + visible - lineHeight * 2) {
    editor.scrollTop = Math.max(0, target - visible / 2);
  }
}

function findNextFromShortcut() {
  if (!state.lastSearch) { showFind(); return; }
  performFind(true);
}

// === About ===
async function showAbout() {
  let info;
  try { info = await window.kh1.about(); }
  catch (_) { toast(window.i18n.t('toastAboutLoadFail'), 'error'); return; }

  while (aboutBody.firstChild) aboutBody.removeChild(aboutBody.firstChild);

  const p1 = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = info.name;
  p1.appendChild(strong);
  aboutBody.appendChild(p1);

  const p2 = document.createElement('p');
  const lines = ['Версія: ' + info.version, 'Electron: ' + info.electron, 'Chromium: ' + info.chrome, 'Node.js: ' + info.node];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) p2.appendChild(document.createElement('br'));
    p2.appendChild(document.createTextNode(lines[i]));
  }
  aboutBody.appendChild(p2);

  const p3 = document.createElement('p');
  p3.className = 'about-desc';
  p3.textContent =
    'Двохрежимний редактор: 1) ручне редагування .bin/.binl/.ard з українським оверлеєм; ' +
    '2) Режим перекладу — diff проти російської локалізації, інлайн-переклад, збирання нових файлів.';
  aboutBody.appendChild(p3);

  aboutOverlay.classList.remove('hidden');
  aboutOverlay.setAttribute('aria-hidden', 'false');
}

function hideAbout() {
  aboutOverlay.classList.add('hidden');
  aboutOverlay.setAttribute('aria-hidden', 'true');
}

// =====================================================================
// Mode switching
// =====================================================================
function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  viewEditor.classList.toggle('hidden', mode !== 'editor');
  viewTranslate.classList.toggle('hidden', mode !== 'translate');
  viewKerning.classList.toggle('hidden', mode !== 'kerning');
  modeEditorBtn.classList.toggle('active', mode === 'editor');
  modeTranslateBtn.classList.toggle('active', mode === 'translate');
  modeKerningBtn.classList.toggle('active', mode === 'kerning');
  if (mode === 'translate') initTranslateMode();
}

// =====================================================================
// Settings modal
// =====================================================================
function openSettings() {
  setEngDir.value = tState.settings.engDir || '';
  setRusDir.value = tState.settings.rusDir || '';
  setTsvDir.value = tState.settings.tsvDir || '';
  setOutDir.value = tState.settings.outDir || '';
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
}

function hideSettings() {
  settingsOverlay.classList.add('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'true');
}

async function pickAndSetDir(key, inputEl, title) {
  const dir = await window.kh1.translate.pickDirectory(title);
  if (!dir) return;
  inputEl.value = dir;
  tState.settings[key] = dir;
  await window.kh1.translate.saveSettings(tState.settings);
  toast(window.i18n.t('toastSavedKv', {key, dir}), 'success');
  if (key === 'rusDir') loadFileList();
}

settingsOverlay.addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.pick) {
    const key = e.target.dataset.pick;
    const inputs = { engDir: setEngDir, rusDir: setRusDir, tsvDir: setTsvDir, outDir: setOutDir };
    const titles = {
      engDir: 'Виберіть теку з оригінальними файлами (ENG)',
      rusDir: 'Виберіть теку з російською локалізацією (RUS)',
      tsvDir: 'Виберіть теку для збереження прогресу (TSV)',
      outDir: 'Виберіть теку для готових українських файлів (UA)'
    };
    pickAndSetDir(key, inputs[key], titles[key]);
  } else if (e.target === settingsOverlay) {
    hideSettings();
  }
});
settingsClose.addEventListener('click', hideSettings);

// =====================================================================
// Translate mode
// =====================================================================
async function initTranslateMode() {
  try {
    tState.settings = await window.kh1.translate.getSettings() || tState.settings;
  } catch (_) {}

  if (!tState.settings.rusDir) {
    tStatus.textContent = 'Налаштуйте теки локалізації, щоб почати';
    openSettings();
    return;
  }

  await loadWorldsMap();
  await loadFileList();
  await loadGlossaryFromDisk();

  // Авто-відновлення останнього файлу
  const last = tState.settings.lastFile;
  if (last && tState.files.some(f => f.rel === last)) {
    tFileSel.value = last;
    await loadFile(last);
  }
}

// Завантаження карти світів (.ard → world / room name)
let _worldsMap = null;
async function loadWorldsMap() {
  if (_worldsMap) return _worldsMap;
  try {
    const r = await window.kh1.translate.getWorldsMap();
    if (r && r.ok) _worldsMap = r.map;
  } catch (_) {}
  return _worldsMap || {};
}
function describeFile(rel) {
  if (!_worldsMap) return null;
  const seg = (rel.split('/')[0] || '').toLowerCase();
  return _worldsMap[seg] || null;
}

// Дебаунсна запис позиції прокрутки в settings
let _scrollSaveTimer = null;
function scheduleScrollSave() {
  if (!tState.currentRel) return;
  if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
  _scrollSaveTimer = setTimeout(() => {
    _scrollSaveTimer = null;
    const map = Object.assign({}, tState.settings.scrollByFile || {});
    map[tState.currentRel] = tRows.scrollTop;
    tState.settings.scrollByFile = map;
    window.kh1.translate.saveSettings({ scrollByFile: map }).catch(() => {});
  }, 600);
}
tRows.addEventListener('scroll', scheduleScrollSave);

// =====================================================================
// Subtab switching
// =====================================================================
function setSubtab(name) {
  tState.subtab = name;
  subviewFiles.classList.toggle('hidden', name !== 'files');
  subviewGlossary.classList.toggle('hidden', name !== 'glossary');
  tabFiles.classList.toggle('active', name === 'files');
  tabGlossary.classList.toggle('active', name === 'glossary');
  if (name === 'glossary') refreshGlossaryProgress();
  else refreshProgress();
}

async function loadFileList() {
  if (!tState.settings.rusDir) return;
  try {
    const r = await window.kh1.translate.listFiles(tState.settings.rusDir);
    tState.files = (r.files || []).slice().sort((a, b) => a.rel.localeCompare(b.rel));
  } catch (e) {
    tState.files = [];
    toast(window.i18n.t('toastReadRusFail', {msg: e.message}), 'error');
  }

  const visible = tState.safeMode
    ? tState.files.filter(f => f.isTranslatable)
    : tState.files;

  while (tFileSel.firstChild) tFileSel.removeChild(tFileSel.firstChild);
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— виберіть файл —';
  tFileSel.appendChild(blank);
  for (const f of visible) {
    const o = document.createElement('option');
    o.value = f.rel;
    const safety = f.isTranslatable ? '✓' : '⚠';
    const info = describeFile(f.rel);
    const filename = f.rel.split('/').pop();
    let label;
    const ard = (f.rel.split('/')[0] || '').toLowerCase();
    if (info) {
      const room = info.room ? ' / ' + info.room : '';
      label = safety + ' [' + info.world + room + ']  ' + ard + ' › ' + filename + '  (' + f.size + ' b)';
    } else {
      label = safety + '  ' + f.rel + '  (' + f.size + ' b)';
    }
    o.textContent = label;
    tFileSel.appendChild(o);
  }

  const allCount = tState.files.length;
  const safeCount = tState.files.filter(f => f.isTranslatable).length;
  const unsafeCount = allCount - safeCount;
  tStatus.textContent = tState.safeMode
    ? 'Безпечних .binl: ' + safeCount + ' (приховано небезпечних: ' + unsafeCount + ')'
    : 'Усього файлів: ' + allCount + ' · з них .binl: ' + safeCount;
}

tSafeMode.addEventListener('change', async (e) => {
  tState.safeMode = e.target.checked;
  if (!tState.safeMode) {
    if (!window.confirm(
      'УВАГА. Режим "Безпечно" вимикається.\n\n' +
      'Файли .evdl/.ev/інші — це БАЙТКОД (скрипти подій), не текст. ' +
      'Переклад або compose таких файлів зламає гру (краш або undefined behavior).\n\n' +
      'Продовжити?'
    )) {
      tSafeMode.checked = true;
      tState.safeMode = true;
      return;
    }
  }
  await loadFileList();
});

async function loadFile(rel) {
  // Авто-зберегти попередній файл перед перемиканням, без діалогів.
  await flushTsvAutoSave();

  if (!tState.settings.engDir) {
    toast(window.i18n.t('toastConfigEng'), 'error');
    openSettings();
    return;
  }

  const engPath = joinPath(tState.settings.engDir, rel);
  const rusPath = joinPath(tState.settings.rusDir, rel);

  tStatus.textContent = 'Завантажую ' + rel + '…';
  renderEmpty('Обробка ' + rel + '…');

  let r;
  try {
    r = await window.kh1.translate.extract({ engPath, rusPath });
  } catch (e) {
    toast(window.i18n.t('toastExtractError', {msg: e.message}), 'error', 6000);
    renderEmpty('Помилка завантаження');
    return;
  }
  if (r.error) {
    toast(window.i18n.t('toastExtractError', {msg: r.error}), 'error', 6000);
    renderEmpty('Помилка: ' + r.error);
    return;
  }

  tState.slots = (r.slots || []).map(s => ({
    index: s.index,
    offset: s.offset,
    byteLen: s.byteLen,
    english: s.english,
    ukText: ''
  }));
  tState.currentRel = rel;
  tState.dirty = false;

  // 1) auto-fill from glossary (defaults)
  let glossFilled = 0;
  if (gState.translations && Object.keys(gState.translations).length) {
    for (const slot of tState.slots) {
      const uk = gState.translations[slot.english];
      if (uk && uk.trim() && !slot.ukText) { slot.ukText = uk; glossFilled++; }
    }
  }

  // 2) per-file TSV overrides (win over glossary)
  let tsvMerged = 0;
  if (tState.settings.tsvDir) {
    const tsvPath = joinPath(tState.settings.tsvDir, rel) + '.tsv';
    try {
      const tsvR = await window.kh1.translate.readTsv(tsvPath);
      if (tsvR.ok) {
        tsvMerged = mergeTsvIntoSlots(tsvR.content);
      }
    } catch (_) {}
  }

  // 3) stub-fill решти English-ом (зручніше редагувати ніж копіювати)
  let stubbed = 0;
  for (const slot of tState.slots) {
    if (!slot.ukText) { slot.ukText = slot.english; stubbed++; }
  }

  if (glossFilled || tsvMerged) {
    const parts = [];
    if (glossFilled) parts.push(glossFilled + ' з глосарія');
    if (tsvMerged) parts.push(tsvMerged + ' з TSV');
    toast(window.i18n.t('toastAutoFilled', {parts: parts.join(', ') + (stubbed ? ' · ' + stubbed + ' English stubs' : '')}), 'info');
  }

  renderRows();
  refreshProgress();

  // Запам'ятати як "останній файл" + відновити позицію прокрутки
  tState.settings.lastFile = rel;
  window.kh1.translate.saveSettings({ lastFile: rel }).catch(() => {});
  const savedScroll = (tState.settings.scrollByFile || {})[rel];
  if (typeof savedScroll === 'number') {
    requestAnimationFrame(() => { tRows.scrollTop = savedScroll; });
  }
}

function isRealTranslation(slot) {
  return !!(slot && slot.ukText && slot.ukText !== slot.english);
}

// =====================================================================
// Token validation: переконатись що UK-переклад зберіг всі контрольні
// токени з EN — {Color X}, {VarItem}, {0x04}, {lf}, {Triangle} тощо.
// Втрачений токен у грі = краш або порожнє місце.
// =====================================================================
function tokensOf(text) {
  const set = new Map(); // token → count
  if (!text) return set;
  // Curly braces tokens: {anything but {} or newline}
  const reCurly = /\{([^{}\n]+)\}/g;
  let m;
  while ((m = reCurly.exec(text)) !== null) {
    const t = '{' + m[1] + '}';
    // {lf} (перенос рядка) — НЕ обов'язковий до збігу між EN і UK:
    // перекладач легально розбиває рядки інакше (укр. синтаксис стискає
    // 4 EN-рядки у 2 укр. речення тощо). Реальна структура потім
    // вирівнюється через 📐 Auto-wrap (за EN). Викидаємо з валідації,
    // щоб НЕ відсікати такі пари при HTML-імпорті.
    if (t === '{lf}') continue;
    set.set(t, (set.get(t) || 0) + 1);
  }
  return set;
}
function validateTokens(en, uk) {
  const enT = tokensOf(en);
  const ukT = tokensOf(uk);
  const missing = []; // в EN є, в UK нема (або менше)
  const extra = [];   // в UK є зайві
  for (const [t, n] of enT) {
    const have = ukT.get(t) || 0;
    if (have < n) missing.push({ token: t, expected: n, got: have });
  }
  for (const [t, n] of ukT) {
    if (!enT.has(t)) extra.push({ token: t, count: n });
  }
  return { missing, extra, ok: missing.length === 0 };
}
function tokenIssueText(en, uk) {
  const v = validateTokens(en, uk);
  if (v.ok && v.extra.length === 0) return '';
  const parts = [];
  if (v.missing.length) {
    parts.push('Missing: ' + v.missing.map(x =>
      x.expected > 1 ? x.token + '×' + (x.expected - x.got) : x.token).join(', '));
  }
  if (v.extra.length) {
    parts.push('Extra: ' + v.extra.map(x => x.token).join(', '));
  }
  return parts.join(' · ');
}

// =====================================================================
// Auto-save: TSV (per-file) і Glossary, з дебаунсом
// =====================================================================
const AUTOSAVE_DELAY_MS = 1500;
let _tAutoSaveTimer = null;
let _gAutoSaveTimer = null;

function scheduleTsvAutoSave() {
  if (_tAutoSaveTimer) clearTimeout(_tAutoSaveTimer);
  if (!tState.settings.tsvDir || !tState.currentRel) return;
  _tAutoSaveTimer = setTimeout(() => {
    _tAutoSaveTimer = null;
    if (tState.dirty) saveTsvProgress(true);
  }, AUTOSAVE_DELAY_MS);
}

async function flushTsvAutoSave() {
  if (_tAutoSaveTimer) { clearTimeout(_tAutoSaveTimer); _tAutoSaveTimer = null; }
  if (tState.dirty && tState.settings.tsvDir && tState.currentRel) {
    await saveTsvProgress(true);
  }
}

function scheduleGlossaryAutoSave() {
  if (_gAutoSaveTimer) clearTimeout(_gAutoSaveTimer);
  if (!tState.settings.tsvDir) return;
  _gAutoSaveTimer = setTimeout(() => {
    _gAutoSaveTimer = null;
    if (gState.dirty) saveGlossary(true);
  }, AUTOSAVE_DELAY_MS);
}

async function flushGlossaryAutoSave() {
  if (_gAutoSaveTimer) { clearTimeout(_gAutoSaveTimer); _gAutoSaveTimer = null; }
  if (gState.dirty && tState.settings.tsvDir) {
    await saveGlossary(true);
  }
}

// Зберегти все перед закриттям вікна
window.addEventListener('beforeunload', () => {
  // Синхронно ми вже не встигнемо постукати в IPC — але прапорці
  // вже були оброблені auto-save таймером. Це best-effort.
});

// Зберегти leading/trailing whitespace з оригіналу — гра використовує
// провідні пробіли як форматування. Якщо користувач випадково знищив
// (наприклад через Ctrl+A + новий текст), повертаємо їх.
function preserveStructure(originalEng, userUk) {
  if (!userUk || !originalEng) return userUk || '';
  let r = userUk;
  const lead = originalEng.match(/^[ \t]+/);
  if (lead && !/^[ \t]/.test(r)) r = lead[0] + r;
  const trail = originalEng.match(/[ \t]+$/);
  if (trail && !/[ \t]$/.test(r)) r = r + trail[0];
  return r;
}

function mergeTsvIntoSlots(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length < 1) return 0;
  const header = lines[0].split('\t');
  const idxOff = header.indexOf('offset');
  const idxUk = header.indexOf('ukrainian');
  if (idxOff < 0 || idxUk < 0) return 0;

  const tsvByOff = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split('\t');
    const off = parseInt(cols[idxOff], 16);
    let uk = cols[idxUk] || '';
    uk = uk.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (Number.isFinite(off) && uk) tsvByOff.set(off, uk);
  }

  let merged = 0;
  for (const slot of tState.slots) {
    const uk = tsvByOff.get(slot.offset);
    if (uk) { slot.ukText = uk; merged++; }
  }
  return merged;
}

// Будує DIV для відображення англійського тексту з видимим
// маркуванням leading/trailing whitespace (пробіли → ·, таби → ⇥).
function buildEnDisplay(text) {
  const el = document.createElement('div');
  el.className = 't-en';
  const t = text == null ? '' : String(text);
  const leadM = t.match(/^[ \t]+/);
  const trailM = t.match(/[ \t]+$/);
  const startIdx = leadM ? leadM[0].length : 0;
  const endIdx = trailM ? t.length - trailM[0].length : t.length;
  if (leadM) {
    const s = document.createElement('span');
    s.className = 't-ws';
    s.textContent = leadM[0].replace(/ /g, '·').replace(/\t/g, '⇥');
    s.title = 'Leading whitespace: ' + leadM[0].length + ' символ(ів)';
    el.appendChild(s);
  }
  if (endIdx > startIdx) {
    el.appendChild(document.createTextNode(t.substring(startIdx, endIdx)));
  }
  if (trailM) {
    const s = document.createElement('span');
    s.className = 't-ws';
    s.textContent = trailM[0].replace(/ /g, '·').replace(/\t/g, '⇥');
    s.title = 'Trailing whitespace: ' + trailM[0].length + ' символ(ів)';
    el.appendChild(s);
  }
  return el;
}

// Помічає UK textarea, якщо в ньому бракує leading/trailing whitespace
// з оригіналу (preserveStructure повертає це при compose, але візуально треба).
function updateUkWhitespaceWarn(uk, slot) {
  const enLead = (slot.english.match(/^[ \t]+/) || [''])[0];
  const enTrail = (slot.english.match(/[ \t]+$/) || [''])[0];
  const cur = slot.ukText || '';
  const missLead = enLead && !cur.startsWith(enLead);
  const missTrail = enTrail && !cur.endsWith(enTrail);
  const warn = !!(missLead || missTrail) && cur.length > 0 && cur !== slot.english;
  uk.classList.toggle('t-uk-warn', warn);
  if (warn) {
    const parts = [];
    if (missLead) parts.push('бракує leading «' + enLead.replace(/ /g, '·') + '»');
    if (missTrail) parts.push('бракує trailing «' + enTrail.replace(/ /g, '·') + '»');
    uk.title = parts.join(', ') + ' — буде авто-додано при compose';
  } else {
    uk.title = '';
  }
}

function renderEmpty(msg) {
  while (tRows.firstChild) tRows.removeChild(tRows.firstChild);
  const div = document.createElement('div');
  div.className = 't-empty';
  const p = document.createElement('p');
  p.textContent = msg;
  div.appendChild(p);
  tRows.appendChild(div);
}

function renderRows() {
  while (tRows.firstChild) tRows.removeChild(tRows.firstChild);
  if (tState.slots.length === 0) {
    renderEmpty('Цей файл не містить translatable рядків.');
    return;
  }

  const frag = document.createDocumentFragment();
  for (const slot of tState.slots) {
    const row = document.createElement('div');
    let cls = 't-row' + (isRealTranslation(slot) ? ' translated' : '');
    if (isRealTranslation(slot)) {
      const issue = tokenIssueText(slot.english, slot.ukText);
      if (issue) { cls += ' token-warn'; }
    }
    row.className = cls;
    row.dataset.off = String(slot.offset);
    if (isRealTranslation(slot)) {
      const issue = tokenIssueText(slot.english, slot.ukText);
      if (issue) row.title = issue;
    }

    const meta = document.createElement('div');
    meta.className = 't-meta';
    const idxSpan = document.createElement('span');
    idxSpan.className = 't-idx';
    idxSpan.textContent = '#' + slot.index;
    const offSpan = document.createElement('span');
    offSpan.className = 't-off';
    offSpan.textContent = '0x' + slot.offset.toString(16).toUpperCase().padStart(4, '0');
    const lenSpan = document.createElement('span');
    lenSpan.textContent = slot.byteLen + ' b';
    meta.appendChild(idxSpan);
    meta.appendChild(offSpan);
    meta.appendChild(lenSpan);

    const en = buildEnDisplay(slot.english);

    const uk = document.createElement('textarea');
    uk.className = 't-uk';
    uk.placeholder = 'Український переклад…';
    uk.value = slot.ukText;
    uk.spellcheck = false;
    uk.rows = Math.min(4, Math.max(1, Math.ceil(slot.english.length / 70)));
    updateUkWhitespaceWarn(uk, slot);

    row.appendChild(meta);
    row.appendChild(en);
    row.appendChild(uk);
    frag.appendChild(row);
  }
  tRows.appendChild(frag);
  applyFilter();
}

function applyFilter() {
  const search = (tState.filter.search || '').toLowerCase();
  const mode = tState.filter.mode || 'all';
  const rowEls = tRows.querySelectorAll('.t-row');
  for (let i = 0; i < rowEls.length; i++) {
    const slot = tState.slots[i];
    if (!slot) continue;
    let hide = false;
    if (search && slot.english.toLowerCase().indexOf(search) === -1) hide = true;
    const real = isRealTranslation(slot);
    if (mode === 'untranslated' && real) hide = true;
    if (mode === 'translated' && !real) hide = true;
    rowEls[i].classList.toggle('hidden', hide);
  }
}

function refreshProgress() {
  const total = tState.slots.length;
  const done = tState.slots.filter(isRealTranslation).length;
  const pct = total > 0 ? Math.round(100 * done / total) : 0;
  tProgress.textContent = total > 0
    ? done + ' / ' + total + ' (' + pct + '%)'
    : '—';

  const dirtyMark = tState.dirty ? ' ● незбережено' : '';
  tStatus.textContent = (tState.currentRel || '—') + dirtyMark;

  tSaveTsv.disabled = !tState.currentRel || !tState.settings.tsvDir;
  tCompose.disabled = !tState.currentRel || done === 0 || !tState.settings.outDir;
  tExportTxt.disabled = !tState.currentRel || tState.slots.length === 0;
  tImportTxt.disabled = !tState.currentRel || tState.slots.length === 0;
  if (tAutoWrapBtn) tAutoWrapBtn.disabled = !tState.currentRel || tState.slots.length === 0;
}

// edit handler — event delegation
tRows.addEventListener('input', (e) => {
  const ta = e.target;
  if (!(ta && ta.classList && ta.classList.contains('t-uk'))) return;
  const row = ta.closest('.t-row');
  if (!row) return;
  const off = parseInt(row.dataset.off, 10);
  const slot = tState.slots.find(s => s.offset === off);
  if (!slot) return;
  slot.ukText = ta.value;
  row.classList.toggle('translated', isRealTranslation(slot));
  row.classList.remove('error');
  // Token validation live update
  if (isRealTranslation(slot)) {
    const issue = tokenIssueText(slot.english, slot.ukText);
    row.classList.toggle('token-warn', !!issue);
    if (issue) row.title = issue; else row.removeAttribute('title');
  } else {
    row.classList.remove('token-warn');
    row.removeAttribute('title');
  }
  updateUkWhitespaceWarn(ta, slot);
  tState.dirty = true;
  refreshProgress();
  scheduleTsvAutoSave();
});

// ---- Save TSV progress ----
function buildTsvContent() {
  const lines = ['index\toffset\tbytes\tenglish\tukrainian'];
  for (const s of tState.slots) {
    const off = '0x' + s.offset.toString(16).toUpperCase().padStart(4, '0');
    const en = s.english.replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n');
    // Не зберігаємо stub-и (ukText === english) — у TSV лишається тільки реальний переклад
    const ukRaw = isRealTranslation(s) ? s.ukText : '';
    const uk = ukRaw.replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n');
    lines.push([s.index, off, s.byteLen, en, uk].join('\t'));
  }
  return lines.join('\n') + '\n';
}

async function saveTsvProgress(silent) {
  if (!tState.currentRel) { if (!silent) toast(window.i18n.t('toastNoFile'), 'error'); return; }
  if (!tState.settings.tsvDir) {
    if (!silent) { toast(window.i18n.t('toastConfigTsv'), 'error'); openSettings(); }
    return;
  }

  const tsvPath = joinPath(tState.settings.tsvDir, tState.currentRel) + '.tsv';
  try {
    const r = await window.kh1.translate.saveTsv({ tsvPath, content: buildTsvContent() });
    if (r.error) {
      if (!silent) toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000);
      return;
    }
    tState.dirty = false;
    refreshProgress();
    if (!silent) toast(window.i18n.t('toastProgressSaved'), 'success');
  } catch (e) {
    if (!silent) toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

// ---- Compose .binl ----
async function composeBinl() {
  if (!tState.currentRel) { toast(window.i18n.t('toastNoFile'), 'error'); return; }
  if (!tState.settings.outDir) { toast(window.i18n.t('toastNoOutDir'), 'error'); openSettings(); return; }

  // 1) Реальні UK з in-memory edits мають пріоритет
  // 2) Інакше — fallback на глосарій (раптом імпортовано після відкриття файлу)
  const replacements = [];
  for (const s of tState.slots) {
    let uk;
    if (isRealTranslation(s)) {
      uk = s.ukText;
    } else {
      const fromGloss = gState.translations[s.english];
      if (fromGloss && fromGloss !== s.english) uk = fromGloss;
    }
    if (!uk) continue;
    replacements.push({
      offset: s.offset,
      oldLen: s.byteLen,
      ukText: preserveStructure(s.english, uk)
    });
  }

  if (replacements.length === 0) { toast(window.i18n.t('toastNoTranslations'), 'error'); return; }

  // Гарантуємо що TSV збережено перед побудовою .binl
  await flushTsvAutoSave();

  const engPath = joinPath(tState.settings.engDir, tState.currentRel);
  const outPath = joinPath(tState.settings.outDir, tState.currentRel);

  // clear previous error highlights
  for (const row of tRows.querySelectorAll('.t-row.error')) {
    row.classList.remove('error');
    row.removeAttribute('title');
  }

  try {
    const r = await window.kh1.translate.compose({ engPath, replacements, outPath });
    if (r.error) { toast(window.i18n.t('toastComposeError', {msg: r.error}), 'error', 6000); return; }

    let msg = 'Зібрано: ' + replacements.length + ' замін, ' + r.byteLength + ' байт → ' + outPath;
    if (r.errors && r.errors.length) {
      msg += ' · помилок: ' + r.errors.length;
      const offToRow = new Map();
      for (const row of tRows.querySelectorAll('.t-row')) {
        offToRow.set(parseInt(row.dataset.off, 10), row);
      }
      for (const er of r.errors) {
        const row = offToRow.get(er.offset);
        if (row) { row.classList.add('error'); row.title = er.message; }
      }
      toast(msg, 'error', 7000);
    } else {
      toast(msg, 'success', 5000);
    }
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

// =====================================================================
// Per-file .txt export / import (зручно для перекладу поза програмою)
// =====================================================================
function buildPerFileTxt(rel, slots) {
  const out = [];
  out.push('# KH1 Translation File');
  out.push('# File: ' + rel);
  out.push('# Slots: ' + slots.length + ' (показано лише translatable)');
  out.push('# ');
  out.push('# Інструкція:');
  out.push('#  • Редагуй ЛИШЕ блоки --- UK ---. EN — для контексту, не чіпати.');
  out.push('#  • Багаторядковий UK — пиши як є, реальні переноси будуть конвертовані у {lf}.');
  out.push('#  • Токени типу {0x04}, {VarItem}, {ColorRed} лишай як є.');
  out.push('#  • Не змінюй [#N] @0xHEX заголовки — за ними знаходимо слот.');
  out.push('#  • Порожній або такий самий як EN UK — слот пропускається.');
  out.push('# ============================================================');
  out.push('');
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const off = '0x' + s.offset.toString(16).toUpperCase().padStart(4, '0');
    out.push('[#' + (i + 1) + '] @' + off);
    out.push('--- EN ---');
    out.push((s.english || '').replace(/\{lf\}/g, '\n'));
    out.push('--- UK ---');
    out.push((s.ukText || '').replace(/\{lf\}/g, '\n'));
    out.push('=== END ===');
    out.push('');
  }
  return out.join('\n');
}

function parsePerFileTxt(content) {
  // Повертає Map<offsetNumber, ukString> та список помилок
  const map = new Map();
  const errors = [];
  const lines = content.split(/\r?\n/);

  let i = 0;
  let blockHeader = null; // { idx, offset }
  let section = null;     // 'en' | 'uk' | null
  let ukLines = [];

  function commitBlock() {
    if (!blockHeader) return;
    let uk = ukLines.join('\n');
    // Trim trailing blank lines from UK section
    uk = uk.replace(/\s+$/, '');
    // Згорнути реальні переноси у {lf} (якщо користувач не використав {lf})
    if (uk && !uk.includes('{lf}') && uk.includes('\n')) {
      uk = uk.replace(/\r?\n/g, '{lf}');
    }
    map.set(blockHeader.offset, uk);
    blockHeader = null;
    section = null;
    ukLines = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    // Header [#N] @0xHEX
    const m = line.match(/^\[#(\d+)\]\s+@(0x[0-9A-Fa-f]+)\s*$/);
    if (m) {
      commitBlock();
      blockHeader = { idx: parseInt(m[1], 10), offset: parseInt(m[2], 16) };
      section = null;
      ukLines = [];
      i++;
      continue;
    }
    if (/^---\s*EN\s*---\s*$/.test(line)) { section = 'en'; i++; continue; }
    if (/^---\s*UK\s*---\s*$/.test(line)) { section = 'uk'; i++; continue; }
    if (/^===\s*END\s*===\s*$/.test(line)) { commitBlock(); i++; continue; }
    if (section === 'uk') ukLines.push(line);
    // EN-секція ігнорується (read-only context)
    i++;
  }
  commitBlock();
  return { map, errors };
}

async function exportFileTxt() {
  if (!tState.currentRel) { toast(window.i18n.t('toastNoFile'), 'error'); return; }
  if (!tState.slots.length) { toast(window.i18n.t('toastNoRowsExport'), 'error'); return; }
  const content = buildPerFileTxt(tState.currentRel, tState.slots);
  const defaultName = tState.currentRel.replace(/[\/\\]/g, '_') + '.txt';
  try {
    const r = await window.kh1.translate.exportFileTxt({ defaultName, content });
    if (r.canceled) return;
    if (r.error) { toast(window.i18n.t('toastExportError', {msg: r.error}), 'error', 6000); return; }
    toast(window.i18n.t('toastExportedTxt', {path: r.filePath, n: r.byteLength}), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

async function importFileTxt() {
  if (!tState.currentRel) { toast(window.i18n.t('toastOpenTargetFirst'), 'error'); return; }
  if (!tState.slots.length) { toast(window.i18n.t('toastNoRowsImport'), 'error'); return; }
  try {
    const r = await window.kh1.translate.importFileTxt();
    if (r.canceled) return;
    if (r.error) { toast(window.i18n.t('toastImportError', {msg: r.error}), 'error', 6000); return; }
    const parsed = parsePerFileTxt(r.content);
    let applied = 0, skipped = 0, notFound = 0;
    for (const slot of tState.slots) {
      if (parsed.map.has(slot.offset)) {
        const uk = parsed.map.get(slot.offset);
        if (!uk || uk === slot.english) { skipped++; continue; }
        slot.ukText = uk;
        applied++;
      }
    }
    for (const off of parsed.map.keys()) {
      if (!tState.slots.find(s => s.offset === off)) notFound++;
    }
    if (applied) {
      tState.dirty = true;
      // Заодно оновити glossary з нових перекладів
      for (const slot of tState.slots) {
        if (slot.ukText && slot.ukText !== slot.english) {
          if (gState.translations[slot.english] !== slot.ukText) {
            gState.translations[slot.english] = slot.ukText;
            gState.dirty = true;
          }
        }
      }
      renderRows();
      refreshProgress();
      scheduleTsvAutoSave();
      scheduleGlossaryAutoSave();
    }
    let msg = 'Імпорт: ' + applied + ' застосовано';
    if (skipped) msg += ', ' + skipped + ' пропущено (порожнє/=EN)';
    if (notFound) msg += ', ' + notFound + ' не знайдено за offset';
    toast(msg, applied ? 'success' : 'info', 6000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

// =====================================================================
// Glossary
// =====================================================================
async function loadGlossaryFromDisk() {
  if (!tState.settings.tsvDir) return;
  try {
    const r = await window.kh1.translate.readGlossary(tState.settings.tsvDir);
    if (r.ok) {
      gState.translations = r.entries || {};
      refreshGlossaryProgress();
    }
  } catch (_) {}
}

async function buildGlossary() {
  if (gState.busy) return;
  if (!tState.settings.engDir || !tState.settings.rusDir) {
    toast(window.i18n.t('toastConfigEngRus'), 'error');
    openSettings();
    return;
  }
  if (!tState.files || !tState.files.length) {
    toast(window.i18n.t('toastEmptyFilesReload'), 'error');
    return;
  }

  gState.busy = true;
  gBuild.disabled = true;
  tProgress.classList.add('busy');
  tProgress.textContent = 'Сканую…';

  try {
    const r = await window.kh1.translate.buildGlossary({
      engDir: tState.settings.engDir,
      rusDir: tState.settings.rusDir,
      files: tState.files.map(f => f.rel),
      safeMode: tState.safeMode
    });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }

    gState.entries = r.entries || [];
    renderGlossaryRows();
    refreshGlossaryProgress();
    const parts = ['Знайдено ' + gState.entries.length + ' унікальних рядків'];
    parts.push('оброблено: ' + r.processed);
    if (r.skipped) parts.push('пропущено: ' + r.skipped);
    if (r.skippedUnsafe) parts.push('🛡 заблоковано небезпечних: ' + r.skippedUnsafe);
    toast(parts.join(' · '), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  } finally {
    gState.busy = false;
    gBuild.disabled = false;
    tProgress.classList.remove('busy');
  }
}

function renderGlossaryRows() {
  while (gRows.firstChild) gRows.removeChild(gRows.firstChild);
  if (!gState.entries.length) {
    const div = document.createElement('div');
    div.className = 't-empty';
    const p = document.createElement('p');
    p.textContent = 'Глосарій порожній. Натисніть "Побудувати/Оновити".';
    div.appendChild(p);
    gRows.appendChild(div);
    return;
  }

  const frag = document.createDocumentFragment();
  for (let i = 0; i < gState.entries.length; i++) {
    const entry = gState.entries[i];
    const ukText = gState.translations[entry.english] || '';

    const row = document.createElement('div');
    let cls = 't-row' + (ukText ? ' translated' : '');
    if (ukText) {
      const issue = tokenIssueText(entry.english, ukText);
      if (issue) { cls += ' token-warn'; row.title = issue; }
    }
    row.className = cls;
    row.dataset.gidx = String(i);

    const meta = document.createElement('div');
    meta.className = 't-meta';
    const cnt = document.createElement('span');
    cnt.className = 't-count';
    cnt.textContent = '× ' + entry.count;
    cnt.title = 'У файлах: ' + entry.fileCount;
    meta.appendChild(cnt);

    const en = document.createElement('div');
    en.className = 't-en';
    en.textContent = entry.english;

    const uk = document.createElement('textarea');
    uk.className = 't-uk g-uk';
    uk.placeholder = 'Український переклад…';
    uk.value = ukText;
    uk.spellcheck = false;
    uk.rows = Math.min(4, Math.max(1, Math.ceil(entry.english.length / 70)));

    row.appendChild(meta);
    row.appendChild(en);
    row.appendChild(uk);
    frag.appendChild(row);
  }
  gRows.appendChild(frag);
  applyGlossaryFilter();
}

function applyGlossaryFilter() {
  const search = (gState.filter.search || '').toLowerCase();
  const mode = gState.filter.mode || 'all';
  const rowEls = gRows.querySelectorAll('.t-row');
  for (let i = 0; i < rowEls.length; i++) {
    const entry = gState.entries[i];
    if (!entry) continue;
    const uk = gState.translations[entry.english] || '';
    let hide = false;
    if (search && entry.english.toLowerCase().indexOf(search) === -1) hide = true;
    if (mode === 'untranslated' && uk) hide = true;
    if (mode === 'translated' && !uk) hide = true;
    rowEls[i].classList.toggle('hidden', hide);
  }
}

function refreshGlossaryProgress() {
  const total = gState.entries.length;
  const done = gState.entries.filter(e => {
    const uk = gState.translations[e.english];
    return uk && uk.trim();
  }).length;
  const pct = total > 0 ? Math.round(100 * done / total) : 0;
  gStat.textContent = total > 0
    ? done + ' / ' + total + ' (' + pct + '%)'
    : '—';

  if (tState.subtab === 'glossary') {
    tProgress.textContent = gStat.textContent;
    tStatus.textContent = 'Глосарій · ' + (gState.dirty ? '● незбережено' : 'збережено');
  }

  gSave.disabled = !tState.settings.tsvDir;
  gComposeAll.disabled = total === 0 || done === 0 ||
    !tState.settings.engDir || !tState.settings.rusDir || !tState.settings.outDir;
}

// edit handler for glossary rows — event delegation
gRows.addEventListener('input', (e) => {
  const ta = e.target;
  if (!(ta && ta.classList && ta.classList.contains('g-uk'))) return;
  const row = ta.closest('.t-row');
  if (!row) return;
  const idx = parseInt(row.dataset.gidx, 10);
  const entry = gState.entries[idx];
  if (!entry) return;
  const v = ta.value;
  if (v.trim()) {
    gState.translations[entry.english] = v;
    row.classList.add('translated');
  } else {
    delete gState.translations[entry.english];
    row.classList.remove('translated');
  }
  // Token validation live update
  const ukText = gState.translations[entry.english] || '';
  if (ukText) {
    const issue = tokenIssueText(entry.english, ukText);
    row.classList.toggle('token-warn', !!issue);
    if (issue) row.title = issue; else row.removeAttribute('title');
  } else {
    row.classList.remove('token-warn');
    row.removeAttribute('title');
  }
  gState.dirty = true;
  refreshGlossaryProgress();
  scheduleGlossaryAutoSave();
});

async function saveGlossary(silent) {
  if (!tState.settings.tsvDir) {
    if (!silent) { toast(window.i18n.t('toastConfigTsv'), 'error'); openSettings(); }
    return;
  }
  try {
    const r = await window.kh1.translate.saveGlossary({
      tsvDir: tState.settings.tsvDir,
      entries: gState.translations
    });
    if (r.error) {
      if (!silent) toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000);
      return;
    }
    gState.dirty = false;
    refreshGlossaryProgress();
    if (!silent) toast(window.i18n.t('toastGlossarySaved', {n: r.count}), 'success');
  } catch (e) {
    if (!silent) toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

async function composeAllFiles() {
  if (gState.busy) return;
  if (!tState.settings.engDir || !tState.settings.rusDir || !tState.settings.outDir) {
    toast(window.i18n.t('toastConfigEngRusUa'), 'error');
    openSettings();
    return;
  }
  if (!tState.files.length) { toast(window.i18n.t('toastEmptyFiles'), 'error'); return; }
  if (!Object.keys(gState.translations).length) { toast(window.i18n.t('toastEmptyGlossary'), 'error'); return; }

  // Token validation pre-check
  const { bad } = countGlossaryTokenIssues();
  if (bad > 0) {
    if (!window.confirm(window.i18n.t('composeAllWarnTokens', { n: bad }))) return;
  }

  if (!window.confirm(
    'Зібрати ' + tState.files.length + ' файлів у ' + tState.settings.outDir + '?\n\n' +
    'Per-file TSV-overrides з ' + (tState.settings.tsvDir || '(не задано)') + ' матимуть пріоритет над глосарієм.'
  )) return;

  gState.busy = true;
  gComposeAll.disabled = true;
  tProgress.classList.add('busy');

  // Гарантуємо що глосарій збережено перед mass-compose
  await flushGlossaryAutoSave();

  try {
    const r = await window.kh1.translate.composeAll({
      engDir: tState.settings.engDir,
      rusDir: tState.settings.rusDir,
      outDir: tState.settings.outDir,
      tsvDir: tState.settings.tsvDir || null,
      files: tState.files.map(f => f.rel),
      glossary: gState.translations,
      safeMode: tState.safeMode
    });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }

    const parts = ['Записано ' + r.written + ' / ' + r.processed + ' файлів',
                   r.totalReplacements + ' замін'];
    if (r.skippedNoTranslations) parts.push('без перекладів: ' + r.skippedNoTranslations);
    if (r.skippedUnsafe) parts.push('🛡 заблоковано небезпечних: ' + r.skippedUnsafe);
    if (r.errors && r.errors.length) {
      parts.push('з помилками: ' + r.errors.length);
      toast(parts.join(' · '), 'error', 9000);
    } else {
      toast(parts.join(' · '), 'success', 7000);
    }
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  } finally {
    gState.busy = false;
    gComposeAll.disabled = false;
    tProgress.classList.remove('busy');
    refreshGlossaryProgress();
  }
}

// =====================================================================
// Import translations from external file (HTML/CSV/TSV)
// — substring matching: HTML "phrase" → знаходимо як підрядок у glossary entries,
//   заміняємо текстову частину, керуючі коди / токени лишаємо.
// =====================================================================
const IMPORT_MIN_PHRASE_LEN = 4;

function applySubstringSubstitutions(text, pairs) {
  // Знайти ВСІ можливі збіги
  const matches = [];
  for (let i = 0; i < pairs.length; i++) {
    const en = pairs[i].en;
    const uk = pairs[i].uk;
    if (!en || en.length < IMPORT_MIN_PHRASE_LEN) continue;
    // Захист: якщо імпортована пара втрачає або змінює `{...}` токени
    // (наприклад перекладач у HTML-джерелі забув `.{0x06}`), ігноруємо її —
    // інакше система мовчки запише до глосарію UK без керівних байтів і
    // це зламає рендер у грі.
    if (!validateTokens(en, uk).ok) continue;
    let pos = 0;
    while (true) {
      const idx = text.indexOf(en, pos);
      if (idx < 0) break;
      matches.push({ start: idx, end: idx + en.length, en: en, uk: uk });
      pos = idx + 1; // дозволяємо overlap-кандидатам бути знайденими, відсіємо нижче
    }
  }
  if (!matches.length) return null;

  // Жадібний вибір: довший збіг переважає, потім лівіший.
  matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);

  const taken = new Array(text.length).fill(false);
  const chosen = [];
  for (const m of matches) {
    let overlap = false;
    for (let i = m.start; i < m.end; i++) {
      if (taken[i]) { overlap = true; break; }
    }
    if (overlap) continue;
    for (let i = m.start; i < m.end; i++) taken[i] = true;
    chosen.push(m);
  }
  if (!chosen.length) return null;

  // Зібрати результат у порядку позицій
  chosen.sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const m of chosen) {
    out += text.substring(pos, m.start);
    out += m.uk;
    pos = m.end;
  }
  out += text.substring(pos);

  if (out === text) return null;
  return { uk: out, sources: chosen.map(m => m.en) };
}

async function importTranslations() {
  if (!gState.entries.length) {
    toast(window.i18n.t('toastBuildFirst'), 'error', 5000);
    return;
  }

  let r;
  try { r = await window.kh1.translate.importTranslations(); }
  catch (e) { toast(window.i18n.t('toastError', {msg: e.message}), 'error'); return; }

  if (r.canceled) return;
  if (r.error) { toast(window.i18n.t('toastParseError', {msg: r.error}), 'error', 6000); return; }

  const sources = r.sources || [];
  const errs = r.errors || [];
  if (errs.length) {
    toast(window.i18n.t('toastParseFilesError', {n: errs.length, first: errs[0].error}), 'error', 6000);
  }

  // Нормалізація Pro100luk-style токенів з пробілами → канонічні без пробілів,
  // щоб substring-match знаходив їх в глосарій-ключах (наш decoder завжди
  // повертає канонічну форму).
  const TOKEN_ALIAS_MAP = {
    // Curly-brace Pro100luk-style (з пробілами)
    '{Color Red}':         '{ColorRed}',
    '{Color Violet}':      '{ColorViolet}',
    '{Color Green}':       '{ColorGreen}',
    '{Base Color}':        '{ColorBase}',
    '{Variable Item}':     '{VarItem}',
    '{Variable Item 2}':   '{VarItem}',
    '{Variable Spell}':    '{VarSpell}',
    '{Variable Spell New}': '{VarSpellNew}',
    '{Variable Value}':    '{VarValue}',
    '{Variable Number 1}': '{VarNum1}',
    '{Variable Number 2}': '{VarNum2}',
    '{Variable Number 3}': '{VarNum3}',
    // Square-bracket варіант (Google Sheets подекуди їсть {} і ставить [])
    '[Color Red]':         '{ColorRed}',
    '[Color Violet]':      '{ColorViolet}',
    '[Color Green]':       '{ColorGreen}',
    '[Base Color]':        '{ColorBase}',
    '[ColorRed]':          '{ColorRed}',
    '[ColorViolet]':       '{ColorViolet}',
    '[ColorGreen]':        '{ColorGreen}',
    '[ColorBase]':         '{ColorBase}',
    '[Variable Item]':     '{VarItem}',
    '[Variable Item 2]':   '{VarItem}',
    '[Variable Spell]':    '{VarSpell}',
    '[Variable Spell New]': '{VarSpellNew}',
    '[Variable Value]':    '{VarValue}',
    '[Variable Number 1]': '{VarNum1}',
    '[Variable Number 2]': '{VarNum2}',
    '[Variable Number 3]': '{VarNum3}',
    '[VarItem]':           '{VarItem}',
    '[VarSpell]':          '{VarSpell}',
    '[VarSpellNew]':       '{VarSpellNew}',
    '[VarValue]':          '{VarValue}',
    '[VarNum1]':           '{VarNum1}',
    '[VarNum2]':           '{VarNum2}',
    '[VarNum3]':           '{VarNum3}'
  };
  function normalizeTokens(s) {
    if (!s) return s;
    let out = s;
    for (const k in TOKEN_ALIAS_MAP) out = out.split(k).join(TOKEN_ALIAS_MAP[k]);
    return out;
  }

  // Розщеплення multi-line: HTML інколи зберігає кілька фраз через ¶ (=> {lf}).
  // У грі це часто 3 окремі слоти. Якщо EN та UK мають ОДНАКОВУ кількість
  // сегментів — додаємо кожен як окрему під-пару, щоб substring-match знайшов
  // їх у відповідних slotах глосарія.
  // Підрахувати скільки в сегменті "справжніх" літер (поза {...}-токенами).
  // Якщо менше 3 — сегмент майже-весь токени, ¶-split безпечно
  // зробити НЕЛЬЗЯ (перекладачі часто переставляють порядок частин).
  function letterCountOutsideTokens(s) {
    const stripped = String(s || '').replace(/\{[^}]+\}/g, '');
    const letters = stripped.match(/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g);
    return letters ? letters.length : 0;
  }

  const expandedRaw = [];
  let splitAdded = 0;
  let splitSkipped = 0;
  let normalized = 0;
  for (const rawP of (r.pairs || [])) {
    if (!rawP || !rawP.en || !rawP.uk) continue;
    const en0 = normalizeTokens(rawP.en);
    const uk0 = normalizeTokens(rawP.uk);
    if (en0 !== rawP.en || uk0 !== rawP.uk) normalized++;
    const p = { en: en0, uk: uk0 };
    expandedRaw.push(p);
    const enParts = p.en.split('{lf}');
    const ukParts = p.uk.split('{lf}');
    if (enParts.length > 1 && enParts.length === ukParts.length) {
      // Класифікуємо кожен сегмент: 'text' (>=3 літери поза токенами) або 'tokens'
      const enCls = enParts.map(s => letterCountOutsideTokens(s) >= 3 ? 'text' : 'tokens');
      const ukCls = ukParts.map(s => letterCountOutsideTokens(s) >= 3 ? 'text' : 'tokens');
      let directOK = true;
      let reversedOK = true;
      const N = enParts.length;
      for (let i = 0; i < N; i++) {
        if (enCls[i] !== ukCls[i]) directOK = false;
        if (enCls[i] !== ukCls[N - 1 - i]) reversedOK = false;
      }
      // Прямі пари мають пріоритет; reversed дозволяємо коли direct невалідне
      // (перекладач переставив структуру речення — типово для ENG→UKR).
      if (directOK) {
        for (let i = 0; i < N; i++) {
          const en = enParts[i].trim();
          const uk = ukParts[i].trim();
          if (en && uk) { expandedRaw.push({ en, uk }); splitAdded++; }
        }
      } else if (reversedOK && N === 2) {
        // лише для 2-сегментного випадку (найбезпечніше)
        for (let i = 0; i < N; i++) {
          const en = enParts[i].trim();
          const uk = ukParts[N - 1 - i].trim();
          if (en && uk) { expandedRaw.push({ en, uk }); splitAdded++; }
        }
      } else {
        splitSkipped++;
      }
    } else if (enParts.length > 1 && ukParts.length === 1 &&
               letterCountOutsideTokens(ukParts[0]) >= 3) {
      // EN multi-segment, UK single-block. Спершу пробуємо РОЗУМНО розбити
      // UK по знаках кінця речення (. ! ? + після пробіл/кінець).
      const ukText = ukParts[0];
      const sentRe = /[.!?…]+(?=\s|$)/g;
      const matches = [];
      let m;
      while ((m = sentRe.exec(ukText)) !== null) matches.push(m);
      let smartUk = null;
      if (matches.length === enParts.length) {
        const arr = [];
        let lastEnd = 0;
        for (const mm of matches) {
          const end = mm.index + mm[0].length;
          arr.push(ukText.substring(lastEnd, end).trim());
          lastEnd = end;
        }
        if (arr.every(s => s.length > 0)) smartUk = arr;
      }

      if (smartUk) {
        // Direct pairing по reчeннях
        for (let i = 0; i < enParts.length; i++) {
          const en = enParts[i].trim();
          const uk = smartUk[i];
          if (en && uk) { expandedRaw.push({ en, uk }); splitAdded++; }
        }
      } else {
        // Fallback: повний UK на 1-й EN, інші — пробіл (мінімальний blank)
        const en0 = enParts[0].trim();
        const uk0 = ukParts[0].trim();
        if (en0 && uk0) { expandedRaw.push({ en: en0, uk: uk0 }); splitAdded++; }
        for (let i = 1; i < enParts.length; i++) {
          const enI = enParts[i].trim();
          if (enI && letterCountOutsideTokens(enI) >= 3) {
            expandedRaw.push({ en: enI, uk: ' ' });
            splitAdded++;
          }
        }
      }
    }
  }

  // Dedupe by EN — якщо однакові EN в кількох файлах/сегментах, останній виграє.
  // Одночасно відсікаємо пари, де UK не зберіг {...}-токени з EN: це майже
  // завжди помилка перекладача у HTML-джерелі (пропустив {0xXX}, {VarItem}
  // тощо), і застосування такої пари зламало б керівні байти у грі.
  const enToUk = new Map();
  let duplicates = 0;
  let tokensBroken = 0;
  for (const p of expandedRaw) {
    if (!validateTokens(p.en, p.uk).ok) { tokensBroken++; continue; }
    if (enToUk.has(p.en) && enToUk.get(p.en) !== p.uk) duplicates++;
    enToUk.set(p.en, p.uk);
  }
  const pairs = [...enToUk.entries()].map(([en, uk]) => ({ en, uk }));

  if (!pairs.length) {
    toast(window.i18n.t('toastNoValidPairs'), 'error');
    return;
  }

  const parts = ['Завантажено ' + sources.length + ' файл(ів)', pairs.length + ' унікальних пар'];
  if (splitAdded) parts.push('розщеплено ¶: +' + splitAdded);
  if (splitSkipped) parts.push('пропущено split (інверсія): ' + splitSkipped);
  if (normalized) parts.push('нормалізовано токенів: ' + normalized);
  if (tokensBroken) parts.push('⚠ пропущено через втрату токенів: ' + tokensBroken);
  if (duplicates) parts.push('дублікати: ' + duplicates);
  toast(parts.join(' · '), 'info', 5500);

  const matched = [];      // { english, computedUk, sources }
  const conflicts = [];    // { english, oldUk, newUk, sources }
  const sameAlready = [];  // { english, uk }
  const usedPhrases = new Set();

  for (const entry of gState.entries) {
    const enKey = entry.english;
    const result = applySubstringSubstitutions(enKey, pairs);
    if (!result) continue;
    for (const s of result.sources) usedPhrases.add(s);

    const cur = gState.translations[enKey];
    if (!cur || cur === enKey) {
      matched.push({ english: enKey, computedUk: result.uk, sources: result.sources });
    } else if (cur === result.uk) {
      sameAlready.push({ english: enKey, uk: result.uk });
    } else {
      conflicts.push({ english: enKey, oldUk: cur, newUk: result.uk, sources: result.sources });
    }
  }

  const unmatched = pairs.filter(p => !usedPhrases.has(p.en));

  importPending = { matched, conflicts, unmatched, sameAlready, source: r.source, format: r.format };

  // Render summary
  importSummary.innerHTML = '';
  function statBox(num, lbl, cls) {
    const d = document.createElement('div');
    d.className = 'import-stat ' + (cls || '');
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = String(num);
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = lbl;
    d.appendChild(n); d.appendChild(l);
    return d;
  }
  importSummary.appendChild(statBox(matched.length, 'Збігів (нові)', 'match'));
  importSummary.appendChild(statBox(sameAlready.length, 'Вже однакові', ''));
  importSummary.appendChild(statBox(conflicts.length, 'Конфлікти', 'conflict'));
  importSummary.appendChild(statBox(unmatched.length, 'Не знайдено', 'miss'));

  // Render conflicts list (first 100)
  importConflicts.innerHTML = '';
  if (conflicts.length) {
    const head = document.createElement('div');
    head.className = 'conflict-row';
    head.innerHTML = '';
    const a = document.createElement('div');
    const b = document.createElement('div');
    const aLbl = document.createElement('div'); aLbl.className = 'ch'; aLbl.textContent = 'Поточне (буде замінене якщо "Перезаписати")';
    const bLbl = document.createElement('div'); bLbl.className = 'ch'; bLbl.textContent = 'З імпорту';
    a.appendChild(aLbl); b.appendChild(bLbl);
    head.appendChild(a); head.appendChild(b);
    importConflicts.appendChild(head);

    const limit = Math.min(100, conflicts.length);
    for (let i = 0; i < limit; i++) {
      const c = conflicts[i];
      const row = document.createElement('div');
      row.className = 'conflict-row';
      const left = document.createElement('div');
      const right = document.createElement('div');
      const lEn = document.createElement('div'); lEn.className = 'ch'; lEn.textContent = '« ' + c.english;
      const lOld = document.createElement('div'); lOld.className = 'cv old'; lOld.textContent = c.oldUk;
      const rEn = document.createElement('div'); rEn.className = 'ch'; rEn.textContent = '« ' + c.english;
      const rNew = document.createElement('div'); rNew.className = 'cv new'; rNew.textContent = c.newUk;
      left.appendChild(lEn); left.appendChild(lOld);
      right.appendChild(rEn); right.appendChild(rNew);
      row.appendChild(left); row.appendChild(right);
      importConflicts.appendChild(row);
    }
    if (conflicts.length > limit) {
      const more = document.createElement('div');
      more.className = 'conflict-row';
      const span = document.createElement('div');
      span.className = 'ch';
      span.textContent = '… і ще ' + (conflicts.length - limit) + ' конфліктів';
      more.appendChild(span);
      importConflicts.appendChild(more);
    }
  }

  importApplyBtn.disabled = matched.length === 0;
  importOverwriteBtn.disabled = matched.length + conflicts.length === 0;

  importOverlay.classList.remove('hidden');
  importOverlay.setAttribute('aria-hidden', 'false');
}

function applyImport(includeConflicts) {
  if (!importPending) return;
  let applied = 0;
  for (const p of importPending.matched) {
    gState.translations[p.english] = p.computedUk;
    applied++;
  }
  if (includeConflicts) {
    for (const c of importPending.conflicts) {
      gState.translations[c.english] = c.newUk;
      applied++;
    }
  }
  gState.dirty = true;
  renderGlossaryRows();
  refreshGlossaryProgress();

  // 1) Одразу зберегти глосарій на диск (без чекання auto-save)
  saveGlossary(true);

  // 2) Оновити слоти відкритого файлу — підтягнути нові переклади з глосарія
  let updatedInFile = 0;
  if (tState.currentRel && tState.slots.length) {
    for (const slot of tState.slots) {
      if (isRealTranslation(slot)) continue; // не чіпаємо що користувач сам вводив
      const fromGloss = gState.translations[slot.english];
      if (fromGloss && fromGloss !== slot.english) {
        slot.ukText = fromGloss;
        updatedInFile++;
      }
    }
    if (updatedInFile > 0) {
      renderRows();
      refreshProgress();
    }
  }

  hideImport();
  const msg = 'Застосовано ' + applied + ' перекладів у глосарій · збережено' +
    (updatedInFile ? ' · оновлено ' + updatedInFile + ' слотів у відкритому файлі' : '');
  toast(msg, 'success', 6000);
}

function hideImport() {
  importOverlay.classList.add('hidden');
  importOverlay.setAttribute('aria-hidden', 'true');
  importPending = null;
}

importApplyBtn.addEventListener('click', () => applyImport(false));
importOverwriteBtn.addEventListener('click', () => {
  if (importPending && importPending.conflicts.length > 0) {
    if (!window.confirm('Перезаписати ' + importPending.conflicts.length + ' існуючих перекладів?')) return;
  }
  applyImport(true);
});
importCancelBtn.addEventListener('click', hideImport);
importOverlay.addEventListener('click', (e) => { if (e.target === importOverlay) hideImport(); });

// =====================================================================
// Progress events from main
// =====================================================================
window.kh1.translate.onProgress((p) => {
  if (!p) return;
  const phase = p.phase === 'glossary-build' ? 'Сканую'
              : p.phase === 'compose-all' ? 'Збираю'
              : p.phase || '…';
  tProgress.textContent = phase + ': ' + p.done + ' / ' + p.total;
  if (p.currentFile) tStatus.textContent = phase + '… ' + p.currentFile;
});

// =====================================================================
// Find & Replace (Ctrl+H) — у глосарії + у відкритому файлі
// =====================================================================
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function countOcc(haystack, needle, caseSensitive) {
  if (!needle) return 0;
  let h = caseSensitive ? haystack : String(haystack).toLowerCase();
  let n = caseSensitive ? needle : String(needle).toLowerCase();
  let count = 0, pos = 0;
  while ((pos = h.indexOf(n, pos)) !== -1) { count++; pos += n.length; }
  return count;
}
function replaceAll(text, find, repl, caseSensitive) {
  if (!find) return text;
  if (caseSensitive) return String(text).split(find).join(repl);
  return String(text).replace(new RegExp(escapeRegex(find), 'g' + 'i'), repl);
}

function showReplace() {
  repOverlay.classList.remove('hidden');
  repOverlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => { repFind.focus(); repFind.select(); }, 0);
  updateReplaceStat();
}
function hideReplace() {
  repOverlay.classList.add('hidden');
  repOverlay.setAttribute('aria-hidden', 'true');
}

function updateReplaceStat() {
  const find = repFind.value;
  const cs = repCase.checked;
  if (!find) {
    repStat.textContent = 'Введіть текст для пошуку...';
    repApply.disabled = true;
    repApply.textContent = 'Замінити';
    return;
  }
  let totalOcc = 0, entries = 0;
  for (const v of Object.values(gState.translations || {})) {
    const o = countOcc(v, find, cs);
    if (o > 0) { totalOcc += o; entries++; }
  }
  let openSlots = 0;
  if (tState.currentRel && tState.slots && tState.slots.length) {
    for (const slot of tState.slots) {
      if (isRealTranslation(slot) && countOcc(slot.ukText, find, cs) > 0) openSlots++;
    }
  }
  if (totalOcc === 0 && openSlots === 0) {
    repStat.textContent = 'Не знайдено в глосарії або відкритому файлі.';
    repApply.disabled = true;
    repApply.textContent = 'Замінити';
    return;
  }
  const parts = [];
  if (totalOcc) parts.push(totalOcc + ' входжень у ' + entries + ' записах глосарія');
  if (openSlots) parts.push(openSlots + ' слот(ів) у відкритому файлі');
  repStat.textContent = 'Знайдено ' + parts.join(', ');
  repApply.disabled = false;
  repApply.textContent = 'Замінити в ' + (entries + openSlots) + ' місцях';
}

async function doReplaceAll() {
  const find = repFind.value;
  const repl = repReplace.value;
  const cs = repCase.checked;
  if (!find) return;
  if (!window.confirm('Замінити "' + find + '" → "' + repl + '" у глосарії та відкритому файлі?')) return;

  let changedGloss = 0;
  for (const en of Object.keys(gState.translations || {})) {
    const old = gState.translations[en];
    if (!old) continue;
    if (countOcc(old, find, cs) === 0) continue;
    gState.translations[en] = replaceAll(old, find, repl, cs);
    changedGloss++;
  }

  let changedSlots = 0;
  if (tState.currentRel && tState.slots && tState.slots.length) {
    for (const slot of tState.slots) {
      if (!isRealTranslation(slot)) continue;
      if (countOcc(slot.ukText, find, cs) === 0) continue;
      slot.ukText = replaceAll(slot.ukText, find, repl, cs);
      changedSlots++;
    }
  }

  if (changedGloss) {
    gState.dirty = true;
    await saveGlossary(true);
    renderGlossaryRows();
    refreshGlossaryProgress();
  }
  if (changedSlots) {
    tState.dirty = true;
    renderRows();
    refreshProgress();
    scheduleTsvAutoSave();
  }
  hideReplace();
  toast(window.i18n.t('toastReplaceCount', {n: changedGloss}) +
    (changedSlots ? window.i18n.t('toastReplaceSlots', {n: changedSlots}) : ''),
    'success', 5000);
}

repFind.addEventListener('input', updateReplaceStat);
repReplace.addEventListener('input', updateReplaceStat);
repCase.addEventListener('change', updateReplaceStat);
repApply.addEventListener('click', doReplaceAll);
repCancel.addEventListener('click', hideReplace);
repOverlay.addEventListener('click', (e) => { if (e.target === repOverlay) hideReplace(); });
repFind.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (!repApply.disabled) doReplaceAll(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideReplace(); }
});
repReplace.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (!repApply.disabled) doReplaceAll(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideReplace(); }
});

function joinPath(a, b) {
  if (!a) return b;
  const sep = a.indexOf('\\') >= 0 ? '\\' : '/';
  const aTrim = a.replace(/[\\/]+$/, '');
  const bNorm = b.replace(/[\\/]+/g, sep);
  return aTrim + sep + bNorm.replace(/^[\\/]+/, '');
}

// =====================================================================
// Wire up — translate
// =====================================================================
tFileSel.addEventListener('change', (e) => {
  const v = e.target.value;
  if (v) loadFile(v);
});
tReload.addEventListener('click', loadFileList);
tSearchInput.addEventListener('input', (e) => {
  tState.filter.search = e.target.value;
  applyFilter();
});
tFilterMode.addEventListener('change', (e) => {
  tState.filter.mode = e.target.value;
  applyFilter();
});
tSaveTsv.addEventListener('click', () => saveTsvProgress(false));
tCompose.addEventListener('click', composeBinl);
tExportTxt.addEventListener('click', exportFileTxt);
tImportTxt.addEventListener('click', importFileTxt);
if (tAutoWrapBtn) tAutoWrapBtn.addEventListener('click', autoWrapAllUkSlots);

async function autoWrapAllUkSlots() {
  if (!tState.currentRel || !tState.slots.length) {
    toast(window.i18n.t('toastNoFile'), 'error'); return;
  }
  if (!kState.knjBuf) {
    toast(window.i18n.t('toastNeedKnj'), 'error', 6000); return;
  }
  const maxWidth = Math.max(100, Math.min(900, parseInt(tMaxWidthInput && tMaxWidthInput.value, 10) || 380));
  const slotIdxs = [];
  const texts = [];
  for (let i = 0; i < tState.slots.length; i++) {
    const s = tState.slots[i];
    if (!isRealTranslation(s)) continue;
    slotIdxs.push(i);
    texts.push(s.ukText);
  }
  if (!texts.length) { toast(window.i18n.t('toastNoTranslations'), 'info'); return; }
  const u8 = kState.knjBuf;
  const knjData = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  try {
    const r = await window.kh1.translate.autoWrap({ texts, maxWidth, knjData });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }
    let changed = 0, addedLfs = 0;
    for (let k = 0; k < slotIdxs.length; k++) {
      const i = slotIdxs[k];
      const before = tState.slots[i].ukText;
      const after = r.wrapped[k];
      if (after && after !== before) {
        tState.slots[i].ukText = after;
        changed++;
        const beforeLfs = (before.match(/\{lf\}/g) || []).length;
        const afterLfs = (after.match(/\{lf\}/g) || []).length;
        addedLfs += Math.max(0, afterLfs - beforeLfs);
      }
    }
    if (changed) {
      tState.dirty = true;
      renderRows();
      refreshProgress();
      scheduleTsvAutoSave();
    }
    toast(window.i18n.t('toastAutoWrapDone', { changed, lfs: addedLfs }), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}
tSettingsBtn.addEventListener('click', openSettings);

// Subtabs
tabFiles.addEventListener('click', () => setSubtab('files'));
tabGlossary.addEventListener('click', () => setSubtab('glossary'));

// Glossary controls
gBuild.addEventListener('click', buildGlossary);
gImport.addEventListener('click', importTranslations);
gSearch.addEventListener('input', (e) => {
  gState.filter.search = e.target.value;
  applyGlossaryFilter();
});
gFilterMode.addEventListener('change', (e) => {
  gState.filter.mode = e.target.value;
  applyGlossaryFilter();
});
gSave.addEventListener('click', () => saveGlossary(false));
gComposeAll.addEventListener('click', composeAllFiles);

// =====================================================================
// Validate tokens — пошук перекладів з втраченими токенами
// =====================================================================
function countGlossaryTokenIssues() {
  let total = 0, bad = 0;
  for (const en of Object.keys(gState.translations)) {
    const uk = gState.translations[en];
    if (!uk) continue;
    total++;
    if (!validateTokens(en, uk).ok) bad++;
  }
  return { total, bad };
}

const gValidateBtn = document.getElementById('g-validate');
const gAutoWrapBtn = document.getElementById('g-autowrap');
const gMaxWidthInput = document.getElementById('g-maxwidth');

async function autoWrapGlossary() {
  if (!kState.knjBuf) {
    toast(window.i18n.t('toastNeedKnj'), 'error', 6000); return;
  }
  const entries = Object.entries(gState.translations).filter(([en, uk]) => uk && uk.trim());
  if (!entries.length) {
    toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
  }
  // Adaptive: для кожного запису беремо maxWidth з найдовшого EN-рядка.
  // UK розмотується (видаляються попередні {lf}) і wrap'иться під ту саму ширину.
  // minWidth для дуже коротких EN береться з input (default 250).
  const minWidth = Math.max(100, Math.min(900, parseInt(gMaxWidthInput && gMaxWidthInput.value, 10) || 250));
  const pairs = entries.map(([en, uk]) => ({ en, uk }));
  const u8 = kState.knjBuf;
  const knjData = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  try {
    const r = await window.kh1.translate.autoWrapAdaptive({ pairs, knjData, minWidth, tolerance: 0 });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }
    let changed = 0, addedLfs = 0;
    for (let i = 0; i < entries.length; i++) {
      const [en, before] = entries[i];
      const after = r.wrapped[i];
      if (after && after !== before) {
        gState.translations[en] = after;
        changed++;
        const beforeLfs = (before.match(/\{lf\}/g) || []).length;
        const afterLfs = (after.match(/\{lf\}/g) || []).length;
        addedLfs += Math.max(0, afterLfs - beforeLfs);
      }
    }
    if (changed) {
      gState.dirty = true;
      // Synchronize в активний файл якщо він відкритий
      if (tState.currentRel) {
        for (const slot of tState.slots) {
          if (gState.translations[slot.english] && slot.ukText !== gState.translations[slot.english]) {
            slot.ukText = gState.translations[slot.english];
            tState.dirty = true;
          }
        }
        renderRows();
        refreshProgress();
      }
      renderGlossaryRows();
      refreshGlossaryProgress();
      scheduleGlossaryAutoSave();
    }
    toast(window.i18n.t('toastAutoWrapDone', { changed, lfs: addedLfs }), 'success', 6000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

if (gAutoWrapBtn) gAutoWrapBtn.addEventListener('click', autoWrapGlossary);

if (gValidateBtn) {
  gValidateBtn.addEventListener('click', () => {
    const { total, bad } = countGlossaryTokenIssues();
    if (bad === 0) {
      toast(window.i18n.t('toastValidateClean', { n: total }), 'success', 5000);
      return;
    }
    toast(window.i18n.t('toastValidateBad', { n: bad, total }), 'error', 7000);
    // Switch to glossary view + filter to show only problematic entries via search hack
    setSubtab('glossary');
    // Re-render so token-warn classes are re-applied (in case glossary loaded fresh)
    renderGlossaryRows();
  });
}

const gCleanBrokenBtn = document.getElementById('g-clean-broken');
if (gCleanBrokenBtn) {
  gCleanBrokenBtn.addEventListener('click', () => {
    const broken = [];
    for (const en of Object.keys(gState.translations)) {
      const uk = gState.translations[en];
      if (!uk) continue;
      if (!validateTokens(en, uk).ok) broken.push(en);
    }
    if (!broken.length) {
      toast(window.i18n.t('toastValidateClean', { n: Object.keys(gState.translations).length }), 'success', 4000);
      return;
    }
    const sample = broken.slice(0, 3).map(en => '• ' + en.slice(0, 60) + (en.length > 60 ? '…' : ''));
    const msg = window.i18n.t('confirmCleanBroken', { n: broken.length }) +
      '\n\n' + sample.join('\n') +
      (broken.length > 3 ? '\n…' : '');
    if (!confirm(msg)) return;
    for (const en of broken) delete gState.translations[en];
    gState.dirty = true;
    renderGlossaryRows();
    refreshGlossaryProgress();
    scheduleGlossaryAutoSave();
    toast(window.i18n.t('toastCleanBrokenDone', { n: broken.length }), 'success', 5000);
  });
}

modeEditorBtn.addEventListener('click', () => setMode('editor'));
modeTranslateBtn.addEventListener('click', () => setMode('translate'));
modeKerningBtn.addEventListener('click', () => setMode('kerning'));

// =====================================================================
// Kerning Editor (.knj) — окремий режим з DDS-атласом
// =====================================================================
const ATLAS_W = 1024;
const ATLAS_H = 1024;
const CELL_W = 48;
const CELL_H = 64;
const COLS = Math.floor(ATLAS_W / CELL_W); // 21
const ROWS = Math.floor(ATLAS_H / CELL_H); // 16
const MAX_GLYPHS = 230;
const KERNING_OFFSET = 0x40080;
const SCALE = 2; // canvas рендериться у 2x для чіткості та зручності drag

const kState = {
  knjPath: null,
  knjBuf: null,        // Uint8Array — повний файл
  ddsPath: null,
  atlasPx: null,       // Uint8ClampedArray RGBA для всього atlas (1024*1024*4)
  glyphs: [],          // { idx, x, y, byteValue, originalByte, canvas }
  dirty: false,
  filterText: '',
  charMap: null        // { byte: char } — завантажується через IPC
};

async function kEnsureCharMap() {
  if (kState.charMap) return;
  try {
    const r = await window.kh1.app.getCharMap();
    if (r.ok) kState.charMap = r.map;
    else kState.charMap = {};
  } catch (_) { kState.charMap = {}; }
}

function kGlyphLabel(idx) {
  const byte = idx + BYTE_GLYPH_OFFSET;
  let ch = kState.charMap ? kState.charMap[byte] : '';
  if (typeof ch !== 'string' || !ch) return '#' + idx;
  // Ховаємо технічні токени типу {Potion}, {III} — для них char = '{...}'
  if (ch.length > 1 && ch.startsWith('{')) return '#' + idx;
  return '#' + idx + ' (' + ch + ')';
}

const kLoadKnjBtn = document.getElementById('k-load-knj');
const kLoadDdsBtn = document.getElementById('k-load-dds');
const kSaveKnjBtn = document.getElementById('k-save-knj');
const kResetBtn = document.getElementById('k-reset-changes');
const kAutoFitBtn = document.getElementById('k-autofit');
const kThresholdInput = document.getElementById('k-threshold');
function kCurrentThreshold() {
  if (!kThresholdInput) return 96;
  const v = parseInt(kThresholdInput.value, 10);
  if (!Number.isFinite(v)) return 96;
  return Math.max(1, Math.min(255, v));
}
const kFilter = document.getElementById('k-filter');
const kGridWrap = document.getElementById('k-grid-wrap');
const kStatus = document.getElementById('k-status');
const kInfo = document.getElementById('k-info');
const kPreviewText = document.getElementById('k-preview-text');
const kPreviewCanvas = document.getElementById('k-preview-canvas');
const kPreviewBg = document.getElementById('k-preview-bg');
const kPreviewInfo = document.getElementById('k-preview-info');

function kFilenameFromPath(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

// --- DDS decoding ---
function decodeDds(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 128) throw new Error('DDS файл закороткий');
  if (!(u8[0] === 0x44 && u8[1] === 0x44 && u8[2] === 0x53 && u8[3] === 0x20)) {
    throw new Error('Це не DDS-файл (нема магії "DDS ")');
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const height = dv.getUint32(0x0C, true);
  const width = dv.getUint32(0x10, true);
  const pfFlags = dv.getUint32(0x50, true);
  const fourCC = String.fromCharCode(u8[0x54], u8[0x55], u8[0x56], u8[0x57]);
  const bitCount = dv.getUint32(0x58, true);
  const rMask = dv.getUint32(0x5C, true);
  const gMask = dv.getUint32(0x60, true);
  const bMask = dv.getUint32(0x64, true);
  const aMask = dv.getUint32(0x68, true);

  // Uncompressed RGB/RGBA (фізичний формат у нашому кейсі)
  if ((pfFlags & 0x40) && bitCount === 32) {
    const expected = 128 + width * height * 4;
    if (u8.length < expected) {
      throw new Error('DDS дані обірвані: чекали ' + expected + ', отримано ' + u8.length);
    }
    return decodeUncompressed32(u8, width, height, rMask, gMask, bMask, aMask);
  }
  // FourCC compressed
  if (pfFlags & 0x4) {
    if (fourCC === 'DXT5' || fourCC === 'DXT4' || fourCC === 'NVT3') {
      return decodeBC3(u8.subarray(128), width, height);
    }
    if (fourCC === 'DXT1') {
      return decodeBC1(u8.subarray(128), width, height);
    }
    throw new Error('Непідтримуваний DDS fourCC: ' + fourCC);
  }
  throw new Error('Невідомий DDS pixel format (flags=0x' + pfFlags.toString(16) + ')');
}

function decodeUncompressed32(u8, w, h, rMask, gMask, bMask, aMask) {
  const px = new Uint8ClampedArray(w * h * 4);
  // Знайти shift для кожної маски
  const shiftOf = (m) => { let s = 0; while (m && !(m & 1)) { m >>>= 1; s++; } return s; };
  const rs = shiftOf(rMask), gs = shiftOf(gMask), bs = shiftOf(bMask), as = shiftOf(aMask);
  for (let i = 0; i < w * h; i++) {
    const off = 128 + i * 4;
    const v = u8[off] | (u8[off+1] << 8) | (u8[off+2] << 16) | (u8[off+3] << 24);
    const dst = i * 4;
    px[dst]   = (v & rMask) >>> rs;
    px[dst+1] = (v & gMask) >>> gs;
    px[dst+2] = (v & bMask) >>> bs;
    px[dst+3] = aMask ? ((v & aMask) >>> as) : 255;
  }
  return { width: w, height: h, data: px };
}

function decodeBC3(data, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  const blocksW = w >> 2, blocksH = h >> 2;
  let pos = 0;
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      // 8 байт alpha
      const a0 = data[pos], a1 = data[pos+1];
      const aBits = data[pos+2] | (data[pos+3] << 8) | (data[pos+4] << 16) |
                    (data[pos+5] << 24) | (data[pos+6] * 0x100000000) | (data[pos+7] * 0x10000000000);
      const alphas = new Uint8Array(8);
      alphas[0] = a0; alphas[1] = a1;
      if (a0 > a1) {
        for (let k = 1; k < 7; k++) alphas[k+1] = ((7 - k) * a0 + k * a1) / 7 | 0;
      } else {
        for (let k = 1; k < 5; k++) alphas[k+1] = ((5 - k) * a0 + k * a1) / 5 | 0;
        alphas[6] = 0; alphas[7] = 255;
      }
      // 8 байт color (DXT1 logic)
      const c0 = data[pos+8] | (data[pos+9] << 8);
      const c1 = data[pos+10] | (data[pos+11] << 8);
      const cBits = data[pos+12] | (data[pos+13] << 8) | (data[pos+14] << 16) | (data[pos+15] << 24);
      const r0 = ((c0 >> 11) & 0x1F) << 3, g0 = ((c0 >> 5) & 0x3F) << 2, b0 = (c0 & 0x1F) << 3;
      const r1 = ((c1 >> 11) & 0x1F) << 3, g1 = ((c1 >> 5) & 0x3F) << 2, b1 = (c1 & 0x1F) << 3;
      const colors = [
        [r0, g0, b0], [r1, g1, b1],
        [(2*r0 + r1)/3 | 0, (2*g0 + g1)/3 | 0, (2*b0 + b1)/3 | 0],
        [(r0 + 2*r1)/3 | 0, (g0 + 2*g1)/3 | 0, (b0 + 2*b1)/3 | 0]
      ];
      for (let py = 0; py < 4; py++) {
        for (let px4 = 0; px4 < 4; px4++) {
          const ci = (cBits >> ((py * 4 + px4) * 2)) & 0x3;
          // BC3 alpha: 3 bit per pixel в 48-bit aBits
          const ai = Number((BigInt(data[pos+2] | (data[pos+3]<<8) | (data[pos+4]<<16))
                            | (BigInt(data[pos+5] | (data[pos+6]<<8) | (data[pos+7]<<16)) << 24n))
                          >> BigInt((py * 4 + px4) * 3)) & 0x7;
          const c = colors[ci];
          const dx = bx * 4 + px4, dy = by * 4 + py;
          const dst = (dy * w + dx) * 4;
          px[dst] = c[0]; px[dst+1] = c[1]; px[dst+2] = c[2]; px[dst+3] = alphas[ai];
        }
      }
      pos += 16;
    }
  }
  return { width: w, height: h, data: px };
}

function decodeBC1(data, w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  const blocksW = w >> 2, blocksH = h >> 2;
  let pos = 0;
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      const c0 = data[pos] | (data[pos+1] << 8);
      const c1 = data[pos+2] | (data[pos+3] << 8);
      const cBits = data[pos+4] | (data[pos+5] << 8) | (data[pos+6] << 16) | (data[pos+7] << 24);
      const r0 = ((c0 >> 11) & 0x1F) << 3, g0 = ((c0 >> 5) & 0x3F) << 2, b0 = (c0 & 0x1F) << 3;
      const r1 = ((c1 >> 11) & 0x1F) << 3, g1 = ((c1 >> 5) & 0x3F) << 2, b1 = (c1 & 0x1F) << 3;
      const colors = c0 > c1
        ? [[r0,g0,b0],[r1,g1,b1],[(2*r0+r1)/3|0,(2*g0+g1)/3|0,(2*b0+b1)/3|0],[(r0+2*r1)/3|0,(g0+2*g1)/3|0,(b0+2*b1)/3|0]]
        : [[r0,g0,b0],[r1,g1,b1],[(r0+r1)/2|0,(g0+g1)/2|0,(b0+b1)/2|0],[0,0,0]];
      for (let py = 0; py < 4; py++) {
        for (let px4 = 0; px4 < 4; px4++) {
          const ci = (cBits >> ((py * 4 + px4) * 2)) & 0x3;
          const c = colors[ci];
          const dx = bx * 4 + px4, dy = by * 4 + py;
          const dst = (dy * w + dx) * 4;
          px[dst] = c[0]; px[dst+1] = c[1]; px[dst+2] = c[2]; px[dst+3] = 255;
        }
      }
      pos += 8;
    }
  }
  return { width: w, height: h, data: px };
}

// --- Renderer ---
function kBuildGlyphList() {
  kState.glyphs = [];
  for (let i = 0; i < MAX_GLYPHS; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const byte = kState.knjBuf ? kState.knjBuf[KERNING_OFFSET + i] : 0;
    kState.glyphs.push({
      idx: i,
      x: col * CELL_W,
      y: row * CELL_H,
      byteValue: byte,
      originalByte: byte,
      canvas: null
    });
  }
}

function kDrawGlyph(canvas, g) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Темне тло
  ctx.fillStyle = '#1a2848';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Atlas crop
  if (kState.atlasPx) {
    const w = kState.atlasPx.width, h = kState.atlasPx.height;
    const cellData = new ImageData(CELL_W, CELL_H);
    for (let row = 0; row < CELL_H; row++) {
      for (let col = 0; col < CELL_W; col++) {
        const sx = g.x + col, sy = g.y + row;
        if (sx >= w || sy >= h) continue;
        const srcOff = (sy * w + sx) * 4;
        const dstOff = (row * CELL_W + col) * 4;
        cellData.data[dstOff]   = kState.atlasPx.data[srcOff];
        cellData.data[dstOff+1] = kState.atlasPx.data[srcOff+1];
        cellData.data[dstOff+2] = kState.atlasPx.data[srcOff+2];
        cellData.data[dstOff+3] = kState.atlasPx.data[srcOff+3];
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = CELL_W; tmp.height = CELL_H;
    tmp.getContext('2d').putImageData(cellData, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }
  // Тонка вертикальна сітка кожні 8 px
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let px = 8; px < CELL_W; px += 8) {
    const x = px * SCALE;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  // Червона лінія advance-width = byteValue * 2 px
  const advancePx = g.byteValue * 2;
  const lineX = advancePx * SCALE + 0.5;
  ctx.strokeStyle = '#ff5566';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(255,80,100,0.7)';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(lineX, 0);
  ctx.lineTo(lineX, canvas.height);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Жовта рамка якщо змінено
  if (g.byteValue !== g.originalByte) {
    ctx.strokeStyle = '#f4c430';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  }
}

function kAttachDrag(canvas, g, valueLabel, input) {
  function setFromX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const localX = (clientX - rect.left) / rect.width * canvas.width;
    let advancePx = Math.round(localX / SCALE);
    if (advancePx < 0) advancePx = 0;
    let byte = Math.round(advancePx / 2);
    if (byte > 24) byte = 24;
    if (byte < 0) byte = 0;
    if (g.byteValue !== byte) {
      g.byteValue = byte;
      kState.knjBuf[KERNING_OFFSET + g.idx] = byte;
      kState.dirty = true;
      input.value = byte;
      valueLabel.textContent = (byte * 2) + ' px (b=' + byte + ')';
      kDrawGlyph(canvas, g);
      kRefreshStatus();
      if (typeof kSchedulePreview === 'function') kSchedulePreview();
    }
  }
  let dragging = false;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    setFromX(e.clientX);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (dragging) setFromX(e.clientX);
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

function kParseFilter(text) {
  // Підтримує "0-50, 100, 120-130"
  if (!text || !text.trim()) return null;
  const set = new Set();
  for (const part of text.split(/[,\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = Math.min(a,b); i <= Math.max(a,b); i++) set.add(i);
  }
  return set.size ? set : null;
}

function kRenderGrid() {
  kGridWrap.innerHTML = '';
  if (!kState.knjBuf) {
    kGridWrap.innerHTML = '<div class="t-empty"><p>Спершу завантажте .knj-файл.</p></div>';
    return;
  }
  // ensure charMap loaded asynchronously; if not yet, draw now and re-render after fetch
  if (!kState.charMap) {
    kEnsureCharMap().then(() => kRenderGrid());
  }
  const grid = document.createElement('div');
  grid.className = 'k-grid';
  const filter = kParseFilter(kState.filterText);
  for (const g of kState.glyphs) {
    if (filter && !filter.has(g.idx)) continue;
    const cell = document.createElement('div');
    cell.className = 'k-cell';
    cell.dataset.idx = g.idx;

    const canvas = document.createElement('canvas');
    canvas.width = CELL_W * SCALE;
    canvas.height = CELL_H * SCALE;
    canvas.className = 'k-canvas';
    g.canvas = canvas;

    const headLabel = document.createElement('div');
    headLabel.className = 'k-head';
    headLabel.textContent = kGlyphLabel(g.idx);

    const valueLabel = document.createElement('div');
    valueLabel.className = 'k-value';
    let labelText = (g.byteValue * 2) + ' px (b=' + g.byteValue + ')';
    if (kState.atlasPx) {
      const right = kFindGlyphRightEdge(g);
      if (right >= 0) labelText += ' · max=' + (right + 1) + 'px';
    }
    valueLabel.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '24';
    input.value = g.byteValue;
    input.className = 'k-input';
    input.addEventListener('input', () => {
      let v = parseInt(input.value, 10);
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, Math.min(24, v));
      if (g.byteValue !== v) {
        g.byteValue = v;
        kState.knjBuf[KERNING_OFFSET + g.idx] = v;
        kState.dirty = true;
        valueLabel.textContent = (v * 2) + ' px (b=' + v + ')';
        kDrawGlyph(canvas, g);
        kRefreshStatus();
        if (typeof kSchedulePreview === 'function') kSchedulePreview();
      }
    });

    cell.appendChild(headLabel);
    cell.appendChild(canvas);
    cell.appendChild(valueLabel);
    cell.appendChild(input);
    grid.appendChild(cell);

    kDrawGlyph(canvas, g);
    kAttachDrag(canvas, g, valueLabel, input);
  }
  kGridWrap.appendChild(grid);
}

function kRefreshStatus() {
  const changed = kState.glyphs.filter(g => g.byteValue !== g.originalByte).length;
  kStatus.textContent = (kState.knjPath ? kFilenameFromPath(kState.knjPath) : 'не завантажено') +
    (kState.dirty ? ' *' : '') +
    ' · DDS: ' + (kState.atlasPx ? kFilenameFromPath(kState.ddsPath) : 'не завантажено');
  kInfo.textContent = 'Гліфів: ' + kState.glyphs.length + ' · змінено: ' + changed;
  kSaveKnjBtn.disabled = !kState.dirty;
  kResetBtn.disabled = changed === 0;
  if (kAutoFitBtn) kAutoFitBtn.disabled = !kState.knjBuf || !kState.atlasPx;
}

async function kLoadKnj() {
  try {
    const r = await window.kh1.kerning.openKnj();
    if (r.canceled) return;
    if (r.error || !r.ok) { toast(window.i18n.t('toastError', {msg: r.error || '?'}), 'error'); return; }
    kState.knjPath = r.filePath;
    kState.knjBuf = new Uint8Array(r.data);
    kState.dirty = false;
    kBuildGlyphList();
    kRenderGrid();
    kRefreshStatus();
    if (typeof kSchedulePreview === 'function') kSchedulePreview();
    toast(window.i18n.t('toastKnjLoaded', {file: kFilenameFromPath(r.filePath), n: r.data.byteLength}), 'success');
    // Auto-find DDS поряд
    try {
      const a = await window.kh1.kerning.autoFindDds(r.filePath);
      if (a.ok) {
        kState.ddsPath = a.filePath;
        kState.atlasPx = decodeDds(a.data);
        kRenderGrid();
        kRefreshStatus();
        toast(window.i18n.t('toastKnjAutoDds', {file: kFilenameFromPath(a.filePath)}), 'info', 4000);
      }
    } catch (e) {
      toast(window.i18n.t('toastKnjDdsFoundFail', {msg: e.message}), 'error', 6000);
    }
  } catch (e) {
    toast(window.i18n.t('toastLoadError', {msg: e.message}), 'error');
  }
}

async function kLoadDds() {
  try {
    const suggestedDir = kState.knjPath ? kState.knjPath.substring(0, kState.knjPath.lastIndexOf(/[\\/]/.test(kState.knjPath) ? (kState.knjPath.match(/[\\/]/g) ? kState.knjPath.lastIndexOf(kState.knjPath.match(/[\\/]/g).pop()) : 0) : 0)) : null;
    const r = await window.kh1.kerning.openDds(kState.knjPath || undefined);
    if (r.canceled) return;
    if (r.error || !r.ok) { toast(window.i18n.t('toastError', {msg: r.error || '?'}), 'error'); return; }
    kState.ddsPath = r.filePath;
    try {
      kState.atlasPx = decodeDds(r.data);
    } catch (e) {
      toast(window.i18n.t('toastDdsDecodeFail', {msg: e.message}), 'error', 7000);
      kState.atlasPx = null;
      return;
    }
    kRenderGrid();
    kRefreshStatus();
    if (typeof kSchedulePreview === 'function') kSchedulePreview();
    toast(window.i18n.t('toastKnjDdsLoaded', {file: kFilenameFromPath(r.filePath), w: kState.atlasPx.width, h: kState.atlasPx.height}), 'success');
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error');
  }
}

async function kSaveKnj() {
  if (!kState.knjBuf) return;
  try {
    const r = await window.kh1.kerning.saveKnj({
      suggestedPath: kState.knjPath || 'output.knj',
      data: kState.knjBuf.buffer.slice(kState.knjBuf.byteOffset, kState.knjBuf.byteOffset + kState.knjBuf.byteLength)
    });
    if (r.canceled) return;
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error'); return; }
    kState.dirty = false;
    for (const g of kState.glyphs) g.originalByte = g.byteValue;
    kState.knjPath = r.filePath;
    kRenderGrid();
    kRefreshStatus();
    if (typeof kSchedulePreview === 'function') kSchedulePreview();
    toast(window.i18n.t('toastSavedKnj', {path: r.filePath, n: r.byteLength}), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastSaveError', {msg: e.message}), 'error');
  }
}

// Знайти найправіший непрозорий піксел у тайлі гліфа.
// Повертає -1 якщо тайл порожній.
function kFindGlyphRightEdge(g, alphaThreshold) {
  if (!kState.atlasPx) return -1;
  const w = kState.atlasPx.width, h = kState.atlasPx.height;
  const data = kState.atlasPx.data;
  const ax = g.x, ay = g.y;
  // Threshold з input (default 96) — ігнорує anti-aliased «тіні» на краях
  const thr = (typeof alphaThreshold === 'number') ? alphaThreshold : kCurrentThreshold();
  let rightmost = -1;
  for (let row = 0; row < CELL_H; row++) {
    const sy = ay + row;
    if (sy >= h) break;
    for (let col = CELL_W - 1; col > rightmost; col--) {
      const sx = ax + col;
      if (sx >= w) continue;
      const a = data[(sy * w + sx) * 4 + 3];
      if (a >= thr) { rightmost = col; break; }
    }
    if (rightmost === CELL_W - 1) break;
  }
  return rightmost;
}

// Повертає рекомендоване значення байту (0..24) для гліфа з ~1 px gap.
function kSuggestAdvance(g) {
  const right = kFindGlyphRightEdge(g);
  if (right < 0) return 0; // порожній — пробіл-style 0 (або залишити як було?)
  const px = right + 2; // +1 px gap
  let byte = Math.round(px / 2);
  if (byte < 1) byte = 1;
  if (byte > 24) byte = 24;
  return byte;
}

async function kAutoFitAll() {
  if (!kState.knjBuf) { toast(window.i18n.t('toastError', {msg: '.knj not loaded'}), 'error'); return; }
  if (!kState.atlasPx) { toast(window.i18n.t('toastNeedAtlas'), 'error'); return; }
  let changed = 0, kept = 0, empty = 0;
  for (const g of kState.glyphs) {
    const right = kFindGlyphRightEdge(g);
    if (right < 0) {
      // Порожній тайл — лишаємо як є
      empty++;
      continue;
    }
    const byte = kSuggestAdvance(g);
    if (byte !== g.byteValue) {
      g.byteValue = byte;
      kState.knjBuf[KERNING_OFFSET + g.idx] = byte;
      changed++;
    } else {
      kept++;
    }
  }
  if (changed > 0) kState.dirty = true;
  kRenderGrid();
  kRefreshStatus();
  if (typeof kSchedulePreview === 'function') kSchedulePreview();
  toast(window.i18n.t('toastAutoFitDone', { changed, kept, empty }), 'success', 5000);
}

function kResetChanges() {
  for (const g of kState.glyphs) {
    if (g.byteValue !== g.originalByte) {
      g.byteValue = g.originalByte;
      kState.knjBuf[KERNING_OFFSET + g.idx] = g.byteValue;
    }
  }
  kState.dirty = false;
  kRenderGrid();
  kRefreshStatus();
  toast(window.i18n.t('toastResetDone'), 'info');
}

kLoadKnjBtn.addEventListener('click', kLoadKnj);
kLoadDdsBtn.addEventListener('click', kLoadDds);
kSaveKnjBtn.addEventListener('click', kSaveKnj);
kResetBtn.addEventListener('click', kResetChanges);
if (kAutoFitBtn) kAutoFitBtn.addEventListener('click', kAutoFitAll);
if (kThresholdInput) {
  kThresholdInput.addEventListener('change', () => {
    if (kState.knjBuf) kRenderGrid();
  });
}
kFilter.addEventListener('input', () => {
  kState.filterText = kFilter.value;
  kRenderGrid();
});

// =====================================================================
// Live-preview: encode text → KH1 bytes → render tiles with advance-width
// =====================================================================
let _kPreviewTimer = null;
function kSchedulePreview() {
  if (_kPreviewTimer) clearTimeout(_kPreviewTimer);
  _kPreviewTimer = setTimeout(kRenderPreview, 120);
}

// Atlas починається з byte 32 (перші 32 — control bytes, не мають гліфів)
const BYTE_GLYPH_OFFSET = 32;
function kComputeGlyphRect(byte) {
  const idx = byte - BYTE_GLYPH_OFFSET;
  if (idx < 0 || idx >= MAX_GLYPHS) return null;
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  return { x: col * CELL_W, y: row * CELL_H };
}

async function kRenderPreview() {
  if (!kPreviewCanvas) return;
  const ctx = kPreviewCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Розтягнути canvas-px під реальну ширину
  const cssW = kPreviewCanvas.clientWidth || 1100;
  if (kPreviewCanvas.width !== cssW) kPreviewCanvas.width = cssW;
  ctx.clearRect(0, 0, kPreviewCanvas.width, kPreviewCanvas.height);

  const text = kPreviewText ? kPreviewText.value : '';
  if (!text) {
    ctx.fillStyle = '#9cb3d8';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(window.i18n.t('previewEmpty'), 12, 30);
    if (kPreviewInfo) kPreviewInfo.textContent = '—';
    return;
  }
  if (!kState.atlasPx) {
    ctx.fillStyle = '#fbbf24';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(window.i18n.t('previewNoAtlas'), 12, 30);
    return;
  }
  if (!kState.knjBuf) return;

  let bytes = [];
  try {
    const r = await window.kh1.kerning.encodeText(text);
    if (!r.ok) {
      ctx.fillStyle = '#f87171';
      ctx.font = '13px "Cascadia Code", monospace';
      ctx.fillText('encode error: ' + (r.error || '?'), 12, 30);
      return;
    }
    bytes = r.bytes;
  } catch (e) {
    ctx.fillStyle = '#f87171';
    ctx.fillText('IPC error: ' + e.message, 12, 30);
    return;
  }

  const SCALE_PV = 1.5; // 1.5x для читабельності
  const baselineY = (kPreviewCanvas.height - CELL_H * SCALE_PV) / 2;
  const atlasW = kState.atlasPx.width;
  let x = 8;
  let totalWidth = 0;
  let drawn = 0;
  const tmp = document.createElement('canvas');
  tmp.width = CELL_W; tmp.height = CELL_H;
  const tctx = tmp.getContext('2d');

  const SPACE_PX = 10; // фіксована ширина пробілу для preview
  for (const byte of bytes) {
    if (byte === 0x00) continue; // sentinel/end-of-string
    if (byte === 0x01) { // пробіл
      x += SPACE_PX * SCALE_PV;
      totalWidth += SPACE_PX;
      drawn++;
      if (x > kPreviewCanvas.width - CELL_W) break;
      continue;
    }
    if (byte === 0x02) { // {lf} — м'який перенос рядка, для preview просто зсуваємо
      x += SPACE_PX * SCALE_PV;
      continue;
    }
    const rect = kComputeGlyphRect(byte);
    if (!rect) continue;
    const glyphIdx = byte - BYTE_GLYPH_OFFSET;
    const advance = (kState.knjBuf[KERNING_OFFSET + glyphIdx] || 0) * 2;
    if (advance === 0) continue;
    // Витягуємо тайл
    const tile = new ImageData(CELL_W, CELL_H);
    for (let row = 0; row < CELL_H; row++) {
      for (let col = 0; col < CELL_W; col++) {
        const sx = rect.x + col, sy = rect.y + row;
        if (sx >= atlasW || sy >= kState.atlasPx.height) continue;
        const so = (sy * atlasW + sx) * 4;
        const dt = (row * CELL_W + col) * 4;
        tile.data[dt]   = kState.atlasPx.data[so];
        tile.data[dt+1] = kState.atlasPx.data[so+1];
        tile.data[dt+2] = kState.atlasPx.data[so+2];
        tile.data[dt+3] = kState.atlasPx.data[so+3];
      }
    }
    tctx.clearRect(0, 0, CELL_W, CELL_H);
    tctx.putImageData(tile, 0, 0);
    ctx.drawImage(tmp, x, baselineY, CELL_W * SCALE_PV, CELL_H * SCALE_PV);
    // Маркер advance — тонка червона лінія знизу
    const advanceX = x + advance * SCALE_PV;
    ctx.strokeStyle = 'rgba(255, 80, 100, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(advanceX, baselineY + CELL_H * SCALE_PV);
    ctx.lineTo(advanceX, baselineY + CELL_H * SCALE_PV + 6);
    ctx.stroke();
    x += advance * SCALE_PV;
    totalWidth += advance;
    drawn++;
    if (x > kPreviewCanvas.width - CELL_W) break;
  }
  if (kPreviewInfo) {
    kPreviewInfo.textContent = window.i18n.t('previewInfo', { n: drawn, w: totalWidth });
  }
}

if (kPreviewText) {
  kPreviewText.addEventListener('input', kSchedulePreview);
}
// Re-render on window resize so canvas pixel-size matches CSS width (fixed-scale text)
window.addEventListener('resize', () => {
  if (state.mode === 'kerning') kSchedulePreview();
});
if (kPreviewBg) {
  kPreviewBg.addEventListener('change', () => {
    kPreviewCanvas.classList.toggle('transparent-bg', !kPreviewBg.checked);
  });
  // Init: dark by default
  kPreviewCanvas.classList.toggle('transparent-bg', !kPreviewBg.checked);
}

// =====================================================================
// Wire up — editor + global
// =====================================================================
btnOpen.addEventListener('click', doOpen);
btnSave.addEventListener('click', doSave);
btnFind.addEventListener('click', () => { if (!btnFind.disabled) showFind(); });

findNextBtn.addEventListener('click', () => performFind(true));
findCancelBtn.addEventListener('click', hideFind);

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); performFind(true); }
  else if (e.key === 'Escape') { e.preventDefault(); hideFind(); }
});

aboutCloseBtn.addEventListener('click', hideAbout);

[findOverlay, aboutOverlay].forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!findOverlay.classList.contains('hidden')) { hideFind(); return; }
    if (!aboutOverlay.classList.contains('hidden')) { hideAbout(); return; }
    if (!settingsOverlay.classList.contains('hidden')) { hideSettings(); return; }
    if (!importOverlay.classList.contains('hidden')) { hideImport(); return; }
  }
});

// Menu handlers — context-aware Ctrl+S
window.kh1.onMenu('menu:open', () => {
  if (state.mode === 'editor') doOpen();
});
window.kh1.onMenu('menu:save', () => {
  if (state.mode === 'editor') doSave();
  else if (state.mode === 'translate') saveTsvProgress();
});
window.kh1.onMenu('menu:find', () => {
  if (state.mode === 'editor' && !btnFind.disabled) showFind();
  else if (state.mode === 'translate') { tSearchInput.focus(); tSearchInput.select(); }
});
window.kh1.onMenu('menu:find-next', () => {
  if (state.mode === 'editor' && !btnFind.disabled) findNextFromShortcut();
});
window.kh1.onMenu('menu:about', showAbout);
window.kh1.onMenu('menu:replace', () => { if (state.mode === 'translate') showReplace(); });
window.kh1.onMenu('menu:mode-editor', () => setMode('editor'));
window.kh1.onMenu('menu:mode-translate', () => setMode('translate'));
window.kh1.onMenu('menu:mode-kerning', () => setMode('kerning'));

// =====================================================================
// i18n: language switcher + initial apply
// =====================================================================
const langSelect = document.getElementById('lang-select');

async function initLanguage() {
  try {
    const s = await window.kh1.translate.getSettings();
    const lang = (s && s.language) || (navigator.language || 'uk').slice(0, 2);
    const finalLang = (lang === 'en') ? 'en' : 'uk';
    if (window.i18n) window.i18n.setLang(finalLang);
    if (langSelect) langSelect.value = finalLang;
  } catch (_) {
    if (window.i18n) window.i18n.setLang('uk');
  }
}

if (langSelect) {
  langSelect.addEventListener('change', async () => {
    const lang = langSelect.value === 'en' ? 'en' : 'uk';
    if (window.i18n) window.i18n.setLang(lang);
    try { await window.kh1.translate.saveSettings({ language: lang }); } catch (_) {}
    try { await window.kh1.app.setLanguage(lang); } catch (_) {}
  });
}

initLanguage();

// =====================================================================
// Auto-update wiring (toast notifications + download/install dialogs)
// =====================================================================
let _updateAvailableInfo = null;
let _updateInProgress = false;

if (window.kh1.app && window.kh1.app.onUpdate) {
  window.kh1.app.onUpdate('update:available', (info) => {
    _updateAvailableInfo = info;
    if (info && info.portable) {
      // Portable: показуємо banner з посиланням
      const msg = window.i18n.t('toastUpdatePortable', { v: info.version });
      toast(msg, 'info', 12000);
      // Запропонувати відкрити сторінку
      setTimeout(() => {
        if (window.confirm(window.i18n.t('updateOpenReleasePage', { v: info.version }))) {
          window.kh1.app.openExternal(info.repo);
        }
      }, 200);
    } else {
      const msg = window.i18n.t('toastUpdateAvailable', { v: info.version });
      toast(msg, 'info', 12000);
      setTimeout(() => {
        if (window.confirm(window.i18n.t('updateDownloadConfirm', { v: info.version }))) {
          _updateInProgress = true;
          window.kh1.app.downloadUpdate();
        }
      }, 200);
    }
  });
  window.kh1.app.onUpdate('update:none', () => {
    if (_updateCheckedManually) toast(window.i18n.t('toastUpdateNone'), 'success', 4000);
  });
  window.kh1.app.onUpdate('update:error', (e) => {
    // Silent при автоматичній перевірці — багато причин може бути legitimate
    // (portable, dev-build без app-update.yml, нема інтернету тощо)
    if (_updateCheckedManually) {
      toast(window.i18n.t('toastUpdateError', { msg: (e && e.message) || '?' }), 'error', 6000);
    } else if (window.console) {
      console.warn('[update] silent auto-check error:', e && e.message);
    }
  });
  window.kh1.app.onUpdate('update:progress', (p) => {
    if (!_updateInProgress) return;
    toast(window.i18n.t('toastUpdateProgress', { percent: p.percent }), 'info', 1800);
  });
  window.kh1.app.onUpdate('update:downloaded', (info) => {
    _updateInProgress = false;
    if (window.confirm(window.i18n.t('updateInstallConfirm', { v: info.version }))) {
      window.kh1.app.installUpdate();
    } else {
      toast(window.i18n.t('toastUpdateWillInstall'), 'info', 6000);
    }
  });
}

let _updateCheckedManually = false;
async function checkForUpdatesManual() {
  if (!window.kh1.app || !window.kh1.app.checkForUpdates) return;
  _updateCheckedManually = true;
  toast(window.i18n.t('toastUpdateChecking'), 'info', 3000);
  try {
    const r = await window.kh1.app.checkForUpdates();
    if (!r.ok) {
      toast(window.i18n.t('toastUpdateError', { msg: r.error || '?' }), 'error', 6000);
    }
    // success-кейси (available/none) обробляться через events вище
  } catch (e) {
    toast(window.i18n.t('toastUpdateError', { msg: e.message }), 'error', 6000);
  }
  setTimeout(() => { _updateCheckedManually = false; }, 5000);
}

// Auto-check at startup (silent — toast тільки якщо є оновлення)
setTimeout(() => {
  if (window.kh1.app && window.kh1.app.checkForUpdates) {
    window.kh1.app.checkForUpdates().catch(() => {});
  }
}, 3000);

// Menu hook + About modal will dispatch
window.kh1.onMenu('menu:check-updates', checkForUpdatesManual);

// init
refreshStatus();
updateCursor();
refreshProgress();
