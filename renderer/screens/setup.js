import { enterEditor } from '../app-shell.js';
import { toast } from '../core/log.js';
import { appRoot, gamesConfig, homeScreen, refreshGameDirsCache, renderHome, setGameDirsCache, showHome } from './home.js';
import { hideSettings } from '../settings-modal.js';

// =====================================================================
// Setup / Onboarding screen
// =====================================================================
//
// Перший запуск (або після `Перевідкрити setup` у Settings / кліку по картці
// «Потрібен setup» на hub'і): користувач обирає активну гру + директорії
// (gameDir, tools, textAssets), відмічає галочками, які ігри розпакувати, і
// натискає «Підготувати середовище» — main process завантажує
// OpenKH/KHPCPatchManager у tools-теку, розпаковує відмічені ігри, копіює
// їхні текстові файли у робочу теку і пише setupCompleted=true.
export const setupScreen = document.getElementById('setup-screen');
export const setupGameList = document.getElementById('setup-game-list');
export const setupToolsDir  = document.getElementById('setup-tools-dir');
export const setupAssetsDir = document.getElementById('setup-assets-dir');
export const setupRunBtn    = document.getElementById('setup-run');
export const setupRunCount  = document.getElementById('setup-run-count');
export const setupSkipBtn   = document.getElementById('setup-skip-download');
export const setupDetectBtn = document.getElementById('setup-detect');
export const setupBackBtn   = document.getElementById('setup-back');
export const setupProgress  = document.getElementById('setup-progress');
export const setupProgressFill    = document.getElementById('setup-progress-fill');
export const setupProgressPhase   = document.getElementById('setup-progress-phase');
export const setupProgressPercent = document.getElementById('setup-progress-percent');
export const setupProgressMessage = document.getElementById('setup-progress-message');

const t = (key, fallback, params) =>
  (window.i18n && window.i18n.t) ? window.i18n.t(key, params || {}) : fallback;

// Локальний стан, який пишеться в IPC при кліку «Підготувати».
export const _setupState = {
  activeGame: '',
  gameDirectories: {},   // { [gameId]: path }
  prepared: {},          // { [gameId]: bool } — файли гри вже у робочій теці
  unpack: {},            // { [gameId]: bool } — галочка «розпакувати при підготовці»
  detected: {},          // { [gameId]: 'steam' | 'epic' } — теку знайдено автоматично
  dirOk: {},             // { [gameId]: {ok, expected, collection} } — у теці є .hed цієї гри
  toolsDir: '',
  textAssetsDir: ''
};
let _setupBusy = false;
export let _setupOffProgress = null;  // unsubscribe handle

// opts.canGoBack — setup відкрито повторно (з hub'а чи Settings), тож є куди
// повертатись; при першому onboarding кнопки «Назад» нема.
export function showSetup(opts) {
  if (!setupScreen) return;
  // Спершу ховаємо всі інші екрани, щоб setup був єдиним видимим.
  if (homeScreen) {
    homeScreen.classList.add('hidden');
    homeScreen.setAttribute('aria-hidden', 'true');
  }
  if (appRoot) appRoot.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  setupScreen.setAttribute('aria-hidden', 'false');
  if (setupBackBtn) setupBackBtn.hidden = !(opts && opts.canGoBack);
}
export function hideSetup() {
  if (!setupScreen) return;
  setupScreen.classList.add('hidden');
  setupScreen.setAttribute('aria-hidden', 'true');
}

if (setupBackBtn) {
  setupBackBtn.addEventListener('click', () => {
    hideSetup();
    showHome();
  });
}

