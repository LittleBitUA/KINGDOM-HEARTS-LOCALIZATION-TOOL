import { enterEditor } from '../app-shell.js';
import { toast } from '../core/log.js';
import { state } from '../core/state.js';
import { appRoot, gamesConfig, homeScreen, refreshGameDirsCache, renderHome, setGameDirsCache, showHome } from './home.js';
import { hideSettings } from '../settings-modal.js';

// =====================================================================
// Setup / Onboarding screen
// =====================================================================
//
// Перший запуск (або після `Перевідкрити setup` у Settings): користувач
// обирає активну гру + директорії (gameDir, tools, textAssets), натискає
// «Підготувати середовище» — main process завантажує OpenKH/KHPCPatchManager
// у tools-теку і пише setupCompleted=true. Далі — звичайний home-screen.
export const setupScreen = document.getElementById('setup-screen');
export const setupGameList = document.getElementById('setup-game-list');
export const setupToolsDir  = document.getElementById('setup-tools-dir');
export const setupAssetsDir = document.getElementById('setup-assets-dir');
export const setupRunBtn    = document.getElementById('setup-run');
export const setupSkipBtn   = document.getElementById('setup-skip-download');
export const setupProgress  = document.getElementById('setup-progress');
export const setupProgressFill    = document.getElementById('setup-progress-fill');
export const setupProgressPhase   = document.getElementById('setup-progress-phase');
export const setupProgressPercent = document.getElementById('setup-progress-percent');
export const setupProgressMessage = document.getElementById('setup-progress-message');

// Локальний стан, який пишеться в IPC при кліку «Підготувати».
export const _setupState = {
  activeGame: '',
  gameDirectories: {},   // { [gameId]: path }
  toolsDir: '',
  textAssetsDir: ''
};
export let _setupOffProgress = null;  // unsubscribe handle

export function showSetup() {
  if (!setupScreen) return;
  // Спершу ховаємо всі інші екрани, щоб setup був єдиним видимим.
  if (homeScreen) {
    homeScreen.classList.add('hidden');
    homeScreen.setAttribute('aria-hidden', 'true');
  }
  if (appRoot) appRoot.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  setupScreen.setAttribute('aria-hidden', 'false');
}
export function hideSetup() {
  if (!setupScreen) return;
  setupScreen.classList.add('hidden');
  setupScreen.setAttribute('aria-hidden', 'true');
}

export function _setupRenderGames() {
  if (!setupGameList) return;
  setupGameList.innerHTML = '';
  for (const g of gamesConfig) {
    const row = document.createElement('div');
    row.className = 'setup-game';
    row.dataset.gameId = g.id;
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', _setupState.activeGame === g.id ? 'true' : 'false');
    if (_setupState.activeGame === g.id) row.classList.add('active');

    const radio = document.createElement('div');
    radio.className = 'setup-game-radio';
    row.appendChild(radio);

    const text = document.createElement('div');
    text.className = 'setup-game-text';
    const nm = document.createElement('div');
    nm.className = 'setup-game-name';
    nm.textContent = g.name;
    const pth = document.createElement('div');
    pth.className = 'setup-game-path';
    const dir = _setupState.gameDirectories[g.id] || '';
    pth.textContent = dir;
    pth.setAttribute('data-empty',
      (window.i18n && window.i18n.t('setupGameNoDir')) || 'Директорію гри ще не вказано');
    text.appendChild(nm);
    text.appendChild(pth);
    row.appendChild(text);

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'kh-btn setup-game-pick';
    pickBtn.textContent = (window.i18n && window.i18n.t('setupBrowse')) || 'Вибрати…';
    pickBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const title = ((window.i18n && window.i18n.t('setupPickGameDir')) || 'Тека гри') + ' — ' + g.name;
      const dir = await window.kh1.setup.pickDir(title);
      if (!dir) return;
      _setupState.gameDirectories[g.id] = dir;
      // Якщо це перша вказана гра — автоматично робимо її активною.
      if (!_setupState.activeGame) _setupState.activeGame = g.id;
      _setupRenderGames();
      _setupRefreshRunBtn();
    });
    row.appendChild(pickBtn);

    row.addEventListener('click', () => {
      _setupState.activeGame = g.id;
      _setupRenderGames();
      _setupRefreshRunBtn();
    });

    setupGameList.appendChild(row);
  }
  // Apply i18n (на випадок якщо вже виставили мову)
  if (window.i18n && window.i18n.apply) window.i18n.apply(setupGameList);
}

export function _setupRefreshRunBtn() {
  if (!setupRunBtn) return;
  // activeGame опційна (можна вказати теки для кількох ігор без вибору
  // дефолтної). Достатньо: хоча б одна гра з директорією + обидві службові
  // теки (tools, textAssets).
  const haveAtLeastOneGame = Object.values(_setupState.gameDirectories || {})
    .some(p => typeof p === 'string' && p.trim().length > 0);
  const ok = haveAtLeastOneGame &&
             setupToolsDir.value.trim() &&
             setupAssetsDir.value.trim();
  setupRunBtn.disabled = !ok;
  if (setupSkipBtn) setupSkipBtn.disabled = !ok;
}

