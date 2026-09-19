'use strict';

// =====================================================================
// Custom title bar handlers (Stage 1 редизайну).
// Pure-UI: лише min/max/close через kh1.win API.
// =====================================================================
(function setupTitleBar() {
  const btnMin = document.getElementById('tb-minimize');
  const btnMax = document.getElementById('tb-maximize');
  const btnClose = document.getElementById('tb-close');
  if (!btnMin || !btnMax || !btnClose) return;
  const w = window.kh1 && window.kh1.win;
  if (!w) return;
  btnMin.addEventListener('click', () => w.minimize());
  btnMax.addEventListener('click', () => w.maximize());
  btnClose.addEventListener('click', () => w.close());
  // Версія у титлбарі — з package.json через app:about (не хардкодити).
  const verEl = document.getElementById('tb-version');
  if (verEl && window.kh1.about) {
    window.kh1.about().then((info) => {
      if (info && info.version) verEl.textContent = 'v' + info.version;
    }).catch(() => {});
  }
  // Subscribe на win-state events для свопу max/restore icon (optional polish).
  if (w.onState) {
    w.onState((state) => {
      btnMax.title = state.isMaximized ? 'Restore' : 'Maximize';
    });
  }
})();

// =====================================================================
// Спільні чисті модулі (shared/*.js, UMD → window.KH)
// =====================================================================
const {
  preserveStructure, tokensOf, validateTokens, tokenIssueText,
  segmentByTokens, autoFixStructure, syncPaddingFromEn, LETTER_RE
} = window.KH.textStructure;
const tsvFormat = window.KH.tsv;

// =====================================================================
// DOM refs
// =====================================================================
const viewEditor = document.getElementById('view-editor');
const viewTranslate = document.getElementById('view-translate');
const viewKerning = document.getElementById('view-kerning');
const viewBbsFont = document.getElementById('view-bbs-font');
const modeEditorBtn = document.getElementById('mode-editor');
const modeTranslateBtn = document.getElementById('mode-translate');
const modeKerningBtn = document.getElementById('mode-kerning');
const modeBbsFontBtn = document.getElementById('mode-bbs-font');

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
const gSortMode = document.getElementById('g-sort-mode');
const gStat = document.getElementById('g-stat');
const gDashboard = document.getElementById('g-dashboard');
const gDashDone = document.getElementById('g-dash-done');
const gDashTotal = document.getElementById('g-dash-total');
const gDashPct = document.getElementById('g-dash-pct');
const gDashBarFill = document.getElementById('g-dash-bar-fill');
const gDashUntrans = document.getElementById('g-dash-untrans');
const gDashSameEn = document.getElementById('g-dash-sameen');
const gDashIssues = document.getElementById('g-dash-issues');
const gSave = document.getElementById('g-save');
const gComposeAll = document.getElementById('g-compose-all');
const gRows = document.getElementById('g-rows');

// replace modal (Ctrl+H)
const repOverlay = document.getElementById('replace-overlay');
const repFind = document.getElementById('rep-find');
const repReplace = document.getElementById('rep-replace');
const repCase = document.getElementById('rep-case');
const repWholeWord = document.getElementById('rep-whole-word');
const repRegex = document.getElementById('rep-regex');
const repPreview = document.getElementById('rep-preview');
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
// Toasts + persistent Event Log
// =====================================================================
const eventLog = {
  items: [],          // { ts, kind, msg }
  max: 200,
  drawer: null,
  list: null,
  badge: null,
  emptyEl: null,
  unread: 0
};

function _logFmtTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function _logRender() {
  if (!eventLog.list) return;
  eventLog.list.innerHTML = '';
  for (let i = eventLog.items.length - 1; i >= 0; i--) {
    const it = eventLog.items[i];
    const li = document.createElement('li');
    li.className = 'event-log-item kind-' + it.kind;
    const t = document.createElement('span');
    t.className = 'ev-time';
    t.textContent = _logFmtTime(it.ts);
    const m = document.createElement('span');
    m.className = 'ev-msg';
    m.textContent = it.msg;
    li.appendChild(t); li.appendChild(m);
    eventLog.list.appendChild(li);
  }
  if (eventLog.drawer) eventLog.drawer.classList.toggle('has-events', eventLog.items.length > 0);
}

function _logBadgeUpdate() {
  if (!eventLog.badge) return;
  if (eventLog.unread > 0) {
    eventLog.badge.textContent = eventLog.unread > 99 ? '99+' : String(eventLog.unread);
    eventLog.badge.hidden = false;
  } else {
    eventLog.badge.hidden = true;
  }
}

function logEvent(message, kind) {
  if (!kind) kind = 'info';
  eventLog.items.push({ ts: Date.now(), kind, msg: String(message) });
  if (eventLog.items.length > eventLog.max) {
    eventLog.items.splice(0, eventLog.items.length - eventLog.max);
  }
  _logRender();
  if (eventLog.drawer && eventLog.drawer.classList.contains('hidden')) {
    eventLog.unread++;
    _logBadgeUpdate();
  }
}

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
  // Mirror to persistent log
  logEvent(message, kind);
}

