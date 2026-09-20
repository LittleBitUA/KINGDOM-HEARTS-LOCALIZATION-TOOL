import { getCurrentGame, getCurrentGameFormats, getCurrentGameId } from '../app-shell.js';
import { gBuild, gComposeAll, gFilterMode, gImport, gSave, gSearch, gSortMode, tProgress, tSafeMode, tSettingsBtn, tStatus } from '../core/dom.js';
import { toast } from '../core/log.js';
import { gState, tState } from '../core/state.js';
import { openSettings } from '../settings-modal.js';
import { applyGlossaryFilter, buildGlossary, composeAllFiles, loadGlossaryFromDisk, refreshGlossaryProgress, renderGlossaryRows, saveGlossary } from './glossary.js';
import { importTranslations } from './import.js';
import { initWidths } from './width.js';

// =====================================================================
// Translate-режим: налаштування гри → список файлів → глосарій (єдиний
// робочий список: усі рядки гри у порядку файлів, дублікати згорнуті).
// =====================================================================
export async function initTranslateMode() {
  try {
    tState.settings = await window.kh1.translate.getSettings(getCurrentGameId()) || tState.settings;
  } catch (_) {}

  applyModuleTitle();

  // Source dir для списку файлів — для KH1 це rusDir, для BBS це engDir.
  const game = getCurrentGame();
  const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
  if (!tState.settings[sourceDirKey]) {
    tStatus.textContent = window.i18n.t('tStatusConfigure');
    openSettings();
    return;
  }

  await loadWorldsMap();
  await loadFileList();
  await loadGlossaryFromDisk();
  // метрики .knj для бейджів ширини (KH1) — до першого рендера
  try { await initWidths(); } catch (_) {}
  renderGlossaryRows();
  refreshGlossaryProgress();
  // Індекс не зберігається між запусками — будуємо одразу, це і є робочий екран.
  if (!gState.entries.length && tState.files.length && tState.settings.engDir) {
    buildGlossary().catch(() => {});
  }
}

// Заголовок модуля: KH1 — «Глосарій», BBS/Re:CoM/DDD — «Файли» (listTitleKey у gamesConfig).
export function applyModuleTitle() {
  const title = document.getElementById('t-module-title');
  if (!title) return;
  const g = getCurrentGame();
  const key = (g && g.listTitleKey) || 'tabGlossary';
  title.setAttribute('data-i18n', key);
  title.textContent = window.i18n ? window.i18n.t(key) : key;
}

// Завантаження карти світів (.ard → world / room name)
export let _worldsMap = null;
export async function loadWorldsMap() {
  if (_worldsMap) return _worldsMap;
  try {
    const r = await window.kh1.translate.getWorldsMap();
    if (r && r.ok) _worldsMap = r.map;
  } catch (_) {}
  return _worldsMap || {};
}
// describeFile(rel) → { world, room? } | null — світ/кімната KH1 за назвою .ard
export function describeFile(rel) {
  if (!_worldsMap) return null;
  // `kh1_second/al01.ard/…` → світ шукаємо за `al01.ard`
  const inner = window.KH.textStructure.kh1StripArchive(rel);
  const seg = (inner.split('/')[0] || '').toLowerCase();
  return _worldsMap[seg] || null;
}

// Список файлів гри (для індексу глосарію та збірки). Два фільтри:
// (а) safe-mode → лише isTranslatable, (б) game-formats → лише kind'и обраної гри.
export async function loadFileList() {
  const game = getCurrentGame();
  const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
  const sourceDir = tState.settings[sourceDirKey];
  if (!sourceDir) return;
  try {
    const r = await window.kh1.translate.listFiles(sourceDir);
    let files = (r.files || []).slice().sort((a, b) => a.rel.localeCompare(b.rel));
    const gameFormats = getCurrentGameFormats();
    if (gameFormats && gameFormats.length) files = files.filter(f => gameFormats.includes(f.kind));
    tState.files = files;
  } catch (e) {
    tState.files = [];
    toast(window.i18n.t('toastReadRusFail', {msg: e.message}), 'error');
  }
  const allCount = tState.files.length;
  const safeCount = tState.files.filter(f => f.isTranslatable).length;
  tStatus.textContent = tState.safeMode
    ? window.i18n.t('tStatusSafe', { safe: safeCount, unsafe: allCount - safeCount })
    : window.i18n.t('tStatusAll', { all: allCount, safe: safeCount });
}

