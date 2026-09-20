import { getCurrentGameId, goHome, setMode } from './app-shell.js';
import { aboutCloseBtn, aboutOverlay, gSearch, importOverlay, settingsOverlay } from './core/dom.js';
import { _logBadgeUpdate, _logRender, eventLog, toast } from './core/log.js';
import { state } from './core/state.js';
import { hideAbout, showAbout } from './about.js';
import { decodeDds, kApplyKnjLoaded, kRefreshStatus, kRenderGrid, kState } from './kerning/kerning.js';
import { applyHomeFilter, initHomeNav, renderHome } from './screens/home.js';
import { bootstrapApp } from './screens/setup.js';
import { hideSettings, openSettings } from './settings-modal.js';
import { gExportTxtBtn, gImportTxtBtn, saveGlossary } from './translate/glossary.js';
import { hideImport } from './translate/import.js';
import { showReplace } from './translate/replace.js';
import './translate/textall-ui.js';
import { initDropdowns } from './ui/dropdown.js';
import { initInspector } from './translate/inspector.js';
import { initPatch } from './translate/patch.js';
import { initComKerning } from './kerning/comkern.js';
import { initBubbles } from './bubbles/bubbles.js';
import { initTextures } from './textures/textures.js';

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
// Wire up — global
// =====================================================================
aboutCloseBtn.addEventListener('click', hideAbout);
aboutOverlay.addEventListener('click', (e) => { if (e.target === aboutOverlay) hideAbout(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!aboutOverlay.classList.contains('hidden')) { hideAbout(); return; }
    if (!settingsOverlay.classList.contains('hidden')) { hideSettings(); return; }
    if (!importOverlay.classList.contains('hidden')) { hideImport(); return; }
  }
  // Ctrl+E / Ctrl+I — Експорт/Імпорт TXT глосарію
  if (state.mode === 'translate' && e.ctrlKey && !e.shiftKey && !e.altKey) {
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
        if (gImportTxtBtn) gImportTxtBtn.click();
      }
    }
  }
});

// Menu handlers (Ctrl+S / Ctrl+F / Ctrl+H — у режимі перекладу)
window.kh1.onMenu('menu:save', () => {
  if (state.mode === 'translate') saveGlossary(false);
});
window.kh1.onMenu('menu:find', () => {
  if (state.mode === 'translate' && gSearch) { gSearch.focus(); gSearch.select(); }
});
window.kh1.onMenu('menu:about', showAbout);
window.kh1.onMenu('menu:replace', () => { if (state.mode === 'translate') showReplace(); });
window.kh1.onMenu('menu:mode-translate', () => setMode('translate'));
window.kh1.onMenu('menu:mode-kerning', () => setMode('kerning'));

// =====================================================================
// i18n: language switcher (in Settings modal) + initial apply
// =====================================================================
export const langOpts = document.querySelectorAll('.lang-opt');

export function setLangOptsUi(lang) {
  langOpts.forEach(b => b.setAttribute('aria-checked', b.dataset.lang === lang ? 'true' : 'false'));
}

export async function applyLanguage(lang, persist) {
  const finalLang = (lang === 'en') ? 'en' : 'uk';
  if (window.i18n) window.i18n.setLang(finalLang);
  setLangOptsUi(finalLang);
  // Лічильник проєктів на головній — не data-i18n (має плейсхолдер {n}).
  try { applyHomeFilter(); } catch (_) {}
  if (persist) {
    try { await window.kh1.translate.saveSettings({ language: finalLang }); } catch (_) {}
    try { await window.kh1.app.setLanguage(finalLang); } catch (_) {}
  }
}

export async function initLanguage() {
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


// Title-bar settings button + first-run auto-open.
export const tbSettingsBtn = document.getElementById('tb-settings');
if (tbSettingsBtn) tbSettingsBtn.addEventListener('click', openSettings);

// Title-bar brand (KH heart) → повернутися на головну.
export const tbHomeBtn = document.getElementById('tb-home');
if (tbHomeBtn) tbHomeBtn.addEventListener('click', goHome);

// Sidebar головного екрана → наявні handlers (settings-модал, about-діалог,
// README на GitHub через shell.openExternal).
export const HELP_URL = 'https://github.com/LittleBitUA/KH1-Localization-tool#readme';
initHomeNav({
  onSettings: openSettings,
  onAbout: showAbout,
  onHelp: () => {
    const p = window.kh1 && window.kh1.app && window.kh1.app.openExternal
      ? window.kh1.app.openExternal(HELP_URL) : Promise.resolve({ ok: false });
    p.then((r) => { if (!r || !r.ok) toast(HELP_URL, 'info', 6000); }).catch(() => toast(HELP_URL, 'info', 6000));
  }
});

// Event log drawer wiring.
eventLog.drawer  = document.getElementById('event-log');
eventLog.list    = document.getElementById('event-log-list');
eventLog.emptyEl = document.getElementById('event-log-empty');
eventLog.badge   = document.getElementById('tb-log-badge');

export const tbLogBtn = document.getElementById('tb-log');
export const elClose  = document.getElementById('event-log-close');
export const elClear  = document.getElementById('event-log-clear');

export function toggleEventLog() {
  if (!eventLog.drawer) return;
  const wasHidden = eventLog.drawer.classList.contains('hidden');
  eventLog.drawer.classList.toggle('hidden');
  eventLog.drawer.setAttribute('aria-hidden', wasHidden ? 'false' : 'true');
  if (wasHidden) {
    eventLog.unread = 0;
    _logBadgeUpdate();
  }
}
export function closeEventLog() {
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

export async function maybeFirstRunSettings() {
  try {
    // Перевіряємо щодо ПОТОЧНОЇ гри — якщо її dirs ще не вказані, відкриваємо settings.
    const s = await window.kh1.translate.getSettings(getCurrentGameId());
    const everConfigured = s && (s.language || s.engDir || s.rusDir || s.tsvDir || s.outDir);
    if (!everConfigured) openSettings();
  } catch (_) {}
}

// Послідовний старт: мова (await, щоб усі i18n-рядки
// у setup/home рендерились на правильній мові) → home-картки → bootstrap
// (вирішує showSetup() vs showHome() за setupCompleted у main.js).
(async () => {
  try { await initLanguage(); } catch (_) {}
  try { renderHome(); } catch (_) {}
  try { await bootstrapApp(); } catch (_) {}
})();
// maybeFirstRunSettings() та kAutoLoadKnjOnBoot() викликаються з enterEditor()
// при першому вході в редактор (щоб не виконувати KH1-specific логіку, коли
// користувач ще на головному екрані з вибором іншої гри).

// Тулбарні dropdown-меню та inspector translate-екрана.
initDropdowns();
initInspector();
initPatch();
initComKerning();
initBubbles();
initTextures();