// =====================================================================
// Home / Game Selection screen
// gamesConfig — масив; додавай нові ігри сюди. Кожна гра має:
//   id        - унікальний slug
//   title     - велика назва на обкладинці
//   name      - назва під карткою
//   subtitle  - короткий опис (платформа/реліз)
//   image     - шлях до cover (або null → CSS-fallback)
//   coverGrad - CSS-градієнт обкладинки (якщо нема image)
//   enabled   - true → клікабельна
//   status    - 'ready' | 'soon'
//   onSelect  - callback при виборі (тільки для enabled)
// =====================================================================
// `formats` = масив classifier kind'ів які належать до гри. Translate-режим
// фільтрує список файлів за цим. KH1 використовує binl/rawbin/ev/mesofs;
// BBS — лише ctd. Re:CoM поки заглушка.
const gamesConfig = [
  {
    id: 'kh1-final-mix',
    title: 'KINGDOM HEARTS FINAL MIX',
    name: 'Kingdom Hearts Final Mix',
    subtitle: 'PC (Steam / Epic Games) · .bin / .binl / .ard',
    image: null,
    coverGrad: 'linear-gradient(135deg, #2a1f6b 0%, #1a1448 40%, #0a0a3f 100%)',
    enabled: true,
    status: 'ready',
    formats: ['binl', 'rawbin', 'ev', 'mesofs'],
    // KH1 використовує RUS-теку як reference oracle І як джерело списку файлів.
    dirs: ['engDir', 'rusDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'rusDir',
    onSelect: () => enterEditor('kh1-final-mix')
  },
  {
    id: 'kh-re-com',
    title: 'KINGDOM HEARTS Re:Chain of Memories',
    name: 'Kingdom Hearts Re:Chain of Memories',
    subtitle: 'PC (Steam / Epic Games) · .ctdl (subtitles + menu text)',
    image: null,
    coverGrad: 'linear-gradient(135deg, #4a3a1a 0%, #2a2008 50%, #1a1404 100%)',
    enabled: true,
    status: 'ready',
    formats: ['ctdl'],
    // Re:CoM: ENG = і джерело тексту і список файлів; UA = вихід; TSV = прогрес.
    // Без RUS-оракула (як у BBS).
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-re-com')
  },
  {
    id: 'kh-bbs-final-mix',
    title: 'KINGDOM HEARTS Birth by Sleep FINAL MIX',
    name: 'Kingdom Hearts: Birth by Sleep Final Mix',
    subtitle: 'PC (Steam / Epic Games) · .ctd (subtitles + menu text)',
    image: null,
    coverGrad: 'linear-gradient(135deg, #1f4a5e 0%, #0a3040 50%, #051a2a 100%)',
    enabled: true,
    status: 'ready',
    formats: ['ctd'],
    // BBS: ENG = і джерело тексту і список файлів; UA = вихід; TSV = прогрес.
    // Без RUS-оракула.
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-bbs-final-mix')
  }
];

const homeScreen = document.getElementById('home-screen');
const homeGrid   = document.getElementById('home-grid');
const appRoot    = document.querySelector('.app');

function _gameStatusLabel(status) {
  if (status === 'ready') return (window.i18n && window.i18n.t('gameStatusReady')) || 'Готово';
  if (status === 'soon')  return (window.i18n && window.i18n.t('gameStatusSoon'))  || 'Незабаром';
  return '';
}

const HEART_SVG = '<svg viewBox="0 0 454 495" preserveAspectRatio="xMidYMid meet"><path fill="currentColor" d="m373.17 258.49c80.56-70.15 80.06-108.12 80.06-139.77-4.58-127.33-116.89-118.48-116.89-118.48 0 0.00197-100.38 0.00197-108.02 94.225 2.75 58.465 56.09 60.495 56.09 60.495s46.45-0.1 46.45-40.86c0-40.748-42.91-32.869-42.91-32.869s26.58 9.401 26.58 27.489c0 12.47-18.97 24.98-29.2 24.98s-27.93-8.44-27.93-29.94c0-59.653 69.28-59.936 76.96-59.936s76.65 6.201 78.03 77.366c0.47 24.02 0 49.77-38.68 89.51-135.38 113.54-146.45 191.72-146.45 191.72-1.03 0-12.1-78.18-147.48-191.72-38.679-39.74-39.147-65.49-38.679-89.51 1.387-71.165 70.349-77.366 78.029-77.366s76.97 0.283 76.97 59.936c0 21.5-17.7 29.94-27.93 29.94s-29.2-12.51-29.2-24.98c0-18.088 26.58-27.489 26.58-27.489s-42.92-7.879-42.92 32.869c0 40.76 46.46 40.86 46.46 40.86s53.33-2.03 56.08-60.495c-7.64-94.223-108.02-94.223-108.02-94.223 0-0.00003-112.3-8.8535-116.89 118.48 0.00008 31.65-0.49541 69.62 80.069 139.77 108.94 94.85 134.99 169.74 146.71 236.5 11.13-66.76 37.19-141.65 146.13-236.5z"/></svg>';

// Кеш gameDirectories з settings (оновлюється у bootstrapApp / після setup).
// Гра вважається "готовою до перекладу" лише якщо її директорію вказано.
let _gameDirsCache = {};
async function refreshGameDirsCache() {
  try {
    const s = await window.kh1.setup.status();
    _gameDirsCache = (s && s.gameDirectories) || {};
  } catch (_) { _gameDirsCache = {}; }
}
function _gameHasDir(gameId) {
  const v = _gameDirsCache && _gameDirsCache[gameId];
  return !!(v && String(v).trim());
}

function renderGameCard(game) {
  const card = document.createElement('button');
  card.type = 'button';
  // Гра доступна тільки якщо: (a) gamesConfig.enabled (статичний support flag),
  // (b) користувач указав директорію цієї гри у setup'і.
  const hasDir = _gameHasDir(game.id);
  const isReady = game.enabled && hasDir;
  card.className = 'game-card' + (isReady ? '' : ' disabled');
  card.dataset.gameId = game.id;
  card.setAttribute('role', 'listitem');
  if (!isReady) {
    card.disabled = true;
    card.setAttribute('aria-disabled', 'true');
    if (!game.enabled) {
      card.setAttribute('data-i18n-title', 'gameSoonTooltip');
      card.title = (window.i18n && window.i18n.t('gameSoonTooltip')) || 'Підтримка з’явиться пізніше';
    } else {
      card.setAttribute('data-i18n-title', 'gameNoDirTooltip');
      card.title = (window.i18n && window.i18n.t('gameNoDirTooltip')) ||
                   'Спочатку вкажи директорію цієї гри в Settings → ↺ Перевідкрити setup';
    }
  } else {
    card.setAttribute('aria-label', game.name);
  }

  // Cover
  const cover = document.createElement('div');
  cover.className = 'game-cover';
  if (game.coverGrad && !game.image) cover.style.background = game.coverGrad;

  if (game.image) {
    const img = document.createElement('img');
    img.src = game.image;
    img.alt = '';
    cover.appendChild(img);
  } else {
    const heart = document.createElement('div');
    heart.className = 'game-cover-heart';
    heart.innerHTML = HEART_SVG;
    cover.appendChild(heart);
    const t = document.createElement('div');
    t.className = 'game-cover-title';
    t.textContent = game.title;
    cover.appendChild(t);
  }
  const ovl = document.createElement('div');
  ovl.className = 'game-cover-overlay';
  cover.appendChild(ovl);

  if (!game.enabled) {
    const ribbon = document.createElement('div');
    ribbon.className = 'game-ribbon';
    ribbon.setAttribute('data-i18n', 'comingSoon');
    ribbon.textContent = (window.i18n && window.i18n.t('comingSoon')) || 'Coming Soon';
    card.appendChild(ribbon);
  } else if (!hasDir) {
    // Картка enabled, але директорія не задана — підказка, що треба зробити.
    const ribbon = document.createElement('div');
    ribbon.className = 'game-ribbon game-ribbon-setup';
    ribbon.setAttribute('data-i18n', 'gameNeedsSetup');
    ribbon.textContent = (window.i18n && window.i18n.t('gameNeedsSetup')) || 'Setup needed';
    card.appendChild(ribbon);
  }

  card.appendChild(cover);

  // Info
  const info = document.createElement('div');
  info.className = 'game-info';
  const name = document.createElement('h3');
  name.className = 'game-name';
  name.textContent = game.name;
  const sub = document.createElement('p');
  sub.className = 'game-subtitle';
  sub.textContent = game.subtitle;
  const status = document.createElement('span');
  status.className = 'game-status status-' + game.status;
  const statusKey = game.status === 'ready' ? 'gameStatusReady' : 'gameStatusSoon';
  status.setAttribute('data-i18n', statusKey);
  status.textContent = _gameStatusLabel(game.status);
  info.appendChild(name);
  info.appendChild(sub);
  info.appendChild(status);
  card.appendChild(info);

  if (isReady && typeof game.onSelect === 'function') {
    card.addEventListener('click', () => game.onSelect());
  } else if (game.enabled && !hasDir) {
    // Клік по сірій картці — підказати куди йти.
    card.addEventListener('click', () => {
      if (typeof toast === 'function') {
        toast(card.title, 'info', 5000);
      }
    });
  }
  return card;
}

function renderHome() {
  if (!homeGrid) return;
  homeGrid.innerHTML = '';
  for (const g of gamesConfig) homeGrid.appendChild(renderGameCard(g));
}

function showHome() {
  if (!homeScreen || !appRoot) return;
  hideSetup();
  homeScreen.classList.remove('hidden');
  homeScreen.setAttribute('aria-hidden', 'false');
  appRoot.classList.add('hidden');
}
function hideHome() {
  if (!homeScreen || !appRoot) return;
  homeScreen.classList.add('hidden');
  homeScreen.setAttribute('aria-hidden', 'true');
  appRoot.classList.remove('hidden');
}

// =====================================================================
// Setup / Onboarding screen
// =====================================================================
//
// Перший запуск (або після `Перевідкрити setup` у Settings): користувач
// обирає активну гру + директорії (gameDir, tools, textAssets), натискає
// «Підготувати середовище» — main process завантажує OpenKH/KHPCPatchManager
// у tools-теку і пише setupCompleted=true. Далі — звичайний home-screen.
const setupScreen = document.getElementById('setup-screen');
const setupGameList = document.getElementById('setup-game-list');
const setupToolsDir  = document.getElementById('setup-tools-dir');
const setupAssetsDir = document.getElementById('setup-assets-dir');
const setupRunBtn    = document.getElementById('setup-run');
const setupSkipBtn   = document.getElementById('setup-skip-download');
const setupProgress  = document.getElementById('setup-progress');
const setupProgressFill    = document.getElementById('setup-progress-fill');
const setupProgressPhase   = document.getElementById('setup-progress-phase');
const setupProgressPercent = document.getElementById('setup-progress-percent');
const setupProgressMessage = document.getElementById('setup-progress-message');

// Локальний стан, який пишеться в IPC при кліку «Підготувати».
const _setupState = {
  activeGame: '',
  gameDirectories: {},   // { [gameId]: path }
  toolsDir: '',
  textAssetsDir: ''
};
let _setupOffProgress = null;  // unsubscribe handle

function showSetup() {
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
function hideSetup() {
  if (!setupScreen) return;
  setupScreen.classList.add('hidden');
  setupScreen.setAttribute('aria-hidden', 'true');
}

function _setupRenderGames() {
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

function _setupRefreshRunBtn() {
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

function _setupResetProgressUi() {
  if (setupProgress) setupProgress.classList.remove('error', 'done');
  if (setupProgressFill) setupProgressFill.style.width = '0%';
  if (setupProgressPercent) setupProgressPercent.textContent = '';
  if (setupProgressPhase) setupProgressPhase.textContent = '—';
  if (setupProgressMessage) setupProgressMessage.textContent = '';
}

// Мапа phase → i18n-ключ. Сам label повертає `_setupPhaseLabel()` з
// поточної мови (щоб перемикач EN/UA впливав одразу).
const SETUP_PHASE_KEYS = {
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
function _setupPhaseLabel(phase) {
  const key = SETUP_PHASE_KEYS[phase];
  if (key && window.i18n) return window.i18n.t(key);
  return phase || '';
}

function _setupOnProgress(p) {
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

async function _setupRun(skipDownload) {
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
    if (typeof toast === 'function') toast(r.error, 'error', 6000);
    if (setupRunBtn) setupRunBtn.disabled = false;
    if (setupSkipBtn) setupSkipBtn.disabled = false;
    return;
  }

  if (r && r.warnings && r.warnings.length) {
    for (const w of r.warnings) {
      if (typeof toast === 'function') toast(w, 'error', 5000);
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
    if (r.activeGame && typeof enterEditor === 'function') {
      const g = gamesConfig.find(x => x.id === r.activeGame);
      if (g && g.enabled) enterEditor(r.activeGame);
    }
  }, 600);
}

async function initSetupFromState(state) {
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
async function bootstrapApp() {
  let state;
  try { state = await window.kh1.setup.status(); }
  catch (_) { state = null; }

  // Кеш gameDirectories для home-cards (грейаут якщо директорії немає).
  _gameDirsCache = (state && state.gameDirectories) || {};
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
const _setupToolsPick = document.getElementById('setup-tools-pick');
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
const _setupAssetsPick = document.getElementById('setup-assets-pick');
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
const _settingsReopenSetup = document.getElementById('settings-reopen-setup');
if (_settingsReopenSetup) {
  _settingsReopenSetup.addEventListener('click', async () => {
    try { await window.kh1.setup.reset(); } catch (_) {}
    if (typeof hideSettings === 'function') hideSettings();
    // Перечитуємо current state (щоб у setup-формі заповнилися останні шляхи).
    let state = null;
    try { state = await window.kh1.setup.status(); } catch (_) {}
    if (state) await initSetupFromState(state);
    showSetup();
  });
}

// Поточна обрана гра (id з gamesConfig) — впливає на фільтрацію списку
// файлів у translate-режимі та на доступні режими (Kerning лише для KH1).
let _currentGameId = null;
function getCurrentGame() {
  return gamesConfig.find(g => g.id === _currentGameId) || null;
}
function getCurrentGameFormats() {
  const g = getCurrentGame();
  return (g && g.formats) || null;
}

function enterEditor(gameId) {
  const newGameId = gameId || _currentGameId || 'kh1-final-mix';
  const gameChanged = newGameId !== _currentGameId;
  _currentGameId = newGameId;
  hideHome();

  const isKh1 = _currentGameId === 'kh1-final-mix';
  const isBbs = _currentGameId === 'kh-bbs-final-mix';
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

  // Якщо гра змінилась — повністю скидаємо translate-state, бо settings,
  // файли, slots, glossary тепер інші.
  if (gameChanged && typeof resetTranslateState === 'function') {
    resetTranslateState();
  }

  if (typeof setMode === 'function') setMode(isKh1 ? 'editor' : 'translate');

  // First-run settings перевірка для поточної гри (один раз на сесію).
  if (!enterEditor._firstRunChecked) {
    enterEditor._firstRunChecked = true;
    if (typeof maybeFirstRunSettings === 'function') maybeFirstRunSettings();
  }
  // KH1-specific .knj/.dds автозавантаження — лише для KH1, лише раз.
  if (isKh1 && !enterEditor._knjLoaded) {
    enterEditor._knjLoaded = true;
    if (typeof kAutoLoadKnjOnBoot === 'function') kAutoLoadKnjOnBoot();
  }
}

// Скидаємо все що належить translate-режиму, щоб при перемиканні гри
// не лишалось stale-контенту (DOM, slots, settings, file selection).
function resetTranslateState() {
  if (!tState) return;
  // Скидаємо pending autosave-таймери: інакше таймер попередньої гри
  // спрацює вже з новими settings і запише TSV/глосарій не в ту теку.
  if (_tAutoSaveTimer) { clearTimeout(_tAutoSaveTimer); _tAutoSaveTimer = null; }
  if (_gAutoSaveTimer) { clearTimeout(_gAutoSaveTimer); _gAutoSaveTimer = null; }
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
  gState.translations = {};
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

function goHome() {
  showHome();
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
    const modeSel = document.getElementById('editor-decode-mode');
    const decodeMode = (modeSel && modeSel.value) || 'smart';
    const result = await window.kh1.openFile({ decodeMode });
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
  if (viewBbsFont) viewBbsFont.classList.toggle('hidden', mode !== 'bbs-font');
  modeEditorBtn.classList.toggle('active', mode === 'editor');
  modeTranslateBtn.classList.toggle('active', mode === 'translate');
  modeKerningBtn.classList.toggle('active', mode === 'kerning');
  if (modeBbsFontBtn) modeBbsFontBtn.classList.toggle('active', mode === 'bbs-font');
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
  // Сховати/показати dir-rows під обрану гру (BBS не використовує RUS-теку).
  applyGameDirsVisibility();
  settingsOverlay.classList.remove('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'false');
}

function applyGameDirsVisibility() {
  const game = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
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

function hideSettings() {
  settingsOverlay.classList.add('hidden');
  settingsOverlay.setAttribute('aria-hidden', 'true');
}

async function pickAndSetDir(key, inputEl, title) {
  const dir = await window.kh1.translate.pickDirectory(title);
  if (!dir) return;
  inputEl.value = dir;
  tState.settings[key] = dir;
  // Зберігаємо лише змінений ключ — у per-game scope (engDir/rusDir/tsvDir
  // /outDir/lastFile належать поточній грі).
  await window.kh1.translate.saveSettings({ [key]: dir }, _currentGameId);
  toast(window.i18n.t('toastSavedKv', {key, dir}), 'success');
  // Перезавантажити список файлів якщо змінився source-dir поточної гри.
  const game = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
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

// =====================================================================
// Translate mode
// =====================================================================
async function initTranslateMode() {
  try {
    tState.settings = await window.kh1.translate.getSettings(_currentGameId) || tState.settings;
  } catch (_) {}

  // Source dir для списку файлів — для KH1 це rusDir, для BBS це engDir.
  const game = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
  const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
  if (!tState.settings[sourceDirKey]) {
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
  const game = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
  const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
  const sourceDir = tState.settings[sourceDirKey];
  if (!sourceDir) return;
  try {
    const r = await window.kh1.translate.listFiles(sourceDir);
    tState.files = (r.files || []).slice().sort((a, b) => a.rel.localeCompare(b.rel));
  } catch (e) {
    tState.files = [];
    toast(window.i18n.t('toastReadRusFail', {msg: e.message}), 'error');
  }

  // Two filters: (а) safe-mode → лише isTranslatable, (б) game-formats →
  // лише kind'и, що належать обраній грі (KH1 vs BBS).
  const gameFormats = (typeof getCurrentGameFormats === 'function') ? getCurrentGameFormats() : null;
  let visible = tState.safeMode
    ? tState.files.filter(f => f.isTranslatable)
    : tState.files;
  if (gameFormats && gameFormats.length) {
    visible = visible.filter(f => gameFormats.includes(f.kind));
  }

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
      'У списку з’являться файли невпізнаних форматів. Редактор їх не вміє безпечно ' +
      'розпарсити/перепакувати — compose таких файлів може зламати гру ' +
      '(краш або undefined behavior).\n\n' +
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

  // Запам'ятати як "останній файл" + відновити позицію прокрутки.
  // lastFile per-game (KH1 та BBS мають різні останні файли).
  tState.settings.lastFile = rel;
  window.kh1.translate.saveSettings({ lastFile: rel }, _currentGameId).catch(() => {});
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

// Зберегти все перед закриттям вікна. Main перехоплює 'close', шле нам
// 'app:before-close' і чекає closeReady() (або 3с таймаут) — тому тут можна
// спокійно дочекатися async-запису TSV та глосарію.
if (window.kh1.app && window.kh1.app.onBeforeClose) {
  window.kh1.app.onBeforeClose(async () => {
    try { await flushTsvAutoSave(); } catch (_) {}
    try { await flushGlossaryAutoSave(); } catch (_) {}
    window.kh1.app.closeReady();
  });
}

function mergeTsvIntoSlots(content) {
  const tsvByOff = tsvFormat.overridesByOffset(content);
  if (!tsvByOff) return 0;
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
  // Не зберігаємо stub-и (ukText === english) — у TSV лишається тільки реальний переклад
  return tsvFormat.build(tState.slots, { ukOf: s => (isRealTranslation(s) ? s.ukText : '') });
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
  const defaultName = tState.currentRel.replace(/[/\\]/g, '_') + '.txt';
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
  // Required dirs варіюються по грі: KH1 = engDir + rusDir, BBS = тільки engDir.
  const game = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
  const requiredDirs = (game && game.dirs && game.dirs.includes('rusDir'))
    ? ['engDir', 'rusDir']
    : ['engDir'];
  for (const k of requiredDirs) {
    if (!tState.settings[k]) {
      toast(window.i18n.t('toastConfigEngRus'), 'error');
      openSettings();
      return;
    }
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

function getGlossaryRenderOrder() {
  const sort = (gState.filter && gState.filter.sort) || 'default';
  const idxs = gState.entries.map((_, i) => i);
  if (sort === 'en-len-desc') {
    idxs.sort((a, b) => gState.entries[b].english.length - gState.entries[a].english.length);
  } else if (sort === 'en-len-asc') {
    idxs.sort((a, b) => gState.entries[a].english.length - gState.entries[b].english.length);
  } else if (sort === 'uk-len-desc') {
    idxs.sort((a, b) => {
      const ukA = gState.translations[gState.entries[a].english] || '';
      const ukB = gState.translations[gState.entries[b].english] || '';
      return ukB.length - ukA.length;
    });
  } else if (sort === 'count-desc') {
    idxs.sort((a, b) => (gState.entries[b].count || 0) - (gState.entries[a].count || 0));
  }
  return idxs;
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
  const order = getGlossaryRenderOrder();
  for (const i of order) {
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

// Кирилично-латинські look-alike — у KH1 один і той самий гліф у шрифті
// має той самий бай т, тому розпарсений ENG-файл з overlay дає Cyrillic-look
// замість Latin (P→Р, o→о, p→р тощо). Нормалізуємо обидва напрямки до
// Latin для пошуку, щоб «Press» матчив і «Рress».
const LOOKALIKE_TO_LATIN = {
  'А': 'a', 'В': 'b', 'С': 'c', 'Е': 'e', 'Н': 'h', 'К': 'k', 'М': 'm',
  'О': 'o', 'Р': 'p', 'Т': 't', 'Х': 'x', 'У': 'y', 'З': 'z',
  'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'к': 'k', 'м': 'm',
  'о': 'o', 'р': 'p', 'т': 't', 'х': 'x', 'у': 'y'
};
function normalizeLookalikes(s) {
  let out = '';
  for (const ch of s) out += LOOKALIKE_TO_LATIN[ch] || ch;
  return out.toLowerCase();
}

function applyGlossaryFilter() {
  const searchRaw = (gState.filter.search || '');
  const search = normalizeLookalikes(searchRaw);
  const mode = gState.filter.mode || 'all';
  const rowEls = gRows.querySelectorAll('.t-row');
  for (const rowEl of rowEls) {
    const idx = parseInt(rowEl.dataset.gidx, 10);
    const entry = gState.entries[idx];
    if (!entry) continue;
    const uk = gState.translations[entry.english] || '';
    let hide = false;
    if (search && normalizeLookalikes(entry.english).indexOf(search) === -1) hide = true;
    if (mode === 'untranslated' && uk) hide = true;
    if (mode === 'translated' && !uk) hide = true;
    if (mode === 'same-as-en' && uk !== entry.english) hide = true;
    if (mode === 'token-issues') {
      if (!uk || validateTokens(entry.english, uk).ok) hide = true;
    }
    rowEl.classList.toggle('hidden', hide);
  }
}

function refreshGlossaryProgress() {
  const total = gState.entries.length;
  let done = 0, sameEn = 0, tokenIssues = 0;
  for (const e of gState.entries) {
    const uk = gState.translations[e.english];
    if (uk && uk.trim()) {
      done++;
      if (uk === e.english) sameEn++;
      if (!validateTokens(e.english, uk).ok) tokenIssues++;
    }
  }
  const untrans = total - done;
  const pct = total > 0 ? Math.round(100 * done / total) : 0;
  gStat.textContent = total > 0
    ? done + ' / ' + total + ' (' + pct + '%)'
    : '—';

  // Dashboard
  if (gDashboard) {
    if (total > 0) {
      gDashboard.removeAttribute('hidden');
      if (gDashDone) gDashDone.textContent = String(done);
      if (gDashTotal) gDashTotal.textContent = String(total);
      if (gDashPct) gDashPct.textContent = pct + '%';
      if (gDashBarFill) gDashBarFill.style.width = pct + '%';
      if (gDashUntrans) gDashUntrans.textContent = String(untrans);
      if (gDashSameEn) gDashSameEn.textContent = String(sameEn);
      if (gDashIssues) gDashIssues.textContent = String(tokenIssues);
    } else {
      gDashboard.setAttribute('hidden', 'hidden');
    }
  }

  if (tState.subtab === 'glossary') {
    tProgress.textContent = gStat.textContent;
    tStatus.textContent = 'Глосарій · ' + (gState.dirty ? '● незбережено' : 'збережено');
  }

  gSave.disabled = !tState.settings.tsvDir;
  // compose precondition залежить від гри (BBS не потребує rusDir)
  const _g = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
  const _needsRus = !!(_g && _g.dirs && _g.dirs.includes('rusDir'));
  gComposeAll.disabled = total === 0 || done === 0 ||
    !tState.settings.engDir || (_needsRus && !tState.settings.rusDir) || !tState.settings.outDir;
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
  // BBS не вимагає rusDir; KH1 вимагає engDir+rusDir+outDir.
  const game = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
  const needsRus = !!(game && game.dirs && game.dirs.includes('rusDir'));
  if (!tState.settings.engDir || (needsRus && !tState.settings.rusDir) || !tState.settings.outDir) {
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

  // Колонкова розкладка варіюється по грі:
  //   KH1 HTML (Pro100luk-style):   col 0 = EN,    col 1 = UK,        \n → {lf}
  //   BBS HTML (моя розкладка):     col 0 = path,  col 1 = EN, col 2 = UK,  \n залишається
  // Якщо у майбутньому з'являться інші формати — додавай у gamesConfig.
  const game = (typeof getCurrentGame === 'function') ? getCurrentGame() : null;
  const importOpts = (game && game.id === 'kh-bbs-final-mix')
    ? { enCol: 1, ukCol: 2, lineBreakToken: null }
    : { enCol: 0, ukCol: 1 };

  let r;
  try { r = await window.kh1.translate.importTranslations(importOpts); }
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
// Будує regex з опціями. Повертає null якщо вираз невалідний (для regex-режиму).
function buildSearchRegex(find, opts) {
  if (!find) return null;
  const caseSensitive = !!(opts && opts.caseSensitive);
  const wholeWord = !!(opts && opts.wholeWord);
  const isRegex = !!(opts && opts.regex);
  let pattern = isRegex ? find : escapeRegex(find);
  if (wholeWord) pattern = '\\b(?:' + pattern + ')\\b';
  try {
    return new RegExp(pattern, 'g' + (caseSensitive ? '' : 'i'));
  } catch (_) { return null; }
}
function countOcc(haystack, needle, opts) {
  // backward-compat: opts може бути boolean (старий caseSensitive flag)
  const o = (typeof opts === 'boolean') ? { caseSensitive: opts } : (opts || {});
  if (!needle || !haystack) return 0;
  const re = buildSearchRegex(needle, o);
  if (!re) return 0;
  return (String(haystack).match(re) || []).length;
}
function replaceAll(text, find, repl, opts) {
  const o = (typeof opts === 'boolean') ? { caseSensitive: opts } : (opts || {});
  if (!find || !text) return text;
  const re = buildSearchRegex(find, o);
  if (!re) return text;
  return String(text).replace(re, repl);
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

function getReplaceOpts() {
  return {
    caseSensitive: repCase.checked,
    wholeWord: repWholeWord && repWholeWord.checked,
    regex: repRegex && repRegex.checked
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function updateReplaceStat() {
  const find = repFind.value;
  const repl = repReplace.value;
  const opts = getReplaceOpts();
  if (!find) {
    repStat.textContent = 'Введіть текст для пошуку...';
    repApply.disabled = true;
    repApply.textContent = 'Замінити';
    if (repPreview) repPreview.classList.add('hidden');
    return;
  }
  // Validate regex
  const testRe = buildSearchRegex(find, opts);
  if (!testRe) {
    repStat.textContent = '⚠ Невалідний regex';
    repApply.disabled = true;
    if (repPreview) repPreview.classList.add('hidden');
    return;
  }
  let totalOcc = 0, entries = 0;
  const previewItems = [];
  for (const en of Object.keys(gState.translations || {})) {
    const v = gState.translations[en];
    const o = countOcc(v, find, opts);
    if (o > 0) {
      totalOcc += o;
      entries++;
      if (previewItems.length < 5) {
        const newV = replaceAll(v, find, repl, opts);
        previewItems.push({ en, oldUk: v, newUk: newV });
      }
    }
  }
  let openSlots = 0;
  if (tState.currentRel && tState.slots && tState.slots.length) {
    for (const slot of tState.slots) {
      if (isRealTranslation(slot) && countOcc(slot.ukText, find, opts) > 0) openSlots++;
    }
  }
  if (totalOcc === 0 && openSlots === 0) {
    repStat.textContent = 'Не знайдено в глосарії або відкритому файлі.';
    repApply.disabled = true;
    repApply.textContent = 'Замінити';
    if (repPreview) repPreview.classList.add('hidden');
    return;
  }
  const parts = [];
  if (totalOcc) parts.push(totalOcc + ' входжень у ' + entries + ' записах глосарія');
  if (openSlots) parts.push(openSlots + ' слот(ів) у відкритому файлі');
  repStat.textContent = 'Знайдено ' + parts.join(', ');
  repApply.disabled = false;
  repApply.textContent = 'Замінити в ' + (entries + openSlots) + ' місцях';

  // Preview перших 5 змін
  if (repPreview && previewItems.length) {
    let html = '';
    for (const it of previewItems) {
      html += '<div class="rep-row">'
            + '<div class="rep-old">- ' + escapeHtml(it.oldUk.slice(0, 200)) + '</div>'
            + '<div class="rep-new">+ ' + escapeHtml(it.newUk.slice(0, 200)) + '</div>'
            + '</div>';
    }
    if (entries > 5) html += '<div class="rep-row" style="text-align:center;color:var(--text-muted)">…ще ' + (entries - 5) + '</div>';
    repPreview.innerHTML = html;
    repPreview.classList.remove('hidden');
  } else if (repPreview) {
    repPreview.classList.add('hidden');
  }
}

async function doReplaceAll() {
  const find = repFind.value;
  const repl = repReplace.value;
  const opts = getReplaceOpts();
  if (!find) return;
  if (!window.confirm('Замінити "' + find + '" → "' + repl + '" у глосарії та відкритому файлі?')) return;

  let changedGloss = 0;
  for (const en of Object.keys(gState.translations || {})) {
    const old = gState.translations[en];
    if (!old) continue;
    if (countOcc(old, find, opts) === 0) continue;
    gState.translations[en] = replaceAll(old, find, repl, opts);
    changedGloss++;
  }

  let changedSlots = 0;
  if (tState.currentRel && tState.slots && tState.slots.length) {
    for (const slot of tState.slots) {
      if (!isRealTranslation(slot)) continue;
      if (countOcc(slot.ukText, find, opts) === 0) continue;
      slot.ukText = replaceAll(slot.ukText, find, repl, opts);
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
if (repWholeWord) repWholeWord.addEventListener('change', updateReplaceStat);
if (repRegex) repRegex.addEventListener('change', updateReplaceStat);

const gFindReplaceBtn = document.getElementById('g-find-replace');
if (gFindReplaceBtn) gFindReplaceBtn.addEventListener('click', showReplace);
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
if (gSortMode) {
  gSortMode.addEventListener('change', (e) => {
    gState.filter.sort = e.target.value;
    renderGlossaryRows(); // re-render у новому порядку
  });
}
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
    let changed = 0, addedLfs = 0, structureFixed = 0;
    for (let i = 0; i < entries.length; i++) {
      const [en, before] = entries[i];
      let after = r.wrapped[i];
      // Post-fix: Auto-wrap використовує splitPrefSuf, який може загубити токени
      // що стоять В СЕРЕДИНІ body (між літерами). Прогоняємо через
      // autoFixStructure щоб відновити повну EN-структуру (всі токени, крапки,
      // пробіли) в результаті.
      if (after) {
        const fixed = autoFixStructure(en, after);
        if (fixed && fixed !== after) { after = fixed; structureFixed++; }
      }
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

// =====================================================================
// Glossary TXT export/import — людино-читабельний формат для роботи поза
// програмою. Блок-структура:
//   [#N]
//   --- EN ---
//   <ключ> (з реальними переносами, {lf} перетворюється на \n)
//   --- UK ---
//   <переклад>
//   === END ===
// На імпорт реальні переноси у UK-секції зворотно конвертуються в {lf}
// (якщо користувач не залишив {lf} власноруч).
// =====================================================================
function buildGlossaryTxt() {
  const out = [];
  const entries = Object.entries(gState.translations).filter(([_, uk]) => uk && uk.trim());
  out.push('# KH1 Glossary Export');
  out.push('# Total: ' + entries.length + ' entries');
  out.push('# ');
  out.push('# Інструкція:');
  out.push('#  • Редагуй ЛИШЕ блоки --- UK ---. EN — це ключ, не змінювати.');
  out.push('#  • Багаторядковий UK — пиши як є, реальні переноси конвертуються у {lf}.');
  out.push('#  • Токени типу {0x04}, {VarItem}, {ColorRed}, {0x06,0x3C} лишай як є.');
  out.push('#  • Якщо UK порожній — запис пропускається при імпорті.');
  out.push('# ============================================================');
  out.push('');
  for (let i = 0; i < entries.length; i++) {
    const [en, uk] = entries[i];
    out.push('[#' + (i + 1) + ']');
    out.push('--- EN ---');
    out.push(en.replace(/\{lf\}/g, '\n'));
    out.push('--- UK ---');
    out.push(uk.replace(/\{lf\}/g, '\n'));
    out.push('=== END ===');
    out.push('');
  }
  return out.join('\n');
}

function parseGlossaryTxt(content) {
  // Повертає { pairs: [{en, uk}], errors: [...] }
  const pairs = [];
  const errors = [];
  const lines = content.split(/\r?\n/);

  let blockOpen = false;
  let section = null; // 'en' | 'uk'
  let enLines = [];
  let ukLines = [];

  function commitBlock() {
    if (!blockOpen) return;
    // НЕ трімимо взагалі — повністю довіряємо TXT-вмісту. Бо trailing space
    // перед {lf} (типу "Tired? {lf}{0x0B}") — це РЕАЛЬНА частина оригіналу
    // гри, і будь-який trim його з'їсть. А export → import має бути lossless.
    let en = enLines.join('\n');
    let uk = ukLines.join('\n');
    // Реальні переноси → {lf} (якщо користувач не лишив {lf} вручну)
    if (en && !en.includes('{lf}') && en.includes('\n')) en = en.replace(/\r?\n/g, '{lf}');
    if (uk && !uk.includes('{lf}') && uk.includes('\n')) uk = uk.replace(/\r?\n/g, '{lf}');
    if (en && uk) pairs.push({ en, uk });
    blockOpen = false;
    section = null;
    enLines = [];
    ukLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith('#') && !blockOpen) continue; // коментарі поза блоками

    if (/^\[#\d+\]\s*$/.test(ln)) {
      commitBlock();
      blockOpen = true;
      continue;
    }
    if (ln.trim() === '--- EN ---') { section = 'en'; continue; }
    if (ln.trim() === '--- UK ---') { section = 'uk'; continue; }
    if (ln.trim() === '=== END ===') { commitBlock(); continue; }

    if (section === 'en') enLines.push(ln);
    else if (section === 'uk') ukLines.push(ln);
  }
  commitBlock(); // на випадок якщо файл закінчується без === END ===
  return { pairs, errors };
}

const gFixStructureBtn = document.getElementById('g-fix-structure');
if (gFixStructureBtn) {
  gFixStructureBtn.addEventListener('click', () => {
    if (!Object.keys(gState.translations).length) {
      toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
    }
    const fixable = [];
    let unfixable = 0;
    for (const en of Object.keys(gState.translations)) {
      const uk = gState.translations[en];
      if (!uk) continue;
      const fixed = autoFixStructure(en, uk);
      if (fixed === null) {
        // Перевіряємо чи воно потребує виправлення (інакше unfixable не лічимо).
        if (!validateTokens(en, uk).ok) unfixable++;
      } else if (fixed !== uk) {
        fixable.push({ en, oldUk: uk, newUk: fixed });
      }
    }
    if (!fixable.length && !unfixable) {
      toast(window.i18n.t('toastFixStructureNothing'), 'info', 4000);
      return;
    }
    const sample = fixable.slice(0, 3).map(c => '• ' + c.en.slice(0, 50) + (c.en.length > 50 ? '…' : ''));
    let msg = window.i18n.t('confirmFixStructure', { n: fixable.length });
    if (sample.length) msg += '\n\n' + sample.join('\n') + (fixable.length > 3 ? '\n…' : '');
    if (unfixable) msg += '\n\n' + window.i18n.t('confirmFixStructureUnfixable', { n: unfixable });
    if (!fixable.length) {
      // Тільки unfixable — повідомляємо без confirm.
      toast(window.i18n.t('toastFixStructureUnfixable', { n: unfixable }), 'error', 6000);
      return;
    }
    if (!confirm(msg)) return;
    for (const c of fixable) gState.translations[c.en] = c.newUk;
    gState.dirty = true;
    renderGlossaryRows();
    refreshGlossaryProgress();
    scheduleGlossaryAutoSave();
    let toastMsg = window.i18n.t('toastFixStructureDone', { n: fixable.length });
    if (unfixable) toastMsg += ' · ' + window.i18n.t('toastFixStructureRemaining', { n: unfixable });
    toast(toastMsg, 'success', 6000);
  });
}

const gSyncPaddingBtn = document.getElementById('g-sync-padding');
if (gSyncPaddingBtn) {
  gSyncPaddingBtn.addEventListener('click', () => {
    if (!Object.keys(gState.translations).length) {
      toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
    }
    const candidates = [];
    for (const en of Object.keys(gState.translations)) {
      const uk = gState.translations[en];
      if (!uk) continue;
      const fixed = syncPaddingFromEn(en, uk);
      if (fixed && fixed !== uk) candidates.push({ en, oldUk: uk, newUk: fixed });
    }
    if (!candidates.length) {
      toast(window.i18n.t('toastSyncPaddingNothing'), 'info', 4000);
      return;
    }
    const sample = candidates.slice(0, 3).map(c => '• ' + c.en.slice(0, 50) + (c.en.length > 50 ? '…' : ''));
    const msg = window.i18n.t('confirmSyncPadding', { n: candidates.length }) +
      '\n\n' + sample.join('\n') +
      (candidates.length > 3 ? '\n…' : '');
    if (!confirm(msg)) return;
    for (const c of candidates) gState.translations[c.en] = c.newUk;
    gState.dirty = true;
    renderGlossaryRows();
    refreshGlossaryProgress();
    scheduleGlossaryAutoSave();
    toast(window.i18n.t('toastSyncPaddingDone', { n: candidates.length }), 'success', 5000);
  });
}

const gExportTxtBtn = document.getElementById('g-export-txt');
const gImportTxtBtn = document.getElementById('g-import-txt');

if (gExportTxtBtn) {
  gExportTxtBtn.addEventListener('click', async () => {
    if (!Object.keys(gState.translations).length) {
      toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
    }
    const content = buildGlossaryTxt();
    try {
      const r = await window.kh1.translate.exportFileTxt({
        defaultName: 'kh1_glossary.txt',
        content
      });
      if (r.canceled) return;
      if (r.error) { toast(window.i18n.t('toastExportError', {msg: r.error}), 'error', 6000); return; }
      toast(window.i18n.t('toastExportedTxt', {path: r.filePath, n: r.byteLength}), 'success', 5000);
    } catch (e) {
      toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
    }
  });
}

if (gImportTxtBtn) {
  gImportTxtBtn.addEventListener('click', async () => {
    try {
      const r = await window.kh1.translate.importFileTxt();
      if (r.canceled) return;
      if (r.error) { toast(window.i18n.t('toastImportError', {msg: r.error}), 'error', 6000); return; }
      const parsed = parseGlossaryTxt(r.content);
      if (!parsed.pairs.length) {
        toast(window.i18n.t('toastNoValidPairs'), 'error'); return;
      }
      // Застосовуємо з token-guard (як HTML-імпорт): пропускаємо пари з втратою
      // не-{lf} токенів, щоб не переписати глосарій сміттям з помилок перекладача.
      let added = 0, updated = 0, unchanged = 0, tokensBroken = 0;
      for (const p of parsed.pairs) {
        if (!validateTokens(p.en, p.uk).ok) { tokensBroken++; continue; }
        const cur = gState.translations[p.en];
        if (cur === p.uk) { unchanged++; continue; }
        if (cur === undefined || cur === null || cur === '') {
          gState.translations[p.en] = p.uk;
          added++;
        } else {
          gState.translations[p.en] = p.uk;
          updated++;
        }
      }
      if (added || updated) {
        gState.dirty = true;
        renderGlossaryRows();
        refreshGlossaryProgress();
        scheduleGlossaryAutoSave();
      }
      const parts = [];
      if (added) parts.push(window.i18n.t('toastTxtImportAdded', { n: added }));
      if (updated) parts.push(window.i18n.t('toastTxtImportUpdated', { n: updated }));
      if (unchanged) parts.push(window.i18n.t('toastTxtImportUnchanged', { n: unchanged }));
      if (tokensBroken) parts.push(window.i18n.t('toastTxtImportTokensBroken', { n: tokensBroken }));
      toast(parts.join(' · ') || window.i18n.t('toastTxtImportEmpty'), 'success', 6500);
    } catch (e) {
      toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
    }
  });
}

modeEditorBtn.addEventListener('click', () => setMode('editor'));
modeTranslateBtn.addEventListener('click', () => setMode('translate'));
modeKerningBtn.addEventListener('click', () => setMode('kerning'));
if (modeBbsFontBtn) modeBbsFontBtn.addEventListener('click', () => setMode('bbs-font'));

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
  _kReverseCharMap = null;   // буде перебудовано при першому пошуку за символом
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

// Перерендерити preview, коли canvas змінює CSS-ширину (resize вікна,
// перемикання режиму, перший показ після прихованого стану).
if (kPreviewCanvas && typeof ResizeObserver !== 'undefined') {
  let _kRO = null;
  const _kROCb = () => {
    const w = Math.max(1, kPreviewCanvas.clientWidth);
    if (w !== _kPreviewLastW && typeof kRenderPreview === 'function') {
      kRenderPreview();
    }
  };
  _kRO = new ResizeObserver(_kROCb);
  _kRO.observe(kPreviewCanvas);
}

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

// Lazy reverse charMap { char → byte }. Будується з kState.charMap при першому
// зверненні; kEnsureCharMap гарантує що kState.charMap не null до цього моменту.
let _kReverseCharMap = null;
function _kRebuildReverseCharMap() {
  _kReverseCharMap = Object.create(null);
  if (!kState.charMap) return;
  for (const k of Object.keys(kState.charMap)) {
    const ch = kState.charMap[k];
    if (typeof ch === 'string' && ch.length === 1 && !_kReverseCharMap[ch]) {
      _kReverseCharMap[ch] = parseInt(k, 10);
    }
  }
}
function _kCharToGlyphIdx(ch) {
  if (!_kReverseCharMap) _kRebuildReverseCharMap();
  const byte = _kReverseCharMap[ch];
  if (typeof byte !== 'number') return -1;
  return byte - BYTE_GLYPH_OFFSET;
}

function kParseFilter(text) {
  // Підтримує:
  //   • числові індекси/діапазони:  "0-50, 100, 120-130"
  //   • літерали символів:          "Q", "Q a 5", "AB" (кожен символ окремо)
  // Числове і символьне можна змішувати: "0-32 Q a 100-110".
  if (!text || !text.trim()) return null;
  const set = new Set();
  for (const part of text.split(/[,\s]+/)) {
    if (!part) continue;
    const numMatch = part.match(/^(\d+)(?:-(\d+))?$/);
    if (numMatch) {
      const a = parseInt(numMatch[1], 10);
      const b = numMatch[2] ? parseInt(numMatch[2], 10) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
      continue;
    }
    // Не число — інтерпретуємо кожен символ як гліф
    for (const ch of Array.from(part)) {
      const idx = _kCharToGlyphIdx(ch);
      if (idx >= 0) set.add(idx);
    }
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
  // Live-preview потребує і .knj, і .dds — без них рендер canvas ні на що
  // не спирається. Disable + плейсхолдер краще, ніж дозволити друкувати у
  // нікуди (користувач не розуміє чому canvas мовчить).
  if (kPreviewText) {
    const ready = !!(kState.knjBuf && kState.atlasPx);
    kPreviewText.disabled = !ready;
    kPreviewText.placeholder = ready
      ? (window.i18n ? window.i18n.t('previewPlaceholder') : 'Live-preview: введіть текст…')
      : (window.i18n ? window.i18n.t('previewNeedKnj') : 'Спочатку завантажте .knj/.dds');
  }
}

async function kApplyKnjLoaded(r, opts) {
  // Спільний код: оновити kState, перерендерити, запустити auto-find DDS.
  // opts.silent=true   — без toast'у про завантажений knj (для авто-load на старті).
  // opts.preferDds     — спочатку спробувати завантажити саме цей збережений шлях,
  //                       перш ніж шукати DDS поряд з .knj.
  kState.knjPath = r.filePath;
  kState.knjBuf = new Uint8Array(r.data);
  kState.dirty = false;
  kBuildGlyphList();
  kRenderGrid();
  kRefreshStatus();
  if (typeof kSchedulePreview === 'function') kSchedulePreview();
  if (!opts || !opts.silent) {
    toast(window.i18n.t('toastKnjLoaded', {file: kFilenameFromPath(r.filePath), n: r.data.byteLength}), 'success');
  }
  // 1) Спробувати збережений lastDdsPath (точний користувацький вибір)
  let ddsLoaded = false;
  if (opts && opts.preferDds) {
    try {
      const d = await window.kh1.kerning.loadDdsFromPath(opts.preferDds);
      if (d && d.ok) {
        kState.ddsPath = d.filePath;
        kState.atlasPx = decodeDds(d.data);
        ddsLoaded = true;
      }
    } catch (_) { /* провалюємось у autoFind */ }
  }
  // 2) Якщо збереженого нема або не вдалось — auto-find поряд з .knj
  if (!ddsLoaded) {
    try {
      const a = await window.kh1.kerning.autoFindDds(r.filePath);
      if (a.ok) {
        kState.ddsPath = a.filePath;
        kState.atlasPx = decodeDds(a.data);
        ddsLoaded = true;
        if (!opts || !opts.silent) {
          toast(window.i18n.t('toastKnjAutoDds', {file: kFilenameFromPath(a.filePath)}), 'info', 4000);
        }
      }
    } catch (e) {
      toast(window.i18n.t('toastKnjDdsFoundFail', {msg: e.message}), 'error', 6000);
    }
  }
  if (ddsLoaded) {
    kRenderGrid();
    kRefreshStatus();
    // Атлас тепер завантажений — перерендерити preview, щоб користувач
    // одразу бачив печатний текст замість "Завантажте .dds...".
    if (typeof kSchedulePreview === 'function') kSchedulePreview();
  }
}

async function kLoadKnj() {
  try {
    const r = await window.kh1.kerning.openKnj();
    if (r.canceled) return;
    if (r.error || !r.ok) { toast(window.i18n.t('toastError', {msg: r.error || '?'}), 'error'); return; }
    await kApplyKnjLoaded(r);
  } catch (e) {
    toast(window.i18n.t('toastLoadError', {msg: e.message}), 'error');
  }
}

// Авто-завантаження останнього .knj + .dds зі settings на старті.
async function kAutoLoadKnjOnBoot() {
  try {
    const settings = await window.kh1.translate.getSettings();
    if (!settings || !settings.lastKnjPath) return;
    const r = await window.kh1.kerning.loadKnjFromPath(settings.lastKnjPath);
    if (r && r.ok) {
      await kApplyKnjLoaded(r, { silent: false, preferDds: settings.lastDdsPath || null });
    }
  } catch (_) { /* тихо ігноруємо — користувач сам завантажить вручну */ }
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

// Зберігаємо останньо-зрендерену ширину, щоб ResizeObserver міг визначити
// зміну CSS-розміру canvas і перерендерити (інакше буфер 1100px розтягується
// під CSS і текст виглядає кривим, поки користувач не змінить розмір вікна).
let _kPreviewLastW = 0;
async function kRenderPreview() {
  if (!kPreviewCanvas) return;
  const ctx = kPreviewCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Розтягнути canvas-px під реальну ширину
  const cssW = Math.max(1, kPreviewCanvas.clientWidth) || 1100;
  if (kPreviewCanvas.width !== cssW) kPreviewCanvas.width = cssW;
  _kPreviewLastW = cssW;
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
  // Initialize disabled state + placeholder за відсутністю knj/dds.
  if (typeof kRefreshStatus === 'function') kRefreshStatus();
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
  // Ctrl+E / Ctrl+I — Експорт/Імпорт TXT (тільки коли в Глосарії та поза input'ами)
  const tag = e.target && e.target.tagName;
  const inField = (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable));
  if (state.mode === 'translate' && tState.subtab === 'glossary' && e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      if (gExportTxtBtn) gExportTxtBtn.click();
      return;
    }
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      if (gImportTxtBtn) gImportTxtBtn.click();
      return;
    }
  }
  // Ctrl+→ / Ctrl+← — наступний/попередній файл у Translate (Files subtab)
  if (state.mode === 'translate' && tState.subtab !== 'glossary' && e.ctrlKey && !inField) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const fileSel = tFileSel;
      if (fileSel && fileSel.options.length > 1) {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const cur = fileSel.selectedIndex;
        const next = Math.max(0, Math.min(fileSel.options.length - 1, cur + dir));
        if (next !== cur) {
          fileSel.selectedIndex = next;
          fileSel.dispatchEvent(new Event('change'));
        }
      }
    }
  }
});

// =====================================================================
// Drag-drop файлів на вікно: автоматично маршрутизуємо за розширенням
//   .knj / .dds → завантажити у Kerning-режим
//   .txt       → запропонувати імпорт у Глосарій
// =====================================================================
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  for (const f of files) {
    // Electron 32+ не має File.path — беремо шлях через preload/webUtils.
    const path = (window.kh1.getPathForFile && window.kh1.getPathForFile(f)) || f.name;
    const ext = (path.match(/\.([a-z0-9]+)$/i) || [null, ''])[1].toLowerCase();
    if (ext === 'knj') {
      setMode('kerning');
      try {
        const r = await window.kh1.kerning.loadKnjFromPath(path);
        if (r && r.ok) await kApplyKnjLoaded(r);
      } catch (err) {
        toast(window.i18n.t('toastError', {msg: err.message}), 'error');
      }
    } else if (ext === 'dds') {
      // Якщо .knj вже завантажений — апдейтимо атлас
      try {
        const buf = await f.arrayBuffer();
        kState.ddsPath = path;
        kState.atlasPx = decodeDds(buf);
        if (state.mode !== 'kerning') setMode('kerning');
        kRenderGrid();
        kRefreshStatus();
        toast('DDS завантажено: ' + (path.split(/[/\\]/).pop()), 'success');
      } catch (err) {
        toast(window.i18n.t('toastError', {msg: err.message}), 'error');
      }
    } else if (ext === 'txt') {
      // Підказка про імпорт в глосарій
      if (confirm('Імпортувати "' + (path.split(/[/\\]/).pop()) + '" у Глосарій?')) {
        setMode('translate');
        setSubtab('glossary');
        if (gImportTxtBtn) gImportTxtBtn.click();
      }
    }
  }
});

// Menu handlers — context-aware Ctrl+S
window.kh1.onMenu('menu:open', () => {
  if (state.mode === 'editor') doOpen();
});
window.kh1.onMenu('menu:save', () => {
  if (state.mode === 'editor') doSave();
  else if (state.mode === 'translate') {
    // У глосарії — зберігаємо саме глосарій (а не TSV конкретного файлу)
    if (tState.subtab === 'glossary') saveGlossary(false);
    else saveTsvProgress();
  }
});
window.kh1.onMenu('menu:find', () => {
  if (state.mode === 'editor' && !btnFind.disabled) showFind();
  else if (state.mode === 'translate') {
    // У глосарії — фокус на g-search; інакше на t-search
    if (tState.subtab === 'glossary' && gSearch) { gSearch.focus(); gSearch.select(); }
    else { tSearchInput.focus(); tSearchInput.select(); }
  }
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
// i18n: language switcher (in Settings modal) + initial apply
// =====================================================================
const langOpts = document.querySelectorAll('.lang-opt');

function setLangOptsUi(lang) {
  langOpts.forEach(b => b.setAttribute('aria-checked', b.dataset.lang === lang ? 'true' : 'false'));
}

async function applyLanguage(lang, persist) {
  const finalLang = (lang === 'en') ? 'en' : 'uk';
  if (window.i18n) window.i18n.setLang(finalLang);
  setLangOptsUi(finalLang);
  if (persist) {
    try { await window.kh1.translate.saveSettings({ language: finalLang }); } catch (_) {}
    try { await window.kh1.app.setLanguage(finalLang); } catch (_) {}
  }
}

async function initLanguage() {
  // Якщо користувач вже обирав мову — використовуємо її. Інакше визначаємо
  // за Windows-locale (через navigator.language, який в Electron =
  // app.getLocale()): uk-* → 'uk', усе інше → 'en'.
  // Інші мови поки не підтримуються.
  try {
    const s = await window.kh1.translate.getSettings();
    if (s && s.language) {
      await applyLanguage(s.language, false);
      return;
    }
    const sysLocale = (navigator.language || 'en').toLowerCase();
    const detected = sysLocale.startsWith('uk') ? 'uk' : 'en';
    // Persist одразу, щоб надалі не triggerити detection при кожному запуску.
    await applyLanguage(detected, true);
  } catch (_) {
    await applyLanguage('en', false);
  }
}

langOpts.forEach(btn => {
  btn.addEventListener('click', () => applyLanguage(btn.dataset.lang, true));
});

// Theme switcher
const themeOpts = document.querySelectorAll('.theme-opt');
function setThemeOptsUi(theme) {
  themeOpts.forEach(b => b.setAttribute('aria-checked', b.dataset.theme === theme ? 'true' : 'false'));
}
async function applyTheme(theme, persist) {
  const finalTheme = (theme === 'light') ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', finalTheme === 'light');
  setThemeOptsUi(finalTheme);
  if (persist) {
    try { await window.kh1.translate.saveSettings({ theme: finalTheme }); } catch (_) {}
  }
}
async function initTheme() {
  try {
    const s = await window.kh1.translate.getSettings();
    await applyTheme((s && s.theme) || 'dark', false);
  } catch (_) {
    await applyTheme('dark', false);
  }
}
themeOpts.forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme, true));
});

// Title-bar settings button + first-run auto-open.
const tbSettingsBtn = document.getElementById('tb-settings');
if (tbSettingsBtn) tbSettingsBtn.addEventListener('click', openSettings);

// Title-bar brand (KH heart) → повернутися на головну.
const tbHomeBtn = document.getElementById('tb-home');
if (tbHomeBtn) tbHomeBtn.addEventListener('click', goHome);

// Event log drawer wiring.
eventLog.drawer  = document.getElementById('event-log');
eventLog.list    = document.getElementById('event-log-list');
eventLog.emptyEl = document.getElementById('event-log-empty');
eventLog.badge   = document.getElementById('tb-log-badge');

const tbLogBtn = document.getElementById('tb-log');
const elClose  = document.getElementById('event-log-close');
const elClear  = document.getElementById('event-log-clear');

function toggleEventLog() {
  if (!eventLog.drawer) return;
  const wasHidden = eventLog.drawer.classList.contains('hidden');
  eventLog.drawer.classList.toggle('hidden');
  eventLog.drawer.setAttribute('aria-hidden', wasHidden ? 'false' : 'true');
  if (wasHidden) {
    eventLog.unread = 0;
    _logBadgeUpdate();
  }
}
function closeEventLog() {
  if (!eventLog.drawer) return;
  eventLog.drawer.classList.add('hidden');
  eventLog.drawer.setAttribute('aria-hidden', 'true');
}

if (tbLogBtn) tbLogBtn.addEventListener('click', toggleEventLog);
if (elClose)  elClose.addEventListener('click', closeEventLog);
if (elClear)  elClear.addEventListener('click', () => {
  eventLog.items.length = 0;
  eventLog.unread = 0;
  _logBadgeUpdate();
  _logRender();
});

async function maybeFirstRunSettings() {
  try {
    // Перевіряємо щодо ПОТОЧНОЇ гри — якщо її dirs ще не вказані, відкриваємо settings.
    const s = await window.kh1.translate.getSettings(_currentGameId);
    const everConfigured = s && (s.language || s.engDir || s.rusDir || s.tsvDir || s.outDir);
    if (!everConfigured) openSettings();
  } catch (_) {}
}

// Послідовний старт: тема (sync) → мова (await, щоб усі i18n-рядки
// у setup/home рендерились на правильній мові) → home-картки → bootstrap
// (вирішує showSetup() vs showHome() за setupCompleted у main.js).
(async () => {
  try { initTheme(); } catch (_) {}
  try { await initLanguage(); } catch (_) {}
  try { renderHome(); } catch (_) {}
  try { await bootstrapApp(); } catch (_) {}
})();
// maybeFirstRunSettings() та kAutoLoadKnjOnBoot() викликаються з enterEditor()
// при першому вході в редактор (щоб не виконувати KH1-specific логіку, коли
// користувач ще на головному екрані з вибором іншої гри).

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

// =====================================================================
// BBS Font Editor — окрема вкладка для редагування .cod-файлів BBS-шрифтів.
// Workflow: вибираєш теку розпакованого FontEn.arc → шрифт → бачиш атлас
// (HD PNG як фон) з grid-оверлеєм по COD-positions → клік на гліф → правиш
// X/Y/palette/width → save → COD перезаписується.
// =====================================================================
const bfState = {
  arcDir: null,
  hdDir: null,
  fonts: [],          // [{name, infPath, codPath, mtxPath, cluPath}]
  current: null,      // {name, inf, entries, infPath, codPath}
  origEntries: null,  // для reset
  pngUrl: null,
  pngImg: null,
  selected: -1,
  dirty: false,
  zoom: 1,            // CSS scale factor (1 = native px)
  fitMode: false      // true = автопідгін під ширину контейнера
};
const BF_ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

const bfPickArcBtn  = document.getElementById('bf-pick-arc');
const bfPickHdBtn   = document.getElementById('bf-pick-hd');
const bfFontSel     = document.getElementById('bf-font-sel');
const bfPngSel      = document.getElementById('bf-png-sel');
const bfAddBtn      = document.getElementById('bf-add');
const bfDelBtn      = document.getElementById('bf-del');
const bfResetBtn    = document.getElementById('bf-reset');
const bfSaveBtn     = document.getElementById('bf-save');
const bfZoomInBtn   = document.getElementById('bf-zoom-in');
const bfZoomOutBtn  = document.getElementById('bf-zoom-out');
const bfZoomResetBtn= document.getElementById('bf-zoom-reset');
const bfZoomFitBtn  = document.getElementById('bf-zoom-fit');
const bfExportOverlayBtn = document.getElementById('bf-export-overlay');
const bfAtlasWrap   = document.getElementById('bf-atlas-wrap');
const bfFields      = document.getElementById('bf-fields');
const bfList        = document.getElementById('bf-list');
const bfStatus      = document.getElementById('bf-status');
const bfInfo        = document.getElementById('bf-info');
const bfFNoSel      = document.getElementById('bf-no-selection') || null;
const bfFIndex      = document.getElementById('bf-f-index');
const bfFId         = document.getElementById('bf-f-id');
const bfFChar       = document.getElementById('bf-f-char');
const bfFX          = document.getElementById('bf-f-x');
const bfFY          = document.getElementById('bf-f-y');
const bfFPal        = document.getElementById('bf-f-pal');
const bfFWidth      = document.getElementById('bf-f-width');

function bfHex2(n) { return '0x' + n.toString(16).toUpperCase().padStart(4, '0'); }
function bfCharFromId(id) {
  // Декодуємо "видимий" символ з charID — для відображення.
  // ASCII (0x20-0x7E): id безпосередньо ASCII.
  // 0x81xx / 0x82xx etc — спробуємо спитати CTD-codec якщо є.
  const lo = id & 0xFF;
  const hi = (id >> 8) & 0xFF;
  if (hi === 0x00 && lo >= 0x20 && lo < 0x7F) return String.fromCharCode(lo);
  // 2-byte: low byte зазвичай ASCII-наступник
  if ((hi === 0x81 || hi === 0x82) && lo >= 0x40 && lo < 0xFF) {
    // Heuristic: 0x82 0x40+i → ASCII letters
    return '';  // нема надійного маппінгу, показуємо порожньо
  }
  return '';
}

function bfRefreshButtons() {
  if (bfPickHdBtn) bfPickHdBtn.disabled = !bfState.arcDir;
  if (bfFontSel)   bfFontSel.disabled = !bfState.fonts.length;
  if (bfPngSel)    bfPngSel.disabled = !bfState.hdDir;
  if (bfResetBtn)  bfResetBtn.disabled = !bfState.dirty;
  if (bfSaveBtn)   bfSaveBtn.disabled = !bfState.dirty;
  if (bfExportOverlayBtn) bfExportOverlayBtn.disabled = !bfState.current;
}

function bfSetStatus(text) { if (bfStatus) bfStatus.textContent = text || ''; }
function bfSetInfo(text)   { if (bfInfo)   bfInfo.textContent   = text || ''; }

if (bfPickArcBtn) bfPickArcBtn.addEventListener('click', async () => {
  const r = await window.kh1.bbsfont.pickArcDir();
  if (r.canceled) return;
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.arcDir = r.dir;
  bfSetStatus(r.dir);
  // Заповнюємо список шрифтів
  const lr = await window.kh1.bbsfont.listFonts(r.dir);
  if (lr.error) { toast(lr.error, 'error'); return; }
  bfState.fonts = lr.fonts || [];
  while (bfFontSel.firstChild) bfFontSel.removeChild(bfFontSel.firstChild);
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '— виберіть шрифт —';
  bfFontSel.appendChild(blank);
  for (const f of bfState.fonts) {
    const o = document.createElement('option');
    o.value = f.name;
    o.textContent = f.name;
    bfFontSel.appendChild(o);
  }
  bfRefreshButtons();
  toast('Знайдено шрифтів: ' + bfState.fonts.length, 'success', 2500);
});

if (bfPickHdBtn) bfPickHdBtn.addEventListener('click', async () => {
  const r = await window.kh1.bbsfont.pickHdDir();
  if (r.canceled) return;
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.hdDir = r.dir;
  // Список PNG
  const lr = await window.kh1.bbsfont.listHdPngs(r.dir);
  if (lr.error) { toast(lr.error, 'error'); return; }
  while (bfPngSel.firstChild) bfPngSel.removeChild(bfPngSel.firstChild);
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '— без HD PNG —';
  bfPngSel.appendChild(blank);
  for (const png of (lr.pngs || [])) {
    const o = document.createElement('option');
    o.value = png;
    o.textContent = png.split(/[\\/]/).pop();
    bfPngSel.appendChild(o);
  }
  bfRefreshButtons();
});

if (bfFontSel) bfFontSel.addEventListener('change', async () => {
  const name = bfFontSel.value;
  const ff = bfState.fonts.find(f => f.name === name);
  if (!ff) return;
  // hdPngPath передаємо лише якщо вибрано в окремому селекторі
  const fontFiles = Object.assign({}, ff, { hdPngPath: bfPngSel && bfPngSel.value || null });
  const r = await window.kh1.bbsfont.loadFont(fontFiles);
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.current = { name: r.name, inf: r.inf, entries: r.entries, infPath: ff.infPath, codPath: ff.codPath };
  bfState.origEntries = JSON.parse(JSON.stringify(r.entries));
  bfState.pngUrl = r.pngDataUrl || null;
  bfState.pngImg = null;
  bfState.selected = -1;
  bfState.dirty = false;
  bfSetInfo(`${r.name} · ${r.entries.length} entries · ${r.inf.textureWidth}×${r.inf.textureHeight} (cell ${r.inf.charWidth}×${r.inf.charHeight})`);
  if (bfState.pngUrl) {
    const img = new Image();
    img.onload = () => { bfState.pngImg = img; bfRenderAtlas(); };
    img.src = bfState.pngUrl;
  }
  bfRenderAtlas();
  bfRenderList();
  bfRefreshButtons();
});

if (bfPngSel) bfPngSel.addEventListener('change', async () => {
  if (!bfState.current) return;
  // Перезавантажити поточний шрифт з новим HD PNG
  bfFontSel.dispatchEvent(new Event('change'));
});

function bfRenderAtlas() {
  if (!bfState.current) return;
  const { inf, entries } = bfState.current;
  // INF.textureWidth/Height — це PER-BLOCK розміри (не total atlas).
  // Реальний атлас = 2× ширини (left + right halves для pal=0/pal=1).
  const totalW = inf.textureWidth * 2;
  const totalH = inf.textureHeight;
  const pngW = bfState.pngImg ? bfState.pngImg.width : totalW;
  const pngH = bfState.pngImg ? bfState.pngImg.height : totalH;
  const scaleX = pngW / totalW;
  const scaleY = pngH / totalH;
  const halfPngW = pngW / 2;        // = inf.textureWidth * scaleX

  bfAtlasWrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = pngW;
  canvas.height = pngH;
  canvas.style.imageRendering = 'pixelated';
  bfAtlasWrap.appendChild(canvas);
  bfApplyZoom(canvas, pngW, pngH);
  const ctx = canvas.getContext('2d');
  // Bg + PNG
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, pngW, pngH);
  if (bfState.pngImg) ctx.drawImage(bfState.pngImg, 0, 0);

  // Vertical separator (block 1 / block 2)
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(halfPngW, 0); ctx.lineTo(halfPngW, pngH); ctx.stroke();

  // Cell-grid overlay. Block = palette index (0 → left half, 1 → right half).
  // Рамка = повна клітина гліфа (charWidth × charHeight), не entry.width
  // (entry.width — це advance/visible, редагується у side-panel).
  const cellW = inf.charWidth  * scaleX;
  const cellH = inf.charHeight * scaleY;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const blockOffX = (e.palette === 1) ? halfPngW : 0;
    const px = e.posX * scaleX + blockOffX;
    const py = e.posY * scaleY;
    const isSel = (i === bfState.selected);
    ctx.strokeStyle = isSel ? 'rgba(255, 200, 0, 1)' : 'rgba(255, 215, 90, 0.25)';
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeRect(px, py, cellW, cellH);
  }

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) / rect.width * pngW;
    const cy = (ev.clientY - rect.top)  / rect.height * pngH;
    const isBlock2 = cx > halfPngW;
    const localX = isBlock2 ? cx - halfPngW : cx;
    // Знайти entry: блок = palette (0 → лівий, 1 → правий).
    let bestIdx = -1, bestDist = Infinity;
    const hitW = inf.charWidth  * scaleX;
    const hitH = inf.charHeight * scaleY;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const expectsBlock2 = (e.palette === 1);
      if (expectsBlock2 !== isBlock2) continue;
      const ex = e.posX * scaleX;
      const ey = e.posY * scaleY;
      const ew = hitW;
      const eh = hitH;
      if (localX >= ex && localX < ex + ew && cy >= ey && cy < ey + eh) {
        bfSelectEntry(i);
        return;
      }
      // fallback: nearest
      const dx = Math.max(0, ex - localX, localX - (ex + ew));
      const dy = Math.max(0, ey - cy,     cy - (ey + eh));
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx >= 0) bfSelectEntry(bestIdx);
  });
}

function bfRenderList() {
  if (!bfState.current) return;
  const entries = bfState.current.entries;
  bfList.innerHTML = '';
  // Limit для performance — показуємо all але рендеримо частинами якщо потрібно
  const frag = document.createDocumentFragment();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const li = document.createElement('li');
    li.className = 'bf-list-item' + (i === bfState.selected ? ' selected' : '');
    li.dataset.index = String(i);
    li.textContent = `#${i}  ${bfHex2(e.id)}  ${bfCharFromId(e.id)}  (${e.posX},${e.posY})  w=${e.width}`;
    li.addEventListener('click', () => bfSelectEntry(i));
    frag.appendChild(li);
  }
  bfList.appendChild(frag);
}

function bfSelectEntry(idx) {
  if (!bfState.current) return;
  if (idx < 0 || idx >= bfState.current.entries.length) return;
  bfState.selected = idx;
  const e = bfState.current.entries[idx];
  bfFields.classList.remove('hidden');
  bfFIndex.value = String(idx);
  bfFId.value    = bfHex2(e.id);
  bfFChar.value  = bfCharFromId(e.id);
  bfFX.value     = String(e.posX);
  bfFY.value     = String(e.posY);
  bfFPal.value   = String(e.palette);
  bfFWidth.value = String(e.width);
  bfRenderAtlas();
  bfRenderList();
  // scroll the selected item into view
  const sel = bfList.querySelector('.bf-list-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function bfRefreshSelectedListItem() {
  if (!bfState.current || bfState.selected < 0) return;
  const e = bfState.current.entries[bfState.selected];
  const li = bfList.querySelector(`.bf-list-item[data-index="${bfState.selected}"]`);
  if (li) li.textContent = `#${bfState.selected}  ${bfHex2(e.id)}  ${bfCharFromId(e.id)}  (${e.posX},${e.posY})  w=${e.width}`;
}

// === Zoom ===
function bfApplyZoom(canvas, pngW, pngH) {
  let z = bfState.zoom;
  if (bfState.fitMode) {
    const wrapW = Math.max(1, bfAtlasWrap.clientWidth - 16); // padding
    z = wrapW / pngW;
    bfState.zoom = z;
  }
  canvas.style.width  = (pngW * z) + 'px';
  canvas.style.height = (pngH * z) + 'px';
  canvas.style.maxWidth = 'none';
  bfUpdateZoomLabel();
}
function bfUpdateZoomLabel() {
  if (bfZoomResetBtn) bfZoomResetBtn.textContent = Math.round(bfState.zoom * 100) + '%';
}
function bfSetZoom(z, anchor) {
  // anchor: optional {clientX, clientY} — keep that point under cursor
  z = Math.max(0.1, Math.min(16, z));
  const wrap = bfAtlasWrap;
  const canvas = wrap.querySelector('canvas');
  let preserve = null;
  if (anchor && canvas) {
    const rect = canvas.getBoundingClientRect();
    const fx = (anchor.clientX - rect.left) / rect.width;   // 0..1 within canvas
    const fy = (anchor.clientY - rect.top)  / rect.height;
    const oldScrollLeft = wrap.scrollLeft;
    const oldScrollTop  = wrap.scrollTop;
    const oldW = rect.width, oldH = rect.height;
    preserve = { fx, fy, oldScrollLeft, oldScrollTop, oldW, oldH };
  }
  bfState.zoom = z;
  bfState.fitMode = false;
  if (canvas && bfState.current) {
    const { inf } = bfState.current;
    const totalW = inf.textureWidth * 2;
    const pngW = bfState.pngImg ? bfState.pngImg.width : totalW;
    const pngH = bfState.pngImg ? bfState.pngImg.height : inf.textureHeight;
    bfApplyZoom(canvas, pngW, pngH);
    if (preserve) {
      const newW = pngW * z, newH = pngH * z;
      // canvas top-left x within wrap (in wrap's content coords) == canvas.offsetLeft - wrap.offsetLeft? simpler:
      // anchor pixel within canvas BEFORE = preserve.fx * oldW; want it under same viewport position
      // viewport x of anchor = anchor.clientX - wrap.clientLeft; should remain same
      const wrapRect = wrap.getBoundingClientRect();
      const viewportX = anchor.clientX - wrapRect.left;
      const viewportY = anchor.clientY - wrapRect.top;
      wrap.scrollLeft = preserve.fx * newW - viewportX + (wrap.clientLeft || 0);
      wrap.scrollTop  = preserve.fy * newH - viewportY + (wrap.clientLeft || 0);
    }
  }
  bfUpdateZoomLabel();
}
function bfZoomStep(direction, anchor) {
  const cur = bfState.zoom;
  let idx = BF_ZOOM_STEPS.findIndex(s => s >= cur - 1e-6);
  if (idx < 0) idx = BF_ZOOM_STEPS.length - 1;
  if (direction > 0) {
    idx = Math.min(BF_ZOOM_STEPS.length - 1, (BF_ZOOM_STEPS[idx] > cur + 1e-6) ? idx : idx + 1);
  } else {
    idx = Math.max(0, idx - 1);
  }
  bfSetZoom(BF_ZOOM_STEPS[idx], anchor);
}
if (bfZoomInBtn)    bfZoomInBtn.addEventListener('click',  () => bfZoomStep(+1));
if (bfZoomOutBtn)   bfZoomOutBtn.addEventListener('click', () => bfZoomStep(-1));
if (bfZoomResetBtn) bfZoomResetBtn.addEventListener('click', () => bfSetZoom(1));
if (bfZoomFitBtn)   bfZoomFitBtn.addEventListener('click', () => {
  bfState.fitMode = true;
  bfRenderAtlas();
});
if (bfAtlasWrap) {
  bfAtlasWrap.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    bfZoomStep(ev.deltaY < 0 ? +1 : -1, { clientX: ev.clientX, clientY: ev.clientY });
  }, { passive: false });
}

// === Export overlay (rectangles only) як прозорий PNG ===
if (bfExportOverlayBtn) bfExportOverlayBtn.addEventListener('click', () => {
  if (!bfState.current) return;
  const { inf, entries } = bfState.current;
  const totalW = inf.textureWidth * 2;
  const totalH = inf.textureHeight;
  const pngW = bfState.pngImg ? bfState.pngImg.width : totalW;
  const pngH = bfState.pngImg ? bfState.pngImg.height : totalH;
  const scaleX = pngW / totalW;
  const scaleY = pngH / totalH;
  const halfPngW = pngW / 2;

  const off = document.createElement('canvas');
  off.width = pngW;
  off.height = pngH;
  const ctx = off.getContext('2d');
  // прозорий фон — нічого не малюємо
  // Розділювач блоків (червоний, тонкий)
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(halfPngW + 0.5, 0); ctx.lineTo(halfPngW + 0.5, pngH); ctx.stroke();
  // Рамки гліфів = повна клітина (charWidth × charHeight)
  ctx.strokeStyle = 'rgba(255, 215, 90, 1)';
  ctx.lineWidth = 1;
  const cellW = Math.round(inf.charWidth  * scaleX);
  const cellH = Math.round(inf.charHeight * scaleY);
  for (const e of entries) {
    const blockOffX = (e.palette === 1) ? halfPngW : 0;
    const x = Math.round(e.posX * scaleX + blockOffX) + 0.5;
    const y = Math.round(e.posY * scaleY) + 0.5;
    ctx.strokeRect(x, y, cellW, cellH);
  }

  off.toBlob((blob) => {
    if (!blob) { toast('PNG export failed', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bfState.current.name}-overlay-${pngW}x${pngH}.png`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }, 'image/png');
});

function bfBindFieldEdit(input, key, parser) {
  input.addEventListener('input', () => {
    if (!bfState.current || bfState.selected < 0) return;
    const e = bfState.current.entries[bfState.selected];
    const v = parser(input.value);
    if (Number.isNaN(v) || v == null) return;
    e[key] = v;
    bfState.dirty = true;
    bfRefreshButtons();
    bfRenderAtlas();
    bfRefreshSelectedListItem();
  });
}
if (bfFX)     bfBindFieldEdit(bfFX,     'posX',    s => parseInt(s, 10));
if (bfFY)     bfBindFieldEdit(bfFY,     'posY',    s => parseInt(s, 10));
if (bfFPal)   bfBindFieldEdit(bfFPal,   'palette', s => parseInt(s, 10));
if (bfFWidth) bfBindFieldEdit(bfFWidth, 'width',   s => parseInt(s, 10));
if (bfFId)    bfBindFieldEdit(bfFId,    'id',      s => {
  const m = String(s).trim().match(/^0x([0-9a-fA-F]{1,4})$/);
  return m ? parseInt(m[1], 16) : NaN;
});

// === Add / Delete entry ===
if (bfAddBtn) bfAddBtn.addEventListener('click', () => {
  if (!bfState.current) return;
  const newEntry = { index: bfState.current.entries.length, id: 0, posX: 0, posY: 0, palette: 0, width: 0 };
  bfState.current.entries.push(newEntry);
  bfState.dirty = true;
  bfRenderList();
  bfSelectEntry(bfState.current.entries.length - 1);
  bfRefreshButtons();
});

if (bfDelBtn) bfDelBtn.addEventListener('click', () => {
  if (!bfState.current || bfState.selected < 0) return;
  if (!window.confirm('Видалити entry #' + bfState.selected + ' з COD?')) return;
  bfState.current.entries.splice(bfState.selected, 1);
  bfState.dirty = true;
  bfState.selected = -1;
  bfFields.classList.add('hidden');
  bfRenderAtlas();
  bfRenderList();
  bfRefreshButtons();
});

if (bfResetBtn) bfResetBtn.addEventListener('click', () => {
  if (!bfState.current || !bfState.origEntries) return;
  if (!window.confirm('Скинути всі зміни до завантажених значень?')) return;
  bfState.current.entries = JSON.parse(JSON.stringify(bfState.origEntries));
  bfState.dirty = false;
  bfState.selected = -1;
  bfFields.classList.add('hidden');
  bfRenderAtlas();
  bfRenderList();
  bfRefreshButtons();
});

if (bfSaveBtn) bfSaveBtn.addEventListener('click', async () => {
  if (!bfState.current) return;
  const r = await window.kh1.bbsfont.saveCod({
    codPath: bfState.current.codPath,
    entries: bfState.current.entries
  });
  if (r.error) { toast(r.error, 'error'); return; }
  bfState.origEntries = JSON.parse(JSON.stringify(bfState.current.entries));
  bfState.dirty = false;
  bfRefreshButtons();
  toast(`Збережено: ${r.byteLength} байт у ${bfState.current.codPath}`, 'success', 4000);
});
