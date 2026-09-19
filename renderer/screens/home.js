import { enterEditor } from '../app-shell.js';
import { hideSetup } from './setup.js';

// =====================================================================
// Home / Game Selection screen ("hub")
// gamesConfig — масив; додавай нові ігри сюди. Кожна гра має:
//   id           - унікальний slug
//   title        - велика назва на обкладинці (рядки розділяються '\n')
//   name         - назва під обкладинкою
//   platform     - платформа/реліз
//   format       - які файли локалізуються
//   subtitle     - platform + format (лишається для сумісності)
//   theme        - slug hero-теми ('final-mix' | 're-com' | 'ddd' | 'bbs')
//   image        - шлях до cover (або null → SVG/CSS hero)
//   enabled      - true → клікабельна
//   status       - 'ready' | 'soon'
//   onSelect     - callback при виборі (тільки для enabled)
// =====================================================================
// `formats` = масив classifier kind'ів які належать до гри. Translate-режим
// фільтрує список файлів за цим. KH1 використовує binl/rawbin/ev/mesofs;
// (+ binl-v361 для sysmsg); BBS — лише ctd, Re:CoM — ctdl, DDD — ctd-ddd.
function game(def) {
  return Object.assign({ image: null, subtitle: def.platform + ' · ' + def.format }, def);
}

export const gamesConfig = [
  game({
    id: 'kh1-final-mix',
    title: 'KINGDOM HEARTS\nFINAL MIX',
    name: 'Kingdom Hearts Final Mix',
    // Обкладинка (SteamGridDB, 920×430) замість намальованого hero; на ній уже є логотип.
    image: 'assets/covers/kh1-final-mix.png',
    platform: 'PC (Steam / Epic Games)',
    format: '.bin / .ard',
    theme: 'final-mix',
    enabled: true,
    status: 'ready',
    formats: ['binl', 'binl-v361', 'rawbin', 'ev', 'mesofs'],
    // KH1: список файлів — з ENG (розпакована гра); RUS — опційний оракул
    // (російський переклад): рядки, ідентичні в RUS, вважаються неперекладними.
    dirs: ['engDir', 'rusDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh1-final-mix')
  }),
  game({
    id: 'kh-re-com',
    title: 'KINGDOM HEARTS\nRE:CHAIN OF MEMORIES',
    name: 'Kingdom Hearts Re:Chain of Memories',
    image: 'assets/covers/kh-re-com.png',
    platform: 'PC (Steam / Epic Games)',
    format: '.ctdl (subtitles + menu text)',
    theme: 're-com',
    enabled: true,
    status: 'ready',
    formats: ['ctdl'],
    // Re:CoM: ENG = і джерело тексту і список файлів; UA = вихід; TSV = прогрес.
    // Без RUS-оракула (як у BBS).
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-re-com')
  }),
  game({
    id: 'kh-ddd',
    title: 'KINGDOM HEARTS\nDREAM DROP DISTANCE HD',
    name: 'Kingdom Hearts 3D: Dream Drop Distance HD',
    image: 'assets/covers/kh-ddd.png',
    platform: 'PC (KH HD 2.8)',
    format: '.ctd (UTF-16, event/menu/report)',
    theme: 'ddd',
    enabled: true,
    status: 'ready',
    formats: ['ctd-ddd'],
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-ddd')
  }),
  game({
    id: 'kh-bbs-final-mix',
    title: 'KINGDOM HEARTS\nBIRTH BY SLEEP\nFINAL MIX',
    name: 'Kingdom Hearts: Birth by Sleep Final Mix',
    image: 'assets/covers/kh-bbs-final-mix.png',
    platform: 'PC (Steam / Epic Games)',
    format: '.ctd (subtitles + menu text)',
    theme: 'bbs',
    enabled: true,
    status: 'ready',
    formats: ['ctd'],
    // BBS: ENG = і джерело тексту і список файлів; UA = вихід; TSV = прогрес.
    // Без RUS-оракула.
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-bbs-final-mix')
  })
];

export const homeScreen = document.getElementById('home-screen');
export const homeGrid   = document.getElementById('home-grid');
export const appRoot    = document.querySelector('.app');

const $ = (id) => document.getElementById(id);
const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;

