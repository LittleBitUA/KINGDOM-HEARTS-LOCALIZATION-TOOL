import { toast } from './core/log.js';
import { refreshStatus, updateCursor } from './editor.js';
import { refreshProgress } from './translate/files.js';

// =====================================================================
// Auto-update wiring (toast notifications + download/install dialogs)
// =====================================================================
export let _updateAvailableInfo = null;
export let _updateInProgress = false;

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

export let _updateCheckedManually = false;
export async function checkForUpdatesManual() {
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