export function _setupResetProgressUi() {
  if (setupProgress) setupProgress.classList.remove('error', 'done');
  if (setupProgressFill) setupProgressFill.style.width = '0%';
  if (setupProgressPercent) setupProgressPercent.textContent = '';
  if (setupProgressPhase) setupProgressPhase.textContent = '—';
  if (setupProgressMessage) setupProgressMessage.textContent = '';
}

// Мапа phase → i18n-ключ. Сам label повертає `_setupPhaseLabel()` з
// поточної мови (щоб перемикач EN/UA впливав одразу).
export const SETUP_PHASE_KEYS = {
  check:             'spPhaseCheck',
  'tools-dir':       'spPhaseToolsDir',
  'fetch-openkh':    'spPhaseFetchOpenKh',
  'download-openkh': 'spPhaseDownloadOpenKh',
  'fetch-khpcpm':    'spPhaseFetchKhpcpm',
  'download-khpcpm': 'spPhaseDownloadKhpcpm',
  persist:           'spPhasePersist',
  'unpack-game':     'spPhaseUnpackGame',
  'copy-files':      'spPhaseCopyFiles',
  done:              'spPhaseDone',
  error:             'spPhaseError'
};
export function _setupPhaseLabel(phase) {
  const key = SETUP_PHASE_KEYS[phase];
  if (key && window.i18n) return window.i18n.t(key);
  return phase || '';
}

export function _setupOnProgress(p) {
  if (!setupProgress) return;
  setupProgress.classList.remove('hidden');
  const phaseLabel = _setupPhaseLabel(p.phase);
  if (setupProgressPhase) setupProgressPhase.textContent = phaseLabel;
  // Текст повідомлення: i18n-ключ з params (key+params) має пріоритет;
  // інакше — сире p.message як було.
  if (setupProgressMessage) {
    if (p.key && window.i18n) {
      setupProgressMessage.textContent = window.i18n.t(p.key, p.params || {});
    } else if (p.message) {
      setupProgressMessage.textContent = p.message;
    }
  }
  if (typeof p.percent === 'number' && setupProgressFill) {
    setupProgressFill.style.width = p.percent + '%';
    if (setupProgressPercent) setupProgressPercent.textContent = p.percent + '%';
  } else if (p.phase === 'done' && setupProgressFill) {
    setupProgressFill.style.width = '100%';
    if (setupProgressPercent) setupProgressPercent.textContent = '100%';
  }
  if (p.phase === 'error') {
    setupProgress.classList.add('error');
  }
  if (p.phase === 'done') {
    setupProgress.classList.add('done');
  }
}

export async function _setupRun(skipDownload) {
  if (setupRunBtn) setupRunBtn.disabled = true;
  if (setupSkipBtn) setupSkipBtn.disabled = true;
  _setupResetProgressUi();
  if (setupProgress) setupProgress.classList.remove('hidden');

  // Підписка на progress
  if (_setupOffProgress) { try { _setupOffProgress(); } catch(_){} _setupOffProgress = null; }
  _setupOffProgress = window.kh1.setup.onProgress(_setupOnProgress);

  const payload = {
    activeGame: _setupState.activeGame,
    gameDirectories: _setupState.gameDirectories,
    toolsDir: setupToolsDir.value.trim(),
    textAssetsDir: setupAssetsDir.value.trim(),
    skipDownload: !!skipDownload
  };
  let r;
  try { r = await window.kh1.setup.run(payload); }
  catch (e) { r = { error: (e && e.message) || String(e) }; }

  if (r && r.error) {
    if (setupProgress) setupProgress.classList.add('error');
    if (setupProgressMessage) setupProgressMessage.textContent = r.error;
    toast(r.error, 'error', 6000);
    if (setupRunBtn) setupRunBtn.disabled = false;
    if (setupSkipBtn) setupSkipBtn.disabled = false;
    return;
  }

  if (r && r.warnings && r.warnings.length) {
    for (const w of r.warnings) {
      toast(w, 'error', 5000);
    }
  }

  // Status повідомлення для фази unpack-game (KHPCPatchManager). Без цього
  // користувач не бачить що відбулось після основного setup.
  if (r && r.unpack && typeof toast === 'function') {
    if (r.unpack.launched) {
      toast('KHPCPatchManager запущено для: ' + r.unpack.hed +
            '. Заверши розпакування у його вікні.', 'success', 8000);
    } else if (r.unpack.skipped) {
      toast('Розпакування пропущено: ' + r.unpack.reason, 'error', 8000);
    } else if (r.unpack.error) {
      toast('Помилка розпакування: ' + r.unpack.error, 'error', 8000);
    }
  } else if (r && r.activeGame && typeof toast === 'function') {
    // Activgame вибрана, але r.unpack відсутній → діагностика: або
    // HED_PATHS[gid] не задано, або khpcpm не був завантажений.
    if (!r.tools || !r.tools.khpcpm) {
      toast('KHPCPatchManager не завантажено — розпакування недоступне.', 'error', 7000);
    }
  }

  // Setup завершений. Оновлюємо cache і перерендеримо home, щоб картка
  // активної гри (та інших, для яких задано dir) стала кольоровою.
  await refreshGameDirsCache();
  renderHome();

  // Якщо активна гра була явно обрана — заходимо у її редактор як шорткат.
  // Якщо ні — показуємо home, де користувач може вибрати картку.
  setTimeout(() => {
    hideSetup();
    showHome();
    if (typeof toast === 'function') {
      const msg = (window.i18n && window.i18n.t('toastSetupDone')) || 'Налаштування завершено';
      toast(msg, 'success', 3000);
    }
    if (r.activeGame) {
      const g = gamesConfig.find(x => x.id === r.activeGame);
      if (g && g.enabled) enterEditor(r.activeGame);
    }
  }, 600);
}