export function _gameStatusLabel(status) {
  if (status === 'ready') return t('gameStatusReady', 'Готово');
  if (status === 'soon')  return t('gameStatusSoon', 'Незабаром');
  return '';
}

export const HEART_SVG = '<svg viewBox="0 0 454 495" preserveAspectRatio="xMidYMid meet"><path fill="currentColor" d="m373.17 258.49c80.56-70.15 80.06-108.12 80.06-139.77-4.58-127.33-116.89-118.48-116.89-118.48 0 0.00197-100.38 0.00197-108.02 94.225 2.75 58.465 56.09 60.495 56.09 60.495s46.45-0.1 46.45-40.86c0-40.748-42.91-32.869-42.91-32.869s26.58 9.401 26.58 27.489c0 12.47-18.97 24.98-29.2 24.98s-27.93-8.44-27.93-29.94c0-59.653 69.28-59.936 76.96-59.936s76.65 6.201 78.03 77.366c0.47 24.02 0 49.77-38.68 89.51-135.38 113.54-146.45 191.72-146.45 191.72-1.03 0-12.1-78.18-147.48-191.72-38.679-39.74-39.147-65.49-38.679-89.51 1.387-71.165 70.349-77.366 78.029-77.366s76.97 0.283 76.97 59.936c0 21.5-17.7 29.94-27.93 29.94s-29.2-12.51-29.2-24.98c0-18.088 26.58-27.489 26.58-27.489s-42.92-7.879-42.92 32.869c0 40.76 46.46 40.86 46.46 40.86s53.33-2.03 56.08-60.495c-7.64-94.223-108.02-94.223-108.02-94.223 0-0.00003-112.3-8.8535-116.89 118.48 0.00008 31.65-0.49541 69.62 80.069 139.77 108.94 94.85 134.99 169.74 146.71 236.5 11.13-66.76 37.19-141.65 146.13-236.5z"/></svg>';

const CHECK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" opacity=".18"/><path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WARN_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 1.8L14.6 13.4H1.4z" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6v3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".8" fill="currentColor"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------------
// Hero art — оригінальні декоративні SVG (зорі, силуети, карти), а не
// офіційні зображення. Зорі — детермінований псевдо-random, щоб картки
// не «мерехтіли» при перерендері.
// ---------------------------------------------------------------------
function stars(seed, count, w, h) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = (rnd() * w).toFixed(1), y = (rnd() * h * 0.75).toFixed(1);
    const r = (0.5 + rnd() * 1.3).toFixed(2), o = (0.35 + rnd() * 0.55).toFixed(2);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
  }
  return out;
}
function sparkle(x, y, r, opacity) {
  return `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#fff" opacity="${opacity}"/>`;
}
const HERO_W = 400, HERO_H = 200;
const HERO_ART = {
  'final-mix': () => `
    ${stars(11, 46, HERO_W, HERO_H)}
    ${sparkle(58, 40, 7, 0.75)}${sparkle(340, 62, 5, 0.6)}${sparkle(300, 24, 4, 0.5)}
    <path d="M0 200V150l24-6 10-26 8 26 22 4 6-38 8 38 20 2v-20l14-14 14 14v18l26-4 8-30 8 30 26 2 12-44 12 44 20 4 6-22 8 22 30 2 12-30 10 30 24 2 12-18 10 18 20 2v20l30 4 12-32 8 32 20 4V200z" fill="#03091d" opacity=".85"/>
    <path d="M0 200V172l40-4 30-8 40 6 36-10 42 8 40-4 36 10 44-8 40 6 52-4V200z" fill="#020615"/>
    <ellipse cx="200" cy="215" rx="260" ry="40" fill="#fff" opacity=".07"/>`,
  're-com': () => `
    ${stars(23, 18, HERO_W, HERO_H)}
    <g opacity=".22" fill="none" stroke="#f0d78a" stroke-width="1.5">
      <rect x="28" y="38" width="64" height="92" rx="7" transform="rotate(-18 60 84)"/>
      <rect x="300" y="26" width="64" height="92" rx="7" transform="rotate(16 332 72)"/>
      <rect x="330" y="112" width="64" height="92" rx="7" transform="rotate(28 362 158)"/>
      <rect x="0" y="118" width="64" height="92" rx="7" transform="rotate(-26 32 164)"/>
    </g>
    <g opacity=".30" fill="#f0d78a">
      <path d="M60 70l6 12h12l-9 8 3 12-12-7-12 7 3-12-9-8h12z" transform="rotate(-18 60 84)"/>
      <path d="M332 60l6 12h12l-9 8 3 12-12-7-12 7 3-12-9-8h12z" transform="rotate(16 332 72)"/>
    </g>
    <ellipse cx="200" cy="230" rx="300" ry="60" fill="#f6c35a" opacity=".12"/>`,
  'ddd': () => `
    ${stars(37, 52, HERO_W, HERO_H)}
    ${sparkle(70, 34, 6, 0.7)}${sparkle(330, 48, 8, 0.75)}${sparkle(230, 18, 4, 0.55)}
    <path d="M0 200V160l16-2 6-40 6 40 20 2 4-24 6 24 22 0 10-56 10 56 18 2v-18l12-10 12 10v20l18-2 8-34 8 34 24 2 10-48 10 48 22 2 6-26 6 26 26 2 8-20 8 20 20 2 12-40 8 40 18 4V200z" fill="#140724" opacity=".9"/>
    <path d="M0 200V178l48-6 40 8 44-10 40 6 48-8 40 8 40-6 44 8 56-6V200z" fill="#0c0418"/>
    <circle cx="336" cy="52" r="26" fill="#fff" opacity=".10"/>
    <circle cx="336" cy="52" r="18" fill="#fff" opacity=".10"/>`,
  'bbs': () => `
    ${stars(53, 40, HERO_W, HERO_H)}
    ${sparkle(46, 52, 6, 0.65)}${sparkle(350, 30, 6, 0.6)}
    <g opacity=".28" fill="none" stroke="#dff6ff" stroke-width="2" stroke-linecap="round">
      <path d="M48 176L154 40"/><path d="M144 34l14-4-4 14"/><circle cx="48" cy="176" r="8"/>
      <path d="M352 176L246 40"/><path d="M256 34l-14-4 4 14"/><circle cx="352" cy="176" r="8"/>
    </g>
    <path d="M0 200V166l60-10 40 8 50-14 50 10 50-12 50 8 50-10 50 12V200z" fill="#04161e" opacity=".9"/>
    <ellipse cx="200" cy="228" rx="280" ry="50" fill="#9fe7ff" opacity=".10"/>`
};
function heroArt(theme) {
  const fn = HERO_ART[theme] || HERO_ART['final-mix'];
  return `<svg viewBox="0 0 ${HERO_W} ${HERO_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${fn()}</svg>`;
}