// Клік по картці «Потрібен setup» / «Не розпаковано» на hub'і: відкрити Setup
// з цією грою як активною; без теки — одразу запропонувати вибрати її, з текою —
// відмітити її до розпакування.
export async function openSetupForGame(gameId) {
  let state = null;
  try { state = await window.kh1.setup.status(); } catch (_) {}
  await initSetupFromState(state || {});
  if (gameId && gamesConfig.some(g => g.id === gameId)) {
    _setupState.activeGame = gameId;
    if (_setupState.gameDirectories[gameId]) _setupState.unpack[gameId] = true;
    _setupRenderGames();
    _setupRefreshRunBtn();
  }
  showSetup({ canGoBack: !!(state && state.completed) });
  if (!setupGameList) return;
  const row = setupGameList.querySelector('.setup-game[data-game-id="' + gameId + '"]');
  if (!row) return;
  row.scrollIntoView({ block: 'nearest' });
  const pick = row.querySelector('.setup-game-pick');
  if (pick && !_setupState.gameDirectories[gameId]) pick.click();
}
document.addEventListener('kh:setup-game', (ev) => {
  openSetupForGame(ev && ev.detail && ev.detail.gameId);
});

// Мініатюра гри: стилізований heart-motif у кольорах теми (без фото-assets).
const THUMB_HEART = '<svg viewBox="0 0 454 495" aria-hidden="true"><path fill="currentColor" d="M373.17 258.49c80.56-70.15 80.06-108.12 80.06-139.77-4.58-127.33-116.89-118.48-116.89-118.48 0 0.00197-100.38 0.00197-108.02 94.225 2.75 58.465 56.09 60.495 56.09 60.495s46.45-0.1 46.45-40.86c0-40.748-42.91-32.869-42.91-32.869s26.58 9.401 26.58 27.489c0 12.47-18.97 24.98-29.2 24.98s-27.93-8.44-27.93-29.94c0-59.653 69.28-59.936 76.96-59.936s76.65 6.201 78.03 77.366c0.47 24.02 0 49.77-38.68 89.51-135.38 113.54-146.45 191.72-146.45 191.72-1.03 0-12.1-78.18-147.48-191.72-38.679-39.74-39.147-65.49-38.679-89.51 1.387-71.165 70.349-77.366 78.029-77.366s76.97 0.283 76.97 59.936c0 21.5-17.7 29.94-27.93 29.94s-29.2-12.51-29.2-24.98c0-18.088 26.58-27.489 26.58-27.489s-42.92-7.879-42.92 32.869c0 40.76 46.46 40.86 46.46 40.86s53.33-2.03 56.08-60.495c-7.64-94.223-108.02-94.223-108.02-94.223 0-0.00003-112.3-8.8535-116.89 118.48 0.00008 31.65-0.49541 69.62 80.069 139.77 108.94 94.85 134.99 169.74 146.71 236.5 11.13-66.76 37.19-141.65 146.13-236.5z"/></svg>';

