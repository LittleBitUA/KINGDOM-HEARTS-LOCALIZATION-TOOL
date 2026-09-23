import { getCurrentGame, getCurrentGameId } from './app-shell.js';
import { setEngDir, setOutDir, setRusDir, setTsvDir, settingsClose, settingsOverlay } from './core/dom.js';
import { toast } from './core/log.js';
import { tState } from './core/state.js';
import { loadFileList } from './translate/files.js';
import { gamesConfig } from './screens/home.js';

// =====================================================================
// Settings modal
//
// Теки — НЕ глобальні: кожна гра має власні engDir/rusDir/tsvDir/outDir
// (див. main/settings.js, games[<id>]). Тому в розділі «Теки локалізації»
// стоїть перемикач ігор: обираєш гру — бачиш і правиш саме її теки,
// незалежно від того, яку гру відкрито в редакторі.
// =====================================================================

const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;

// Гра, чиї теки зараз показано (не обов'язково та, що відкрита в редакторі).
let dirsGameId = null;
// Кеш налаштувань по іграх, щоб не смикати IPC на кожен клік.
const dirsCache = new Map();

function dirGames() {
  return gamesConfig.filter(g => Array.isArray(g.dirs) && g.dirs.length);
}

function gameById(id) {
  return gamesConfig.find(g => g.id === id) || null;
}

export function openSettings() {
  const wanted = getCurrentGameId() || (dirGames()[0] && dirGames()[0].id);
  renderGameTabs();
  selectDirsGame(wanted, { force: true });
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
}

// ---------------------------------------------------------------------
// Перемикач ігор у розділі «Теки локалізації»
// ---------------------------------------------------------------------
function renderGameTabs() {
  const box = document.getElementById('settings-games');
  if (!box) return;
  box.innerHTML = '';
  for (const g of dirGames()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-game' + (g.enabled ? '' : ' is-soon');
    btn.dataset.gameId = g.id;
    btn.setAttribute('role', 'tab');
    btn.title = g.name;
    const dot = document.createElement('span');
    dot.className = 'settings-game-dot';
    const label = document.createElement('span');
    label.className = 'settings-game-name';
    label.textContent = shortName(g);
    btn.appendChild(dot);
    btn.appendChild(label);
    btn.addEventListener('click', () => selectDirsGame(g.id));
    box.appendChild(btn);
  }
}

// Коротка назва для чипа: «Final Mix», «Re:CoM», «BBS»…
function shortName(g) {
  const map = {
    'kh1-final-mix': 'KH1 Final Mix',
    'kh-re-com': 'Re:Chain of Memories',
    'kh-ddd': 'Dream Drop Distance',
    'kh-bbs-final-mix': 'Birth by Sleep',
    'kh-days': '358/2 Days',
    'kh-recoded': 'Re:coded',
    'kh-theater': 'Театр KH1',
    'kh-02-bbs': '0.2 Birth by Sleep',
    'kh-back-cover': 'χ Back Cover'
  };
  return map[g.id] || g.name;
}

export async function selectDirsGame(gameId, opts) {
  const game = gameById(gameId) || dirGames()[0];
  if (!game) return;
  if (!(opts && opts.force) && game.id === dirsGameId) return;
  dirsGameId = game.id;

  for (const btn of document.querySelectorAll('.settings-game')) {
    const on = btn.dataset.gameId === dirsGameId;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  }

  const s = await settingsFor(dirsGameId);
  setEngDir.value = s.engDir || '';
  setRusDir.value = s.rusDir || '';
  setTsvDir.value = s.tsvDir || '';
  setOutDir.value = s.outDir || '';
  applyGameDirsVisibility(game);
}

async function settingsFor(gameId) {
  if (dirsCache.has(gameId)) return dirsCache.get(gameId);
  let s = {};
  try { s = (await window.kh1.translate.getSettings(gameId)) || {}; } catch (_) { s = {}; }
  dirsCache.set(gameId, s);
  return s;
}

// Показати лише ті рядки тек, які гра справді використовує (BBS не має RUS).
export function applyGameDirsVisibility(gameArg) {
  const game = gameArg || gameById(dirsGameId) || getCurrentGame();
  const allowed = (game && game.dirs) || ['engDir', 'rusDir', 'tsvDir', 'outDir'];
  document.querySelectorAll('.setting-row[data-dir-key]').forEach(row => {
    const key = row.getAttribute('data-dir-key');
    row.style.display = allowed.includes(key) ? '' : 'none';
  });
  const hint = document.getElementById('dirs-hint');
  if (hint && game) {
    if (game.id === 'kh-re-com') {
      hint.textContent = t('dirsHintReCom',
        'FILES-тека (з оригінальними UK_*.ctdl) — список і джерело для перекладу. Прогрес — у TSV-теку, готові .ctdl — у UA-теку.');
    } else if (game.id === 'kh1-final-mix') {
      hint.textContent = t('dirsHint',
        'MYFILES-тека визначає список файлів. ENG-тека має містити файли з тими самими відносними шляхами. Прогрес зберігається у PROGRESS-теку, готові файли — у DONE-теку.');
    } else {
      hint.textContent = t('dirsHintBbs',
        'ENG-тека визначає список файлів і служить джерелом для перекладу. Прогрес — у TSV-теку, готові .ctd — у UA-теку.');
    }
  }
  const note = document.getElementById('dirs-game-note');
  if (note && game) {
    note.textContent = t('dirsGameNote', 'Теки нижче належать грі «{game}».').replace('{game}', game.name);
  }
}

export function hideSettings() {
  settingsOverlay.classList.add('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'true');
}

export async function pickAndSetDir(key, inputEl, title) {
  const dir = await window.kh1.translate.pickDirectory(title);
  if (!dir) return;
  const gameId = dirsGameId || getCurrentGameId();
  inputEl.value = dir;
  // Кеш цієї гри тримаємо в актуальному стані.
  const cached = dirsCache.get(gameId);
  if (cached) cached[key] = dir;
  // Якщо правимо теки гри, що зараз відкрита, — оновлюємо і живий стан.
  if (gameId === getCurrentGameId()) tState.settings[key] = dir;
  await window.kh1.translate.saveSettings({ [key]: dir }, gameId);
  toast(window.i18n.t('toastSavedKv', { key, dir }), 'success');
  // Перезавантажити список файлів, лише якщо змінився source-dir ВІДКРИТОЇ гри.
  if (gameId === getCurrentGameId()) {
    const game = getCurrentGame();
    const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
    if (key === sourceDirKey) loadFileList();
  }
}

settingsOverlay.addEventListener('click', (e) => {
  const pick = e.target.closest && e.target.closest('[data-pick]');
  if (pick) {
    const key = pick.dataset.pick;
    const inputs = { engDir: setEngDir, rusDir: setRusDir, tsvDir: setTsvDir, outDir: setOutDir };
    const game = gameById(dirsGameId);
    const suffix = game ? ' — ' + game.name : '';
    const titles = {
      engDir: 'Виберіть теку з оригінальними файлами (ENG)' + suffix,
      rusDir: 'Виберіть теку з російською локалізацією (RUS)' + suffix,
      tsvDir: 'Виберіть теку для збереження прогресу (TSV)' + suffix,
      outDir: 'Виберіть теку для готових українських файлів (UA)' + suffix
    };
    pickAndSetDir(key, inputs[key], titles[key]);
  } else if (e.target === settingsOverlay) {
    hideSettings();
  }
});
settingsClose.addEventListener('click', hideSettings);
const settingsX = document.getElementById('settings-x');
if (settingsX) settingsX.addEventListener('click', hideSettings);