// Кеш gameDirectories з settings (оновлюється у bootstrapApp / після setup).
// Гра вважається "готовою до перекладу" лише якщо її директорію вказано.
export let _gameDirsCache = {};
// prepared[gameId] — файли гри вже скопійовано у робочу теку (setup:status).
export let _gamePreparedCache = {};
export function setGameDirsCache(v, prepared) { _gameDirsCache = v || {}; _gamePreparedCache = prepared || {}; }
export async function refreshGameDirsCache() {
  try {
    const s = await window.kh1.setup.status();
    _gameDirsCache = (s && s.gameDirectories) || {};
    _gamePreparedCache = (s && s.prepared) || {};
  } catch (_) { _gameDirsCache = {}; _gamePreparedCache = {}; }
}
export function _gameHasDir(gameId) {
  const v = _gameDirsCache && _gameDirsCache[gameId];
  return !!(v && String(v).trim());
}
// false лише коли setup явно знає, що робоча тека порожня.
export function _gameIsPrepared(gameId) {
  return !(_gamePreparedCache && _gamePreparedCache[gameId] === false);
}

export function renderGameCard(game) {
  const card = document.createElement('button');
  card.type = 'button';
  // Гра доступна тільки якщо: (a) gamesConfig.enabled (статичний support flag),
  // (b) користувач указав директорію цієї гри у setup'і.
  const hasDir = _gameHasDir(game.id);
  const prepared = _gameIsPrepared(game.id);
  const isReady = game.enabled && hasDir && prepared;
  // Підтримувана гра без теки або з нерозпакованими файлами — не disabled
  // (disabled-кнопка не отримує click), а стан needs-setup: клік відкриває
  // Setup для цієї гри (вибір теки / кнопка «Розпакувати»).
  const needsSetup = game.enabled && !isReady;
  card.className = 'game-card theme-' + (game.theme || 'final-mix') +
    (isReady ? '' : (needsSetup ? ' needs-setup' : ' disabled'));
  card.dataset.gameId = game.id;
  card.setAttribute('role', 'listitem');
  if (!game.enabled) {
    card.disabled = true;
    card.setAttribute('aria-disabled', 'true');
    card.setAttribute('data-i18n-title', 'gameSoonTooltip');
    card.title = t('gameSoonTooltip', 'Підтримка з’явиться пізніше');
  } else if (needsSetup) {
    const tipKey = hasDir ? 'gameNotPreparedTooltip' : 'gameNoDirTooltip';
    card.setAttribute('data-i18n-title', tipKey);
    card.title = t(tipKey, hasDir ? 'Натисни, щоб розпакувати файли цієї гри (Setup)' : 'Натисни, щоб вказати теку цієї гри (Setup)');
    card.setAttribute('aria-label', game.name + ' — ' + t(hasDir ? 'gameNeedsPrepare' : 'gameNeedsSetup', 'Потрібен setup'));
  } else {
    card.setAttribute('aria-label', game.name);
  }

  // Hero / cover
  const cover = document.createElement('div');
  cover.className = 'game-cover';
  if (game.image) {
    const img = document.createElement('img');
    img.src = game.image;
    img.alt = '';
    cover.appendChild(img);
  } else {
    const art = document.createElement('div');
    art.className = 'game-cover-art';
    art.innerHTML = heroArt(game.theme);
    cover.appendChild(art);
    const heart = document.createElement('div');
    heart.className = 'game-cover-heart';
    heart.innerHTML = HEART_SVG;
    cover.appendChild(heart);
  }
  const ovl = document.createElement('div');
  ovl.className = 'game-cover-overlay';
  cover.appendChild(ovl);
  const ct = document.createElement('div');
  ct.className = 'game-cover-title';
  // На готовій обкладинці логотип уже є — свій заголовок не малюємо.
  if (game.image) ct.hidden = true;
  const lines = String(game.title).split('\n');
  lines.forEach((line, i) => {
    if (i) ct.appendChild(document.createElement('br'));
    ct.appendChild(document.createTextNode(line));
  });
  cover.appendChild(ct);

  if (!game.enabled) {
    const ribbon = document.createElement('div');
    ribbon.className = 'game-ribbon';
    ribbon.setAttribute('data-i18n', 'comingSoon');
    ribbon.textContent = t('comingSoon', 'Coming Soon');
    card.appendChild(ribbon);
  } else if (!hasDir) {
    // Картка enabled, але директорія не задана — підказка, що треба зробити.
    const ribbon = document.createElement('div');
    ribbon.className = 'game-ribbon game-ribbon-setup';
    ribbon.setAttribute('data-i18n', 'gameNeedsSetup');
    ribbon.textContent = t('gameNeedsSetup', 'Setup needed');
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
  const foot = document.createElement('div');
  foot.className = 'game-info-foot';
  const status = document.createElement('span');
  status.className = 'game-status status-' + game.status;
  const statusKey = game.status === 'ready' ? 'gameStatusReady' : 'gameStatusSoon';
  status.innerHTML = CHECK_SVG;
  const statusText = document.createElement('span');
  statusText.setAttribute('data-i18n', statusKey);
  statusText.textContent = _gameStatusLabel(game.status);
  status.appendChild(statusText);
  const badges = document.createElement('div');
  badges.className = 'game-badges';
  badges.appendChild(status);
  if (needsSetup) {
    // «Підтримується» + окремий warning: нема теки гри або файли ще не розпаковано.
    const needKey = hasDir ? 'gameNeedsPrepare' : 'gameNeedsSetup';
    const need = document.createElement('span');
    need.className = 'game-status status-setup';
    need.innerHTML = WARN_SVG;
    const needText = document.createElement('span');
    needText.setAttribute('data-i18n', needKey);
    needText.textContent = t(needKey, hasDir ? 'Не розпаковано' : 'Потрібен setup');
    need.appendChild(needText);
    badges.appendChild(need);
  }
  const open = document.createElement('span');
  open.className = 'game-open';
  open.innerHTML = CHEVRON_SVG;
  foot.appendChild(badges);
  foot.appendChild(open);
  info.appendChild(name);
  info.appendChild(sub);
  info.appendChild(foot);
  card.appendChild(info);

  if (isReady && typeof game.onSelect === 'function') {
    card.addEventListener('click', () => game.onSelect());
  } else if (needsSetup) {
    // Клік по картці без теки — відкрити Setup з цією грою (слухач у setup.js;
    // подія замість імпорту, бо setup.js сам імпортує home.js).
    card.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('kh:setup-game', { detail: { gameId: game.id } }));
    });
  }
  return card;
}