export function _setupRenderGames() {
  if (!setupGameList) return;
  setupGameList.innerHTML = '';
  for (const g of gamesConfig) {
    const dir = _setupState.gameDirectories[g.id] || '';
    const prepared = !!_setupState.prepared[g.id];
    const row = document.createElement('div');
    row.className = 'setup-game' + (dir ? ' has-dir' : '') + (prepared ? ' prepared' : '');
    row.dataset.gameId = g.id;
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', _setupState.activeGame === g.id ? 'true' : 'false');
    if (_setupState.activeGame === g.id) row.classList.add('active');

    const radio = document.createElement('div');
    radio.className = 'setup-game-radio';
    row.appendChild(radio);

    const thumb = document.createElement('div');
    thumb.className = 'setup-game-thumb theme-' + (g.theme || 'final-mix');
    thumb.innerHTML = THUMB_HEART;
    row.appendChild(thumb);

    const text = document.createElement('div');
    text.className = 'setup-game-text';
    const nm = document.createElement('div');
    nm.className = 'setup-game-name';
    nm.textContent = g.name;
    const pth = document.createElement('div');
    pth.className = 'setup-game-path';
    pth.textContent = dir;
    pth.title = dir;
    pth.setAttribute('data-empty', t('setupGameNoDir', 'Директорію гри ще не вказано'));
    text.appendChild(nm);
    text.appendChild(pth);
    const chk0 = _setupState.dirOk[g.id];
    const badDir = !!(dir && chk0 && chk0.ok === false);
    if (badDir) row.classList.add('bad-dir');
    if (dir) {
      // Стан: чи це тека потрібної збірки; чи вже скопійовано файли гри у
      // робочу теку; звідки взято теку.
      const st = document.createElement('div');
      let parts;
      if (badDir) {
        st.className = 'setup-game-status bad';
        parts = [chk0.missing
          ? t('setupDirMissing', 'Теки не існує')
          : t('setupDirBadHed', 'Тут нема {expected} — потрібна тека збірки «{collection}»', { expected: chk0.expected, collection: chk0.collection })];
      } else {
        st.className = 'setup-game-status' + (prepared ? ' ok' : '');
        parts = [t(prepared ? 'setupGamePrepared' : 'setupGameNotPrepared',
          prepared ? 'Файли розпаковано у робочу теку' : 'Файли ще не розпаковано')];
      }
      const src = _setupState.detected[g.id];
      if (src) parts.push(t('setupDetectedVia', 'знайдено у {src}', { src: src === 'epic' ? 'Epic Games' : 'Steam' }));
      st.textContent = parts.join(' · ');
      text.appendChild(st);
    }
    row.appendChild(text);

    const btns = document.createElement('div');
    btns.className = 'setup-game-btns';
    row.appendChild(btns);

    if (dir && g.enabled && !badDir) {
      // Галочка «розпакувати при підготовці» — саме вона визначає, для яких
      // ігор запуститься KHPCPatchManager + копіювання файлів.
      const chk = document.createElement('label');
      chk.className = 'setup-game-check' + (_setupState.unpack[g.id] ? ' on' : '');
      chk.title = t('setupUnpackCheckTitle', 'Розпакувати цю гру і скопіювати її текстові файли при натисканні «Підготувати середовище»');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!_setupState.unpack[g.id];
      input.addEventListener('click', (ev) => ev.stopPropagation());
      input.addEventListener('change', () => {
        _setupState.unpack[g.id] = input.checked;
        chk.classList.toggle('on', input.checked);
        _setupRefreshRunBtn();
      });
      const lbl = document.createElement('span');
      lbl.setAttribute('data-i18n', prepared ? 'setupUnpackAgain' : 'setupUnpackCheck');
      lbl.textContent = t(prepared ? 'setupUnpackAgain' : 'setupUnpackCheck', prepared ? 'Оновити файли' : 'Розпакувати');
      chk.appendChild(input);
      chk.appendChild(lbl);
      chk.addEventListener('click', (ev) => ev.stopPropagation());
      btns.appendChild(chk);
    }

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'kh-btn setup-game-pick';
    pickBtn.textContent = t('setupBrowse', 'Вибрати…');
    pickBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const title = t('setupPickGameDir', 'Тека гри') + ' — ' + g.name;
      const picked = await window.kh1.setup.pickDir(title);
      if (!picked) return;
      _setupState.gameDirectories[g.id] = picked;
      _setupState.prepared[g.id] = false;
      _setupState.unpack[g.id] = true;
      delete _setupState.detected[g.id];
      delete _setupState.dirOk[g.id];
      // Якщо це перша вказана гра — автоматично робимо її активною.
      if (!_setupState.activeGame) _setupState.activeGame = g.id;
      _setupRenderGames();
      _setupRefreshRunBtn();
      await _setupCheckDirs([g.id]);
    });
    btns.appendChild(pickBtn);

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

