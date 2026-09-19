import { gRows, modeBbsFontBtn, modeEditorBtn, modeKerningBtn, modeTranslateBtn, tFileSel, tRows, tStatus, viewBbsFont, viewEditor, viewKerning, viewTranslate } from './core/dom.js';
import { gState, state, tState } from './core/state.js';
import { kAutoLoadKnjOnBoot } from './kerning/kerning.js';
import { maybeFirstRunSettings } from './main.js';
import { gamesConfig, hideHome, showHome } from './screens/home.js';
import { cancelAutoSaveTimers, initTranslateMode } from './translate/files.js';
import { clearBulkHistory } from './translate/history.js';
import { initUaFonts } from './uafonts/uafonts.js';

// файлів у translate-режимі та на доступні режими (Kerning лише для KH1).
export let _currentGameId = null;
export function getCurrentGameId() { return _currentGameId; }
export function getCurrentGame() {
  return gamesConfig.find(g => g.id === _currentGameId) || null;
}
export function getCurrentGameFormats() {
  const g = getCurrentGame();
  return (g && g.formats) || null;
}

export function enterEditor(gameId) {
  const newGameId = gameId || _currentGameId || 'kh1-final-mix';
  const gameChanged = newGameId !== _currentGameId;
  _currentGameId = newGameId;
  hideHome();

  const isKh1 = _currentGameId === 'kh1-final-mix';
  const isBbs = _currentGameId === 'kh-bbs-final-mix';
  const hasUaFonts = ['kh-bbs-final-mix', 'kh-re-com', 'kh-ddd'].includes(_currentGameId);
  // Mode tabs які доступні цій грі.
  // KH1:    Editor + Translate + Kerning.
  // BBS:    Translate + Шрифт BBS (font-hack для UA).
  // Re:CoM: лише Translate. Editor приховано (CTDL = таблично-структурований,
  //         немає raw-byte representation як у BIN/BINL); Kerning — KH1-формат
  //         .knj; BBS Font — специфічний для BBS-fontEn.arc.
  const editorTab  = document.getElementById('mode-editor');
  const kerningTab = document.getElementById('mode-kerning');
  const bbsFontTab = document.getElementById('mode-bbs-font');
  if (editorTab)  editorTab.style.display  = isKh1 ? '' : 'none';
  if (kerningTab) kerningTab.style.display = isKh1 ? '' : 'none';
  if (bbsFontTab) bbsFontTab.style.display = isBbs ? '' : 'none';
  const uaFontsTab = document.getElementById('mode-ua-fonts');
  if (uaFontsTab) uaFontsTab.style.display = hasUaFonts ? '' : 'none';

  // Якщо гра змінилась — повністю скидаємо translate-state, бо settings,
  // файли, slots, glossary тепер інші.
  if (gameChanged) {
    resetTranslateState();
  }

  setMode(isKh1 ? 'editor' : 'translate');

  // First-run settings перевірка для поточної гри (один раз на сесію).
  if (!enterEditor._firstRunChecked) {
    enterEditor._firstRunChecked = true;
    maybeFirstRunSettings();
  }
  // KH1-specific .knj/.dds автозавантаження — лише для KH1, лише раз.
  if (isKh1 && !enterEditor._knjLoaded) {
    enterEditor._knjLoaded = true;
    kAutoLoadKnjOnBoot();
  }
}

// Скидаємо все що належить translate-режиму, щоб при перемиканні гри
// не лишалось stale-контенту (DOM, slots, settings, file selection).
export function resetTranslateState() {
  if (!tState) return;
  // Скидаємо pending autosave-таймери: інакше таймер попередньої гри
  // спрацює вже з новими settings і запише TSV/глосарій не в ту теку.
  cancelAutoSaveTimers();
  tState.settings = { engDir: '', rusDir: '', outDir: '', tsvDir: '' };
  tState.files = [];
  tState.slots = [];
  tState.currentRel = null;
  tState.dirty = false;
  tState.fileName = '';
  tState.fileMeta = null;
  // Глосарій — per-game. Якщо лишити старий, loadFile() автозаповнить слоти
  // іншої гри перекладами з KH1 ("Yes"/"No"/"Cancel" збігаються).
  gState.entries = [];
  gState.translations = Object.create(null);
  clearBulkHistory();
  gState.dirty = false;
  if (tFileSel) {
    while (tFileSel.firstChild) tFileSel.removeChild(tFileSel.firstChild);
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = (window.i18n && window.i18n.t('selectFile')) || '— виберіть файл —';
    tFileSel.appendChild(blank);
  }
  if (tRows) tRows.innerHTML = '';
  if (gRows) gRows.innerHTML = '';
  if (tStatus) tStatus.textContent = '';
}

export function goHome() {
  showHome();
}

// =====================================================================
// Mode switching
// =====================================================================
export function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  viewEditor.classList.toggle('hidden', mode !== 'editor');
  viewTranslate.classList.toggle('hidden', mode !== 'translate');
  viewKerning.classList.toggle('hidden', mode !== 'kerning');
  if (viewBbsFont) viewBbsFont.classList.toggle('hidden', mode !== 'bbs-font');
  const viewUaFonts = document.getElementById('view-ua-fonts');
  if (viewUaFonts) viewUaFonts.classList.toggle('hidden', mode !== 'ua-fonts');
  const modeUaFontsBtn = document.getElementById('mode-ua-fonts');
  if (modeUaFontsBtn) modeUaFontsBtn.classList.toggle('active', mode === 'ua-fonts');
  modeEditorBtn.classList.toggle('active', mode === 'editor');
  modeTranslateBtn.classList.toggle('active', mode === 'translate');
  modeKerningBtn.classList.toggle('active', mode === 'kerning');
  if (modeBbsFontBtn) modeBbsFontBtn.classList.toggle('active', mode === 'bbs-font');
  if (mode === 'translate') initTranslateMode();
  if (mode === 'ua-fonts') initUaFonts();
}
const _modeUaFontsBtn = document.getElementById('mode-ua-fonts');
if (_modeUaFontsBtn) _modeUaFontsBtn.addEventListener('click', () => setMode('ua-fonts'));

modeEditorBtn.addEventListener('click', () => setMode('editor'));
modeTranslateBtn.addEventListener('click', () => setMode('translate'));
modeKerningBtn.addEventListener('click', () => setMode('kerning'));
if (modeBbsFontBtn) modeBbsFontBtn.addEventListener('click', () => setMode('bbs-font'));

