'use strict';

// Точка входу main-процесу. Уся логіка — у main/*.js:
//   window.js        — головне вікно + graceful close + win:* IPC
//   worker-pool.js   — пул codec-worker'ів
//   settings.js      — settings-файл, per-game dirs, міграції
//   menu.js          — application menu + мова main-процесу
//   ipc-translate.js — Translate-режим (extract/compose/glossary/TSV)
//   ipc-setup.js     — onboarding (OpenKH/KHPCPatchManager, unpack)
//   ipc-fonts.js     — BBS font editor + KH1 kerning
//   ipc-uafonts.js   — генерація UA-шрифтів (Python-інструменти) + встановлення у гру
//   ipc-patch.js     — патч в один клік (KHPCPatchManager: .pcpatch + застосування до .pkg)
//   ipc-comkern.js   — кернінг Re:CoM (шрифт FFMW .binl + атлас PNG)
//   autowrap.js      — auto-wrap за метриками .knj
//   ipc-app.js       — updater, мова, about, openExternal

const { app, BrowserWindow } = require('electron');
const win = require('./main/window');
const menu = require('./main/menu');
const workerPool = require('./main/worker-pool');
const { loadSettings, DEFAULT_LOC_ROOT, ensureLocalizationDirs } = require('./main/settings');

require('./main/ipc-translate');
require('./main/ipc-setup');
require('./main/ipc-fonts');
require('./main/ipc-uafonts');
require('./main/ipc-patch');
require('./main/ipc-comkern');
require('./main/autowrap');
require('./main/ipc-app');

app.whenReady().then(() => {
  try {
    const s = loadSettings();
    if (s && (s.language === 'en' || s.language === 'uk')) menu.setLang(s.language);
    // Авто-створення стандартної структури тек локалізації.
    // Якщо користувач не вказав власний `localizationRoot` у settings —
    // використовується ~/Documents/KH-Localization/.
    ensureLocalizationDirs((s && s.localizationRoot) || DEFAULT_LOC_ROOT);
  } catch (_) {}
  menu.buildMenu();
  win.createWindow();
  // KH_SMOKE=1 — headless e2e перевірка IPC (див. main/smoke.js).
  if (process.env.KH_SMOKE) require('./main/smoke').install(win.get());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win.createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  workerPool.terminateAll();
});
