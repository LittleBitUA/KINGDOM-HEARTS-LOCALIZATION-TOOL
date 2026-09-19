'use strict';

// Auto-update, мова, about, openExternal.

const { app, ipcMain, shell } = require('electron');
const win = require('./window');
const menu = require('./menu');
const { saveSettings } = require('./settings');

// electron-updater є опціональним: якщо нема (наприклад dev запуск без npm install) —
// просто вимикаємо auto-update, не падаємо.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; }
catch (_) { autoUpdater = null; }
const isPortable = !!process.env.PORTABLE_EXECUTABLE_FILE;

function sendUpdate(channel, payload) {
  win.send(channel, payload || null);
}

let updaterReady = false;
function setupAutoUpdater() {
  if (!autoUpdater || updaterReady) return;
  updaterReady = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => sendUpdate('update:checking'));
  autoUpdater.on('update-available', (info) => sendUpdate('update:available', {
    version: info && info.version,
    releaseDate: info && info.releaseDate,
    releaseNotes: info && info.releaseNotes,
    portable: isPortable,
    repo: 'https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest'
  }));
  autoUpdater.on('update-not-available', () => sendUpdate('update:none'));
  autoUpdater.on('error', (err) => sendUpdate('update:error', { message: (err && err.message) || String(err) }));
  autoUpdater.on('download-progress', (p) => sendUpdate('update:progress', {
    percent: Math.round((p && p.percent) || 0),
    bytesPerSecond: (p && p.bytesPerSecond) || 0,
    transferred: (p && p.transferred) || 0,
    total: (p && p.total) || 0
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate('update:downloaded', {
    version: info && info.version
  }));
}

ipcMain.handle('app:checkForUpdates', async () => {
  if (!autoUpdater) return { ok: false, error: 'electron-updater не доступний у цьому збірці' };
  setupAutoUpdater();
  try {
    const r = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      portable: isPortable,
      version: r && r.updateInfo ? r.updateInfo.version : null,
      currentVersion: app.getVersion()
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('app:downloadUpdate', async () => {
  if (!autoUpdater) return { ok: false, error: 'updater не доступний' };
  if (isPortable) return { ok: false, error: 'portable cannot auto-update' };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('app:installUpdate', () => {
  if (!autoUpdater || isPortable) return { ok: false };
  try { autoUpdater.quitAndInstall(false, true); return { ok: true }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

ipcMain.handle('app:openExternal', async (_e, url) => {
  if (typeof url !== 'string') return { ok: false };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'unsupported protocol' };
  try { await shell.openExternal(url); return { ok: true }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

ipcMain.handle('app:setLanguage', (_e, lang) => {
  menu.setLang(lang);
  try { saveSettings({ language: menu.getLang() }); } catch (_) {}
  menu.buildMenu();
  return { ok: true, lang: menu.getLang() };
});

ipcMain.handle('app:about', () => ({
  name: menu.dl('appName'),
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome
}));