// Автопошук збірок KH (Steam на всіх дисках, Epic): заповнює лише порожні
// теки, знайдені й ще не розпаковані ігри відмічає до розпакування.
export async function _setupDetectGames(opts) {
  const quiet = !!(opts && opts.quiet);
  let r = null;
  try { r = await window.kh1.setup.detectGames(); } catch (_) { /* нема IPC — просто нічого не знайдено */ }
  const games = (r && r.games) || {};
  const filled = [], already = [];
  for (const g of gamesConfig) {
    const hit = games[g.id];
    if (!hit || !hit.path) continue;
    if (_setupState.gameDirectories[g.id]) { already.push(g.name); continue; }
    _setupState.gameDirectories[g.id] = hit.path;
    _setupState.detected[g.id] = hit.source;
    _setupState.dirOk[g.id] = { ok: true };
    _setupState.prepared[g.id] = false;
    _setupState.unpack[g.id] = !!g.enabled;
    if (!_setupState.activeGame && g.enabled) _setupState.activeGame = g.id;
    filled.push(g.name);
  }
  if (filled.length || already.length) {
    _setupRenderGames();
    _setupRefreshRunBtn();
  }
  if (quiet && !filled.length) return r;
  if (filled.length) {
    toast(t('toastDetectFound', 'Знайдено: {list}', { list: filled.join(', ') }), 'success', 6000);
  } else if (already.length) {
    toast(t('toastDetectSame', 'Знайдені ігри вже вказано: {list}', { list: already.join(', ') }), 'info', 5000);
  } else {
    toast(t('toastDetectNone', 'Ігри Steam/Epic не знайдено — вкажи теку гри вручну'), 'error', 6000);
  }
  return r;
}
if (setupDetectBtn) {
  setupDetectBtn.addEventListener('click', async () => {
    setupDetectBtn.disabled = true;
    try { await _setupDetectGames(); } finally { setupDetectBtn.disabled = false; }
  });
}

// Перевірити, що у вказаних теках є архів відповідної гри (kh1_first.hed,
// Recom.hed, bbs_first.hed, kh3d_first.hed). Погана тека → попередження у
// рядку, галочку «Розпакувати» знято.
export async function _setupCheckDirs(ids) {
  const list = (ids || gamesConfig.map(g => g.id)).filter(id => _setupState.gameDirectories[id]);
  if (!list.length || !window.kh1.setup.checkGameDir) return;
  await Promise.all(list.map(async (id) => {
    try {
      const r = await window.kh1.setup.checkGameDir({ gameId: id, dir: _setupState.gameDirectories[id] });
      if (r) {
        _setupState.dirOk[id] = r;
        if (r.ok === false) _setupState.unpack[id] = false;
      }
    } catch (_) {}
  }));
  _setupRenderGames();
  _setupRefreshRunBtn();
}

