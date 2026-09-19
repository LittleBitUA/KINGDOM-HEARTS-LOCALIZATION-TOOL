import { getCurrentGame, getCurrentGameId } from './app-shell.js';
import { setEngDir, setOutDir, setRusDir, setTsvDir, settingsClose, settingsOverlay } from './core/dom.js';
import { toast } from './core/log.js';
import { tState } from './core/state.js';
import { loadFileList } from './translate/files.js';

// =====================================================================
// Settings modal
// =====================================================================
export function openSettings() {
  setEngDir.value = tState.settings.engDir || '';
  setRusDir.value = tState.settings.rusDir || '';
  setTsvDir.value = tState.settings.tsvDir || '';
  setOutDir.value = tState.settings.outDir || '';
  // Сховати/показати dir-rows під обрану гру (BBS не використовує RUS-теку).
  applyGameDirsVisibility();
  // Схема кирилиці — лише для KH1.
  const schemeSection = document.getElementById('font-scheme-section');
  const schemeSel = document.getElementById('set-font-scheme');
  if (schemeSection) schemeSection.style.display = getCurrentGameId() === 'kh1-final-mix' ? '' : 'none';
  if (schemeSel) schemeSel.value = tState.settings.fontScheme === 'native' ? 'native' : 'overlay';
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
}

export function applyGameDirsVisibility() {
  const game = getCurrentGame();
  const allowed = (game && game.dirs) || ['engDir', 'rusDir', 'tsvDir', 'outDir'];
  document.querySelectorAll('.setting-row[data-dir-key]').forEach(row => {
    const key = row.getAttribute('data-dir-key');
    row.style.display = allowed.includes(key) ? '' : 'none';
  });
  // Адаптивний hint під гру
  const hint = document.getElementById('dirs-hint');
  if (hint && game) {
    if (game.id === 'kh-bbs-final-mix') {
      hint.textContent = (window.i18n && window.i18n.t('dirsHintBbs')) ||
        'ENG-тека визначає список файлів і служить джерелом для перекладу. Прогрес — у TSV-теку, готові .ctd — у UA-теку.';
    } else if (game.id === 'kh-re-com') {
      hint.textContent = (window.i18n && window.i18n.t('dirsHintReCom')) ||
        'FILES-тека (з оригінальними UK_*.ctdl) — список і джерело для перекладу. Прогрес — у TSV-теку, готові .ctdl — у UA-теку.';
    }
    // Для KH1 — лишається оригінальний i18n-текст (data-i18n атрибут).
  }
}

export function hideSettings() {
  settingsOverlay.classList.add('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'true');
}

export async function pickAndSetDir(key, inputEl, title) {
  const dir = await window.kh1.translate.pickDirectory(title);
  if (!dir) return;
  inputEl.value = dir;
  tState.settings[key] = dir;
  // Зберігаємо лише змінений ключ — у per-game scope (engDir/rusDir/tsvDir
  // /outDir/lastFile належать поточній грі).
  await window.kh1.translate.saveSettings({ [key]: dir }, getCurrentGameId());
  toast(window.i18n.t('toastSavedKv', {key, dir}), 'success');
  // Перезавантажити список файлів якщо змінився source-dir поточної гри.
  const game = getCurrentGame();
  const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
  if (key === sourceDirKey) loadFileList();
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

// Схема кирилиці KH1: зберігається per-game; main перемикає кодек одразу.
const fontSchemeSel = document.getElementById('set-font-scheme');
if (fontSchemeSel) {
  fontSchemeSel.addEventListener('change', async () => {
    const scheme = fontSchemeSel.value === 'native' ? 'native' : 'overlay';
    tState.settings.fontScheme = scheme;
    try {
      await window.kh1.translate.saveSettings({ fontScheme: scheme }, getCurrentGameId());
      toast(window.i18n.t('toastFontScheme', { scheme }), 'info', 5000);
    } catch (e) {
      toast(window.i18n.t('toastError', { msg: e.message }), 'error', 6000);
    }
  });
}
