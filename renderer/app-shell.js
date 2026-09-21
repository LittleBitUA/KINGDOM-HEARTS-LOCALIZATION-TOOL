import { gRows, modeBbsFontBtn, modeKerningBtn, modeTranslateBtn, tStatus, viewBbsFont, viewKerning, viewTranslate } from './core/dom.js';
import { gState, state, tState } from './core/state.js';
import { kAutoLoadKnjOnBoot } from './kerning/kerning.js';
import { maybeFirstRunSettings } from './main.js';
import { gamesConfig, hideHome, showHome } from './screens/home.js';
import { cancelAutoSaveTimers, initTranslateMode } from './translate/files.js';
import { refreshInstallDoneVisibility } from './translate/glossary.js';
import { enterComKerning } from './kerning/comkern.js';
import { enterBubbles } from './bubbles/bubbles.js';
import { enterTextures } from './textures/textures.js';
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
  const isCom = _currentGameId === 'kh-re-com';
  const moduleGame = document.getElementById('t-module-game');
  if (moduleGame) { const g = getCurrentGame(); moduleGame.textContent = g ? g.name : ''; }
  const hasUaFonts = ['kh1-final-mix', 'kh-bbs-final-mix', 'kh-re-com', 'kh-ddd'].includes(_currentGameId);
  // Mode tabs які доступні цій грі.
  // Усі:   Translate (глосарій — єдиний робочий список) + Шрифти UA.
  // KH1:   + Kerning (.knj); Re:CoM: + Кернінг CoM (FFMW .binl) + Хмаринки (.ctdl макети); BBS: + Шрифт BBS (FontEn.arc).
  const kerningTab = document.getElementById('mode-kerning');
  const comKerningTab = document.getElementById('mode-com-kerning');
  const bubblesTab = document.getElementById('mode-bubbles');
  const texturesTab = document.getElementById('mode-textures');
  if (texturesTab) texturesTab.style.display = (isCom || isBbs) ? '' : 'none';
  const bbsFontTab = document.getElementById('mode-bbs-font');
  if (kerningTab) kerningTab.style.display = isKh1 ? '' : 'none';
  if (comKerningTab) comKerningTab.style.display = isCom ? '' : 'none';
  if (bubblesTab) bubblesTab.style.display = isCom ? '' : 'none';
  if (bbsFontTab) bbsFontTab.style.display = isBbs ? '' : 'none';
  const uaFontsTab = document.getElementById('mode-ua-fonts');
  if (uaFontsTab) uaFontsTab.style.display = hasUaFonts ? '' : 'none';

  // Якщо гра змінилась — повністю скидаємо translate-state, бо settings,
  // файли, slots, glossary тепер інші.
  if (gameChanged) {
    resetTranslateState();
  }

  // Завжди починаємо з перекладу; якщо гра змінилась, а режим уже «Переклад» —
  // ініціалізуємо його заново (інший список файлів, глосарій, налаштування).
  setMode('translate', { force: gameChanged });

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
  // Глосарій — per-game: інакше переклади KH1 ("Yes"/"No"/"Cancel" збігаються)
  // підхопились би в іншій грі.
  gState.entries = [];
  gState.translations = Object.create(null);
  clearBulkHistory();
  gState.dirty = false;
  if (gRows) gRows.innerHTML = '';
  if (tStatus) tStatus.textContent = '';
}

export function goHome() {
  showHome();
}

// =====================================================================
// Mode switching
// =====================================================================
export function setMode(mode, opts) {
  if (state.mode === mode && !(opts && opts.force)) return;
  state.mode = mode;
  viewTranslate.classList.toggle('hidden', mode !== 'translate');
  viewKerning.classList.toggle('hidden', mode !== 'kerning');
  const viewComKerning = document.getElementById('view-com-kerning');
  if (viewComKerning) viewComKerning.classList.toggle('hidden', mode !== 'com-kerning');
  const modeComKerningBtn = document.getElementById('mode-com-kerning');
  if (modeComKerningBtn) modeComKerningBtn.classList.toggle('active', mode === 'com-kerning');
  const viewBubbles = document.getElementById('view-bubbles');
  if (viewBubbles) viewBubbles.classList.toggle('hidden', mode !== 'bubbles');
  const modeBubblesBtn = document.getElementById('mode-bubbles');
  if (modeBubblesBtn) modeBubblesBtn.classList.toggle('active', mode === 'bubbles');
  const viewTextures = document.getElementById('view-textures');
  if (viewTextures) viewTextures.classList.toggle('hidden', mode !== 'textures');
  const modeTexturesBtn = document.getElementById('mode-textures');
  if (modeTexturesBtn) modeTexturesBtn.classList.toggle('active', mode === 'textures');
  if (viewBbsFont) viewBbsFont.classList.toggle('hidden', mode !== 'bbs-font');
  const viewUaFonts = document.getElementById('view-ua-fonts');
  if (viewUaFonts) viewUaFonts.classList.toggle('hidden', mode !== 'ua-fonts');
  const modeUaFontsBtn = document.getElementById('mode-ua-fonts');
  if (modeUaFontsBtn) modeUaFontsBtn.classList.toggle('active', mode === 'ua-fonts');
  modeTranslateBtn.classList.toggle('active', mode === 'translate');
  modeKerningBtn.classList.toggle('active', mode === 'kerning');
  if (modeBbsFontBtn) modeBbsFontBtn.classList.toggle('active', mode === 'bbs-font');
  if (mode === 'translate') { initTranslateMode(); refreshInstallDoneVisibility(); }
  if (mode === 'ua-fonts') initUaFonts();
  if (mode === 'com-kerning') enterComKerning();
  if (mode === 'bubbles') enterBubbles();
  if (mode === 'textures') enterTextures();
}
const _modeComKerningBtn = document.getElementById('mode-com-kerning');
if (_modeComKerningBtn) _modeComKerningBtn.addEventListener('click', () => setMode('com-kerning'));
const _modeBubblesBtn = document.getElementById('mode-bubbles');
if (_modeBubblesBtn) _modeBubblesBtn.addEventListener('click', () => setMode('bubbles'));
const _modeTexturesBtn = document.getElementById('mode-textures');
if (_modeTexturesBtn) _modeTexturesBtn.addEventListener('click', () => setMode('textures'));
const _modeUaFontsBtn = document.getElementById('mode-ua-fonts');
if (_modeUaFontsBtn) _modeUaFontsBtn.addEventListener('click', () => setMode('ua-fonts'));

modeTranslateBtn.addEventListener('click', () => setMode('translate'));
modeKerningBtn.addEventListener('click', () => setMode('kerning'));
if (modeBbsFontBtn) modeBbsFontBtn.addEventListener('click', () => setMode('bbs-font'));