// Які ігри піде розпаковувати «Підготувати середовище» (галочки + є тека).
export function _setupUnpackList() {
  return gamesConfig
    .filter(g => g.enabled && _setupState.gameDirectories[g.id] && _setupState.unpack[g.id] &&
      !(_setupState.dirOk[g.id] && _setupState.dirOk[g.id].ok === false))
    .map(g => g.id);
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
  setupRunBtn.disabled = !ok || _setupBusy;
  if (setupSkipBtn) setupSkipBtn.disabled = !ok || _setupBusy;
  if (setupDetectBtn) setupDetectBtn.disabled = _setupBusy;
  // Лічильник ігор до розпакування на головній кнопці.
  if (setupRunCount) {
    const n = _setupUnpackList().length;
    setupRunCount.textContent = n ? String(n) : '';
    setupRunCount.hidden = !n;
  }
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
      const params = Object.assign({}, p.params || {});
      // gameId → людська назва гри
      if (params.game) { const g = gamesConfig.find(x => x.id === params.game); if (g) params.game = g.name; }
      setupProgressMessage.textContent = window.i18n.t(p.key, params);
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
  if (_setupBusy) return;
  _setupBusy = true;
  _setupRefreshRunBtn();
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
    skipDownload: !!skipDownload,
    prepareGames: _setupUnpackList()
  };
  let r;
  try { r = await window.kh1.setup.run(payload); }
  catch (e) { r = { error: (e && e.message) || String(e) }; }
  _setupBusy = false;

  if (r && r.error) {
    if (setupProgress) setupProgress.classList.add('error');
    if (setupProgressMessage) setupProgressMessage.textContent = r.error;
    toast(r.error, 'error', 6000);
    _setupRefreshRunBtn();
    return;
  }

  if (r && r.warnings && r.warnings.length) {
    for (const w of r.warnings) {
      toast(w, 'error', 5000);
    }
  }

  // Підсумок розпакування по кожній грі (KHPCPatchManager + копіювання).
  if (r && r.prepared && typeof toast === 'function') {
    for (const [gid, info] of Object.entries(r.prepared)) {
      const g = gamesConfig.find(x => x.id === gid);
      const name = g ? g.name : gid;
      if (!info) continue;
      if (info.skipped) toast(name + ': ' + t('toastPrepareSkipped', 'розпакування пропущено — {reason}', { reason: info.reason }), 'error', 8000);
      else if (info.error) toast(name + ': ' + t('toastPrepareError', 'помилка розпакування — {msg}', { msg: info.error }), 'error', 8000);
      else {
        const n = (info.copyFiles && info.copyFiles.copied) || 0;
        toast(t('toastPrepareDone', '{game}: файлів скопійовано у робочу теку — {n}', { game: name, n }), n ? 'success' : 'error', 6000);
      }
    }
  } else if (r && payload.prepareGames.length && (!r.tools || !r.tools.khpcpm) && typeof toast === 'function') {
    // Просили розпакувати, але KHPCPatchManager нема.
    toast(t('toastPrepareNeedTools', 'KHPCPatchManager не завантажено — розпакування недоступне.'), 'error', 7000);
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
      const msg = t('toastSetupDone', 'Налаштування завершено');
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
  _setupState.prepared = Object.assign({}, state.prepared || {});
  _setupState.detected = {};
  _setupState.dirOk = {};
  // За замовчуванням до розпакування йдуть ігри з текою, які ще не розпаковано.
  _setupState.unpack = {};
  for (const g of gamesConfig) {
    if (g.enabled && _setupState.gameDirectories[g.id] && _setupState.prepared[g.id] === false) _setupState.unpack[g.id] = true;
  }
  _setupState.toolsDir = state.toolsDir || (state.defaults && state.defaults.toolsDir) || '';
  _setupState.textAssetsDir = state.textAssetsDir || (state.defaults && state.defaults.textAssetsDir) || '';
  if (setupToolsDir)  setupToolsDir.value  = _setupState.toolsDir;
  if (setupAssetsDir) setupAssetsDir.value = _setupState.textAssetsDir;
  _setupRenderGames();
  _setupRefreshRunBtn();
  // Автопошук Steam/Epic для ігор без теки (тихо: без тосту, якщо нічого нового).
  if (gamesConfig.some(g => g.enabled && !_setupState.gameDirectories[g.id])) {
    await _setupDetectGames({ quiet: true });
  }
  // Збережені теки — перевірити, що в них є архів саме цієї гри.
  await _setupCheckDirs(gamesConfig.filter(g => !_setupState.detected[g.id]).map(g => g.id));
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

  // Кеш gameDirectories/prepared для home-cards (грейаут якщо директорії немає,
  // бейдж «Не розпаковано» якщо файли ще не скопійовано).
  setGameDirsCache((state && state.gameDirectories) || {}, (state && state.prepared) || {});
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
    const dir = await window.kh1.setup.pickDir(t('setupPickToolsDir', 'Тека tools'));
    if (!dir) return;
    setupToolsDir.value = dir;
    _setupState.toolsDir = dir;
    _setupRefreshRunBtn();
  });
}
export const _setupAssetsPick = document.getElementById('setup-assets-pick');
if (_setupAssetsPick) {
  _setupAssetsPick.addEventListener('click', async () => {
    const dir = await window.kh1.setup.pickDir(t('setupPickAssetsDir', 'Тека текстових ресурсів'));
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
    showSetup({ canGoBack: true });
  });
}