// ---------------------------------------------------------------------
// Toolbar: лічильник проєктів, пошук (фільтрує картки за назвою),
// перемикач grid/list.
// ---------------------------------------------------------------------
let _search = '';
let _view = 'grid';

function matchesSearch(game, q) {
  if (!q) return true;
  const hay = [game.name, game.title, game.platform, game.format, game.id].join(' ').toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

export function applyHomeFilter() {
  if (!homeGrid) return;
  const q = _search.trim().toLowerCase();
  let visible = 0;
  for (const card of homeGrid.querySelectorAll('.game-card')) {
    const g = gamesConfig.find(x => x.id === card.dataset.gameId);
    const show = !g || matchesSearch(g, q);
    card.classList.toggle('hidden', !show);
    if (show) visible++;
  }
  const empty = $('home-empty');
  if (empty) empty.classList.toggle('hidden', visible > 0);
  const countEl = $('home-count');
  if (countEl) {
    const total = gamesConfig.length;
    countEl.textContent = (q && visible !== total)
      ? t('hubProjectsFiltered', '{n} з {total} проєктів').replace('{n}', visible).replace('{total}', total)
      : t('hubProjectsCount', '{n} проєкти').replace('{n}', total);
  }
}

export function setHomeView(view) {
  _view = view === 'list' ? 'list' : 'grid';
  if (homeScreen) homeScreen.classList.toggle('view-list', _view === 'list');
  for (const btn of document.querySelectorAll('.hub-view-btn')) {
    const on = btn.dataset.view === _view;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  try { localStorage.setItem('kh.homeView.v2', _view); } catch (_) {}
}

let _toolbarWired = false;
function wireToolbar() {
  if (_toolbarWired) return;
  _toolbarWired = true;
  const input = $('home-search');
  if (input) {
    input.addEventListener('input', () => { _search = input.value; applyHomeFilter(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; _search = ''; applyHomeFilter(); }
    });
  }
  for (const btn of document.querySelectorAll('.hub-view-btn')) {
    btn.addEventListener('click', () => setHomeView(btn.dataset.view));
  }
  let saved = 'grid';
  try { saved = localStorage.getItem('kh.homeView.v2') || 'grid'; } catch (_) {}
  setHomeView(saved);
}

// ---------------------------------------------------------------------
// Sidebar navigation. Handlers (settings/about/help) живуть у main.js —
// передаються сюди, щоб не тягнути editor.js/settings-modal.js у home.js.
// ---------------------------------------------------------------------
export function initHomeNav(handlers) {
  const h = handlers || {};
  const wire = (id, fn) => { const el = $(id); if (el && typeof fn === 'function') el.addEventListener('click', fn); };
  wire('hub-nav-home', () => { showHome(); const s = $('home-search'); if (s) s.focus(); });
  wire('hub-nav-settings', h.onSettings);
  wire('hub-nav-about', h.onAbout);
  wire('hub-nav-help', h.onHelp);
  const ver = $('hub-version');
  if (ver && window.kh1 && window.kh1.about) {
    window.kh1.about().then((info) => {
      if (info && info.version) ver.textContent = 'v' + info.version;
    }).catch(() => {});
  }
}

export function renderHome() {
  if (!homeGrid) return;
  homeGrid.innerHTML = '';
  for (const g of gamesConfig) homeGrid.appendChild(renderGameCard(g));
  wireToolbar();
  applyHomeFilter();
}

export function showHome() {
  if (!homeScreen || !appRoot) return;
  hideSetup();
  homeScreen.classList.remove('hidden');
  homeScreen.setAttribute('aria-hidden', 'false');
  appRoot.classList.add('hidden');
}
export function hideHome() {
  if (!homeScreen || !appRoot) return;
  homeScreen.classList.add('hidden');
  homeScreen.setAttribute('aria-hidden', 'true');
  appRoot.classList.remove('hidden');
}