export async function initSetupFromState(state) {
  // Заповнюємо UI поточними значеннями (якщо є — повторне відкриття).
  _setupState.activeGame = state.activeGame || '';
  _setupState.gameDirectories = Object.assign({}, state.gameDirectories || {});
  _setupState.toolsDir = state.toolsDir || (state.defaults && state.defaults.toolsDir) || '';
  _setupState.textAssetsDir = state.textAssetsDir || (state.defaults && state.defaults.textAssetsDir) || '';
  if (setupToolsDir)  setupToolsDir.value  = _setupState.toolsDir;
  if (setupAssetsDir) setupAssetsDir.value = _setupState.textAssetsDir;
  _setupRenderGames();
  _setupRefreshRunBtn();
}

// Bootstrap: вирішує що показати першим (setup vs home).
//
// Поведінка:
//   • setupCompleted === true  → одразу home. Якщо якісь директорії
//     зникли з диска — користувач сам помітить (порожній список файлів),
//     і завжди може натиснути «↺ Перевідкрити setup» у Settings.
//   • setupCompleted === false → показуємо setup-onboarding.
//
// Раніше тут був toast «директорії не існують», але він спрацьовував
// помилково для legacy-юзерів v2.22.x, у яких немає toolsDir/textAssetsDir
// (нові поля v2.23). Прибрано — setup-screen сам по собі є достатнім сигналом.
export async function bootstrapApp() {
  let state;
  try { state = await window.kh1.setup.status(); }
  catch (_) { state = null; }

  // Кеш gameDirectories для home-cards (грейаут якщо директорії немає).
  setGameDirsCache((state && state.gameDirectories) || {});
  renderHome();

  if (state && state.completed) {
    showHome();
    return;
  }
  await initSetupFromState(state || {});
  showSetup();
}

// Wiring обробників (один раз).
if (setupToolsDir) {
  setupToolsDir.addEventListener('input', () => {
    _setupState.toolsDir = setupToolsDir.value.trim();
    _setupRefreshRunBtn();
  });
}
if (setupAssetsDir) {
  setupAssetsDir.addEventListener('input', () => {
    _setupState.textAssetsDir = setupAssetsDir.value.trim();
    _setupRefreshRunBtn();
  });
}
export const _setupToolsPick = document.getElementById('setup-tools-pick');
if (_setupToolsPick) {
  _setupToolsPick.addEventListener('click', async () => {
    const dir = await window.kh1.setup.pickDir(
      (window.i18n && window.i18n.t('setupPickToolsDir')) || 'Тека tools');
    if (!dir) return;
    setupToolsDir.value = dir;
    _setupState.toolsDir = dir;
    _setupRefreshRunBtn();
  });
}
export const _setupAssetsPick = document.getElementById('setup-assets-pick');
if (_setupAssetsPick) {
  _setupAssetsPick.addEventListener('click', async () => {
    const dir = await window.kh1.setup.pickDir(
      (window.i18n && window.i18n.t('setupPickAssetsDir')) || 'Тека текстових ресурсів');
    if (!dir) return;
    setupAssetsDir.value = dir;
    _setupState.textAssetsDir = dir;
    _setupRefreshRunBtn();
  });
}
if (setupRunBtn)  setupRunBtn.addEventListener('click',  () => _setupRun(false));
if (setupSkipBtn) setupSkipBtn.addEventListener('click', () => _setupRun(true));

// «Перевідкрити setup» у Settings overlay: скидає setupCompleted у головному
// процесі, закриває settings, переключає на setup-screen.
export const _settingsReopenSetup = document.getElementById('settings-reopen-setup');
if (_settingsReopenSetup) {
  _settingsReopenSetup.addEventListener('click', async () => {
    try { await window.kh1.setup.reset(); } catch (_) {}
    hideSettings();
    // Перечитуємо current state (щоб у setup-формі заповнилися останні шляхи).
    let state = null;
    try { state = await window.kh1.setup.status(); } catch (_) {}
    if (state) await initSetupFromState(state);
    showSetup();
  });
}

// Поточна обрана гра (id з gamesConfig) — впливає на фільтрацію списку