tSafeMode.addEventListener('change', async (e) => {
  tState.safeMode = e.target.checked;
  if (!tState.safeMode) {
    if (!window.confirm(window.i18n.t('confirmUnsafeMode'))) {
      tSafeMode.checked = true;
      tState.safeMode = true;
      return;
    }
  }
  await loadFileList();
  // Індекс залежить від safe-режиму — перебудовуємо.
  if (tState.files.length && tState.settings.engDir) buildGlossary().catch(() => {});
});

// =====================================================================
// Auto-save глосарію з дебаунсом
// =====================================================================
export const AUTOSAVE_DELAY_MS = 1500;
export let _gAutoSaveTimer = null;
export function cancelAutoSaveTimers() {
  if (_gAutoSaveTimer) { clearTimeout(_gAutoSaveTimer); _gAutoSaveTimer = null; }
}

export function scheduleGlossaryAutoSave() {
  if (_gAutoSaveTimer) clearTimeout(_gAutoSaveTimer);
  if (!tState.settings.tsvDir) return;
  _gAutoSaveTimer = setTimeout(() => {
    _gAutoSaveTimer = null;
    if (gState.dirty) saveGlossary(true);
  }, AUTOSAVE_DELAY_MS);
}

export async function flushGlossaryAutoSave() {
  if (_gAutoSaveTimer) { clearTimeout(_gAutoSaveTimer); _gAutoSaveTimer = null; }
  if (gState.dirty && tState.settings.tsvDir) {
    await saveGlossary(true);
  }
}

// Зберегти все перед закриттям вікна. Main перехоплює 'close', шле нам
// 'app:before-close' і чекає closeReady() (або 3с таймаут) — тому тут можна
// спокійно дочекатися async-запису глосарію.
if (window.kh1.app && window.kh1.app.onBeforeClose) {
  window.kh1.app.onBeforeClose(async () => {
    try { await flushGlossaryAutoSave(); } catch (_) {}
    window.kh1.app.closeReady();
  });
}

// =====================================================================
// Індикатор операції у header'і (сканування / збірка) — видимий лише поки
// операція йде; по завершенні ховаємо і повертаємо статус глосарію.
// =====================================================================
export function setOpProgress(text) {
  tProgress.textContent = text || '';
  tProgress.hidden = !text;
}

window.kh1.translate.onProgress((p) => {
  if (!p) return;
  const phase = p.phase === 'glossary-build' ? window.i18n.t('phaseScanning')
              : p.phase === 'compose-all' ? window.i18n.t('phaseComposing')
              : p.phase || '…';
  setOpProgress(phase + ': ' + p.done + ' / ' + p.total);
  if (p.currentFile) tStatus.textContent = phase + '… ' + p.currentFile;
  // Події прогресу з main можуть прийти вже ПІСЛЯ результату операції (renderer
  // читає їх однією пачкою) — тому останню подію завершуємо самі, інакше в
  // статус-барі назавжди лишається «Збираю… <останній файл>».
  if (p.done >= p.total) setTimeout(() => { if (!gState.busy) { setOpProgress(''); refreshGlossaryProgress(); } }, 0);
});

// =====================================================================
// Wire up
// =====================================================================
tSettingsBtn.addEventListener('click', openSettings);

gBuild.addEventListener('click', () => buildGlossary(true));
gImport.addEventListener('click', importTranslations);
let _searchTimer = null;
gSearch.addEventListener('input', (e) => {
  gState.filter.search = e.target.value;
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _searchTimer = null; applyGlossaryFilter(); }, 120);
});
gFilterMode.addEventListener('change', (e) => {
  gState.filter.mode = e.target.value;
  applyGlossaryFilter();
});
if (gSortMode) {
  gSortMode.addEventListener('change', (e) => {
    gState.filter.sort = e.target.value;
    renderGlossaryRows(); // re-render у новому порядку
  });
}
gSave.addEventListener('click', () => saveGlossary(false));
gComposeAll.addEventListener('click', composeAllFiles);
