import { enterEditor } from '../app-shell.js';
import { toast } from '../core/log.js';
import { hideSetup } from './setup.js';

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
export const gamesConfig = [
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

export const homeScreen = document.getElementById('home-screen');
export const homeGrid   = document.getElementById('home-grid');
export const appRoot    = document.querySelector('.app');

export function _gameStatusLabel(status) {
  if (status === 'ready') return (window.i18n && window.i18n.t('gameStatusReady')) || 'Готово';
  if (status === 'soon')  return (window.i18n && window.i18n.t('gameStatusSoon'))  || 'Незабаром';
  return '';
}

export const HEART_SVG = '<svg viewBox="0 0 454 495" preserveAspectRatio="xMidYMid meet"><path fill="currentColor" d="m373.17 258.49c80.56-70.15 80.06-108.12 80.06-139.77-4.58-127.33-116.89-118.48-116.89-118.48 0 0.00197-100.38 0.00197-108.02 94.225 2.75 58.465 56.09 60.495 56.09 60.495s46.45-0.1 46.45-40.86c0-40.748-42.91-32.869-42.91-32.869s26.58 9.401 26.58 27.489c0 12.47-18.97 24.98-29.2 24.98s-27.93-8.44-27.93-29.94c0-59.653 69.28-59.936 76.96-59.936s76.65 6.201 78.03 77.366c0.47 24.02 0 49.77-38.68 89.51-135.38 113.54-146.45 191.72-146.45 191.72-1.03 0-12.1-78.18-147.48-191.72-38.679-39.74-39.147-65.49-38.679-89.51 1.387-71.165 70.349-77.366 78.029-77.366s76.97 0.283 76.97 59.936c0 21.5-17.7 29.94-27.93 29.94s-29.2-12.51-29.2-24.98c0-18.088 26.58-27.489 26.58-27.489s-42.92-7.879-42.92 32.869c0 40.76 46.46 40.86 46.46 40.86s53.33-2.03 56.08-60.495c-7.64-94.223-108.02-94.223-108.02-94.223 0-0.00003-112.3-8.8535-116.89 118.48 0.00008 31.65-0.49541 69.62 80.069 139.77 108.94 94.85 134.99 169.74 146.71 236.5 11.13-66.76 37.19-141.65 146.13-236.5z"/></svg>';

// Кеш gameDirectories з settings (оновлюється у bootstrapApp / після setup).
// Гра вважається "готовою до перекладу" лише якщо її директорію вказано.
export let _gameDirsCache = {};
export function setGameDirsCache(v) { _gameDirsCache = v || {}; }
export async function refreshGameDirsCache() {
  try {
    const s = await window.kh1.setup.status();
    _gameDirsCache = (s && s.gameDirectories) || {};
  } catch (_) { _gameDirsCache = {}; }
}
export function _gameHasDir(gameId) {
  const v = _gameDirsCache && _gameDirsCache[gameId];
  return !!(v && String(v).trim());
}

export function renderGameCard(game) {
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

export function renderHome() {
  if (!homeGrid) return;
  homeGrid.innerHTML = '';
  for (const g of gamesConfig) homeGrid.appendChild(renderGameCard(g));
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

