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
    kind: 'kindFull',
    title: 'KINGDOM HEARTS\nFINAL MIX',
    name: 'Kingdom Hearts Final Mix',
    // Обкладинка (SteamGridDB, 920×430) замість намальованого hero; на ній уже є логотип.
    image: 'assets/covers/kh1-final-mix.png',
    platform: 'PC (Steam / Epic Games)',
    format: '.bin / .ard',
    theme: 'final-mix',
    enabled: true,
    status: 'ready',
    formats: ['binl', 'binl-v361', 'rawbin', 'ev', 'mesofs', 'kmb'],
    // KH1: список файлів — з ENG (розпакована гра); RUS — опційний оракул
    // (російський переклад): рядки, ідентичні в RUS, вважаються неперекладними.
    dirs: ['engDir', 'rusDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh1-final-mix')
  }),
  game({
    id: 'kh-re-com',
    kind: 'kindSubsMenu',
    title: 'KINGDOM HEARTS\nRE:CHAIN OF MEMORIES',
    name: 'Kingdom Hearts Re:Chain of Memories',
    // Один список усіх рядків з усіх файлів (без вкладки «Глосарій»), txt — формат MGS1.
    txtFormat: 'mgs', listTitleKey: 'tabFiles',
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
    kind: 'kindSubsMenuReports',
    title: 'KINGDOM HEARTS\nDREAM DROP DISTANCE HD',
    name: 'Kingdom Hearts 3D: Dream Drop Distance HD',
    // Один список усіх рядків з усіх файлів (без вкладки «Глосарій»), txt — формат MGS1.
    txtFormat: 'mgs', listTitleKey: 'tabFiles',
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
    kind: 'kindSubsMenu',
    title: 'KINGDOM HEARTS\nBIRTH BY SLEEP\nFINAL MIX',
    name: 'Kingdom Hearts: Birth by Sleep Final Mix',
    // Один список усіх рядків з усіх файлів (без вкладки «Глосарій»), txt — формат MGS1.
    txtFormat: 'mgs', listTitleKey: 'tabFiles',
    image: 'assets/covers/kh-bbs-final-mix.png',
    platform: 'PC (Steam / Epic Games)',
    format: '.ctd (subtitles + menu text)',
    theme: 'bbs',
    enabled: true,
    status: 'ready',
    // `.ctd` — репліки й меню; `bbs-arc` — підписи, зашиті у розкладки .l2d
    // всередині original/arc_en/*/*.arc (пауза, табір, вибір героя). Без
    // bbs-arc ці файли не потрапляли у список і тому ніколи не збиралися.
    formats: ['ctd', 'bbs-arc'],
    // BBS: ENG = і джерело тексту і список файлів; UA = вихід; TSV = прогрес.
    // Без RUS-оракула.
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-bbs-final-mix')
  }),
  // --- збірки роликів (Image/Mare.hed) ------------------------------------
  // Days і Re:coded вийшли на PC лише як відеоверсії сюжету: ігрового процесу
  // немає, але ВЕСЬ текст — це субтитри, і формат той самий @CTD, що у DDD.
  game({
    id: 'kh-days',
    kind: 'kindCutscenes',
    title: 'KINGDOM HEARTS\n358/2 DAYS',
    name: 'Kingdom Hearts 358/2 Days (HD cutscenes)',
    image: 'assets/covers/kh-days.png',
    txtFormat: 'mgs', listTitleKey: 'tabFiles',
    platform: 'PC (KH HD 1.5+2.5)',
    format: '.ctd (cutscene subtitles + diary)',
    theme: 're-com',
    enabled: true,
    status: 'ready',
    formats: ['ctd-ddd'],
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-days')
  }),
  game({
    id: 'kh-recoded',
    kind: 'kindCutscenes',
    title: 'KINGDOM HEARTS\nRE:CODED',
    name: 'Kingdom Hearts Re:coded (HD cutscenes)',
    image: 'assets/covers/kh-recoded.png',
    txtFormat: 'mgs', listTitleKey: 'tabFiles',
    platform: 'PC (KH HD 1.5+2.5)',
    format: '.ctd (cutscene subtitles)',
    theme: 'ddd',
    enabled: true,
    status: 'ready',
    formats: ['ctd-ddd'],
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-recoded')
  }),
  // Режим «Театр» KH1 (KINGDOM HEARTS Theater.exe): ті самі репліки, що в
  // самій грі, тому більшість рядків підставляється з глосарія KH1.
  game({
    id: 'kh-theater',
    kind: 'kindCutscenes',
    title: 'KINGDOM HEARTS\nTHEATER',
    name: 'Kingdom Hearts Theater (KH1 cutscenes)',
    txtFormat: 'mgs', listTitleKey: 'tabFiles',
    platform: 'PC (KH HD 1.5+2.5)',
    format: '.ctd (subtitles + chapter titles)',
    theme: 'final-mix',
    enabled: true,
    status: 'ready',
    formats: ['ctd-ddd'],
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir',
    onSelect: () => enterEditor('kh-theater')
  }),
  // --- ще не відкриті ------------------------------------------------------
  // 0.2 — гра на Unreal Engine 4; текст лежить у Content/Paks/*.pak, і індекс
  // архіву зашифрований, тож перелічити файли без ключа неможливо.
  // Back Cover — повнометражний ролик; окремих субтитрів поруч немає, вони
  // або всередині того самого .pak, або вшиті у відео.
  game({
    id: 'kh-02-bbs',
    kind: 'kindTextures',
    title: 'KINGDOM HEARTS 0.2\nBIRTH BY SLEEP',
    name: 'Kingdom Hearts 0.2 Birth by Sleep',
    image: 'assets/covers/kh-02-bbs.png',
    platform: 'PC (KH HD 2.8) · Unreal Engine 4',
    format: '.pak (encrypted index)',
    theme: 'bbs',
    enabled: false,
    status: 'soon',
    formats: [],
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir'
  }),
  game({
    id: 'kh-back-cover',
    kind: 'kindVideo',
    title: 'KINGDOM HEARTS χ\nBACK COVER',
    name: 'Kingdom Hearts χ Back Cover (movie)',
    image: 'assets/covers/kh-back-cover.png',
    platform: 'PC (KH HD 2.8)',
    format: '.usm (video only, no subtitle files)',
    theme: 're-com',
    enabled: false,
    status: 'soon',
    formats: [],
    dirs: ['engDir', 'tsvDir', 'outDir'],
    sourceDirKey: 'engDir'
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

// Статистика прогресу з TSV-теки кожної гри (_glossary.json): скільки рядків
// уже має переклад і коли востаннє змінювався прогрес. Підвантажується один
// раз після першого рендера — картки оновлюються на місці.
export let _gameStats = {};
export async function refreshGameStats() {
  try {
    _gameStats = (await window.kh1.setup.gameStats()) || {};
  } catch (_) { _gameStats = {}; }
}

// Стадія проєкту — те, що показує кольорова позначка й фільтри:
//   planned   — формат ще не розібрано (сіро-синя);
//   wip       — переклад уже почато, у глосарії гри є готові рядки (золота);
//   supported — формат підтримується, але перекладу ще немає (зелена).
export function _gameStage(game) {
  if (!game.enabled) return 'planned';
  const st = _gameStats[game.id];
  if (st && st.done > 0) return 'wip';
  return 'supported';
}

const STAGE_LABEL = {
  supported: ['hubStageSupported', 'Підтримується'],
  wip:       ['hubStageWip', 'У роботі'],
  planned:   ['hubStagePlanned', 'Заплановано']
};

function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const day = 86400000;
  if (diff < 3600000) return t('hubUpdatedNow', 'щойно');
  if (diff < day) return t('hubUpdatedHours', '{n} год тому').replace('{n}', Math.max(1, Math.round(diff / 3600000)));
  if (diff < day * 30) return t('hubUpdatedDays', '{n} дн тому').replace('{n}', Math.round(diff / day));
  return new Date(ms).toLocaleDateString();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function renderGameCard(game) {
  const card = document.createElement('article');
  // Гра доступна тільки якщо: (a) gamesConfig.enabled (статичний support flag),
  // (b) користувач указав директорію цієї гри у setup'і.
  const hasDir = _gameHasDir(game.id);
  const prepared = _gameIsPrepared(game.id);
  const isReady = game.enabled && hasDir && prepared;
  // Підтримувана гра без теки або з нерозпакованими файлами — стан needs-setup:
  // клік відкриває Setup для цієї гри (вибір теки / кнопка «Розпакувати»).
  const needsSetup = game.enabled && !isReady;
  const stage = _gameStage(game);
  card.className = 'game-card theme-' + (game.theme || 'final-mix') + ' stage-' + stage +
    (isReady ? '' : (needsSetup ? ' needs-setup' : ' disabled'));
  card.dataset.gameId = game.id;
  card.dataset.stage = stage;
  card.setAttribute('role', 'listitem');

  const openable = game.enabled;
  if (openable) {
    card.tabIndex = 0;
    card.setAttribute('aria-label', game.name);
  } else {
    card.setAttribute('aria-disabled', 'true');
    card.setAttribute('data-i18n-title', 'gameSoonTooltip');
    card.title = t('gameSoonTooltip', 'Підтримка з’явиться пізніше');
  }
  if (needsSetup) {
    const tipKey = hasDir ? 'gameNotPreparedTooltip' : 'gameNoDirTooltip';
    card.setAttribute('data-i18n-title', tipKey);
    card.title = t(tipKey, hasDir ? 'Натисни, щоб розпакувати файли цієї гри (Setup)' : 'Натисни, щоб вказати теку цієї гри (Setup)');
  }

  // ---- обкладинка ----
  const cover = el('div', 'game-cover');
  if (game.image) {
    const img = document.createElement('img');
    img.src = game.image;
    img.alt = '';
    img.loading = 'lazy';
    cover.appendChild(img);
  } else {
    const art = el('div', 'game-cover-art');
    art.innerHTML = heroArt(game.theme);
    cover.appendChild(art);
    const heart = el('div', 'game-cover-heart');
    heart.innerHTML = HEART_SVG;
    cover.appendChild(heart);
  }
  cover.appendChild(el('div', 'game-cover-overlay'));
  const ct = el('div', 'game-cover-title');
  // На готовій обкладинці логотип уже є — свій заголовок не малюємо.
  if (game.image) ct.hidden = true;
  String(game.title).split('\n').forEach((line, i) => {
    if (i) ct.appendChild(document.createElement('br'));
    ct.appendChild(document.createTextNode(line));
  });
  cover.appendChild(ct);

  // Позначка стадії — прямо на обкладинці.
  const badge = el('span', 'game-badge badge-' + stage);
  if (stage !== 'planned') badge.innerHTML = CHECK_SVG;
  const badgeText = el('span', null, t(STAGE_LABEL[stage][0], STAGE_LABEL[stage][1]));
  badgeText.setAttribute('data-i18n', STAGE_LABEL[stage][0]);
  badge.appendChild(badgeText);
  cover.appendChild(badge);
  card.appendChild(cover);

  // ---- текст ----
  const info = el('div', 'game-info');
  info.appendChild(el('h3', 'game-name', game.name));

  const meta = el('p', 'game-meta');
  meta.appendChild(el('span', 'game-meta-platform', game.platform));
  meta.appendChild(el('span', 'game-meta-sep', '·'));
  meta.appendChild(el('span', 'game-meta-kind', t(game.kind || '', game.format)));
  // Технічні деталі (.ctd / .ard / UTF-16) — другорядні: тільки у підказці.
  meta.title = game.format;
  info.appendChild(meta);

  // Прогрес — лише коли справді є що показати.
  const st = _gameStats[game.id];
  if (st && st.total) {
    const pct = Math.round((st.done / st.total) * 100);
    const wrap = el('div', 'game-progress');
    const head = el('div', 'game-progress-head');
    head.appendChild(el('span', 'game-progress-label', t('hubProgress', 'Переклад')));
    head.appendChild(el('span', 'game-progress-val', pct + '%'));
    const bar = el('div', 'game-progress-bar');
    const fill = el('div', 'game-progress-fill');
    fill.style.width = Math.max(2, pct) + '%';
    bar.appendChild(fill);
    wrap.appendChild(head);
    wrap.appendChild(bar);
    wrap.title = t('hubProgressTip', '{done} з {total} рядків')
      .replace('{done}', st.done).replace('{total}', st.total);
    info.appendChild(wrap);
  }

  const foot = el('div', 'game-info-foot');
  const left = el('div', 'game-foot-left');
  if (needsSetup) {
    const needKey = hasDir ? 'gameNeedsPrepare' : 'gameNeedsSetup';
    const need = el('span', 'game-status status-setup');
    need.innerHTML = WARN_SVG;
    const needText = el('span', null, t(needKey, hasDir ? 'Не розпаковано' : 'Потрібен setup'));
    needText.setAttribute('data-i18n', needKey);
    need.appendChild(needText);
    left.appendChild(need);
  } else if (st && st.updatedAt) {
    left.appendChild(el('span', 'game-updated',
      t('hubUpdated', 'Оновлено {when}').replace('{when}', relTime(st.updatedAt))));
  }
  foot.appendChild(left);

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'game-open-btn';
  const openLabel = el('span', null, t('hubOpen', 'Відкрити'));
  openLabel.setAttribute('data-i18n', 'hubOpen');
  open.appendChild(openLabel);
  const chev = el('span', 'game-open-chev');
  chev.innerHTML = CHEVRON_SVG;
  open.appendChild(chev);
  if (!openable) open.disabled = true;
  foot.appendChild(open);

  info.appendChild(foot);
  card.appendChild(info);

  if (!game.enabled) {
    const ribbon = el('div', 'game-ribbon', t('comingSoon', 'Coming Soon'));
    ribbon.setAttribute('data-i18n', 'comingSoon');
    card.appendChild(ribbon);
  }

  // Клік будь-де по картці = «Відкрити».
  const activate = () => {
    if (isReady && typeof game.onSelect === 'function') game.onSelect();
    else if (needsSetup) document.dispatchEvent(new CustomEvent('kh:setup-game', { detail: { gameId: game.id } }));
  };
  if (openable) {
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
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
let _filter = 'all';

function matchesSearch(game, q) {
  if (!q) return true;
  const hay = [game.name, game.title, game.platform, game.format, game.id].join(' ').toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function matchesFilter(game) {
  return _filter === 'all' || _gameStage(game) === _filter;
}

// Рядок-підсумок під заголовком: скільки проєктів і в якому вони стані.
export function updateHomeSummary() {
  const counts = { all: gamesConfig.length, supported: 0, wip: 0, planned: 0 };
  for (const g of gamesConfig) counts[_gameStage(g)]++;
  for (const el of document.querySelectorAll('.hub-filter-n')) {
    const k = el.getAttribute('data-count');
    if (k in counts) el.textContent = String(counts[k]);
  }
  const sum = $('hub-summary');
  if (sum) {
    const parts = [
      t('hubProjectsCount', '{n} проєктів').replace('{n}', counts.all),
      t('hubSummarySupported', '{n} підтримуються').replace('{n}', counts.supported),
      t('hubSummaryWip', '{n} у роботі').replace('{n}', counts.wip),
      t('hubSummaryPlanned', '{n} заплановано').replace('{n}', counts.planned)
    ];
    sum.textContent = parts.join(' · ');
  }
}

export function applyHomeFilter() {
  if (!homeGrid) return;
  const q = _search.trim().toLowerCase();
  let visible = 0;
  for (const card of homeGrid.querySelectorAll('.game-card')) {
    const g = gamesConfig.find(x => x.id === card.dataset.gameId);
    const show = !g || (matchesSearch(g, q) && matchesFilter(g));
    card.classList.toggle('hidden', !show);
    if (show) visible++;
  }
  const empty = $('home-empty');
  if (empty) empty.classList.toggle('hidden', visible > 0);
  updateHomeSummary();
}

export function setHomeFilter(filter) {
  _filter = filter || 'all';
  for (const btn of document.querySelectorAll('.hub-filter')) {
    const on = btn.dataset.filter === _filter;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  applyHomeFilter();
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
  for (const btn of document.querySelectorAll('.hub-filter')) {
    btn.addEventListener('click', () => setHomeFilter(btn.dataset.filter));
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
let REPO_URL = 'https://github.com/LittleBitUA';
const DISCORD_URL = 'https://discord.gg/';

export function initHomeNav(handlers) {
  const h = handlers || {};
  const wire = (id, fn) => { const el = $(id); if (el && typeof fn === 'function') el.addEventListener('click', fn); };
  wire('hub-nav-home', () => { showHome(); const s = $('home-search'); if (s) s.focus(); });
  wire('hub-nav-settings', h.onSettings);
  wire('hub-nav-about', h.onAbout);
  wire('hub-nav-help', h.onHelp);
  wire('hub-check-updates', h.onCheckUpdates);
  const open = (url) => { if (window.kh1 && window.kh1.app && window.kh1.app.openExternal) window.kh1.app.openExternal(url); };
  wire('hub-link-github', () => open(REPO_URL));
  wire('hub-link-discord', () => open(DISCORD_URL));
  const vers = ['hub-version', 'hub-version-foot'].map($).filter(Boolean);
  if (vers.length && window.kh1 && window.kh1.about) {
    window.kh1.about().then((info) => {
      if (info && info.version) for (const v of vers) v.textContent = 'v' + info.version;
      if (info && info.repo) REPO_URL = info.repo;
    }).catch(() => {});
  }
}

export function renderHome() {
  if (!homeGrid) return;
  homeGrid.innerHTML = '';
  for (const g of gamesConfig) homeGrid.appendChild(renderGameCard(g));
  wireToolbar();
  applyHomeFilter();
  markFeatured();
}

// Найсвіжіше оновлений проєкт отримує трохи помітніше оформлення.
function markFeatured() {
  let best = null;
  for (const [gid, st] of Object.entries(_gameStats)) {
    if (st && st.updatedAt && (!best || st.updatedAt > best.at)) best = { id: gid, at: st.updatedAt };
  }
  for (const card of homeGrid.querySelectorAll('.game-card')) {
    card.classList.toggle('is-featured', !!best && card.dataset.gameId === best.id);
  }
}

// Статистика читається з диска, тому підвантажуємо її після першого малювання
// і перемальовуємо картки вже з прогресом.
export async function renderHomeWithStats() {
  renderHome();
  await refreshGameStats();
  renderHome();
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
