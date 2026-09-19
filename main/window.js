'use strict';

// Головне вікно: створення, стан, безпечний send у renderer, window-controls IPC.

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
const ROOT = path.join(__dirname, '..');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#050505',
    title: 'Kingdom Hearts Ukrainian Localization Hub',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    frame: false,                    // Власний title bar (KH-style)
    titleBarStyle: 'hidden',
    thickFrame: false,               // прибрати Win11 accent-color border
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  // Dev-допомога: KH_DEBUG=1 дзеркалить console renderer'а у термінал і
  // відкриває DevTools — щоб бачити помилки без GUI.
  if (process.env.KH_DEBUG) {
    mainWindow.webContents.on('console-message', (_ev, level, message, line, sourceId) => {
      const lvl = ['debug', 'info', 'warn', 'error'][level] || level;
      console.log('[renderer:' + lvl + '] ' + message + ' (' + path.basename(String(sourceId)) + ':' + line + ')');
    });
    mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.openDevTools({ mode: 'detach' }));
  }

  // Відкривати на максимум за замовчуванням (за запитом користувача).
  mainWindow.maximize();

  // Notify renderer про зміни window state (для max/restore icon swap).
  const sendWinState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('win:state', {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen()
    });
  };
  mainWindow.on('maximize', sendWinState);
  mainWindow.on('unmaximize', sendWinState);
  mainWindow.on('enter-full-screen', sendWinState);
  mainWindow.on('leave-full-screen', sendWinState);
  // Перед закриттям даємо renderer'у скинути незбережений TSV/глосарій
  // (autosave має дебаунс 1.5с — інакше останні правки губляться).
  // Renderer відповідає через 'app:close-ready'; таймаут — страховка, щоб
  // вікно не «зависло» якщо renderer впав.
  let closeReady = false;
  mainWindow.on('close', (e) => {
    if (closeReady || !mainWindow || mainWindow.isDestroyed()) return;
    e.preventDefault();
    const finish = () => {
      if (closeReady) return;
      closeReady = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    };
    const timer = setTimeout(finish, 3000);
    ipcMain.once('app:close-ready', () => { clearTimeout(timer); finish(); });
    try { mainWindow.webContents.send('app:before-close'); }
    catch (_) { clearTimeout(timer); finish(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// IPC: window controls для custom title bar.

function get() { return mainWindow; }
function isAlive() { return !!(mainWindow && !mainWindow.isDestroyed()); }
function send(channel, payload) {
  if (!isAlive()) return;
  if (payload === undefined) mainWindow.webContents.send(channel);
  else mainWindow.webContents.send(channel, payload);
}

// IPC: window controls для custom title bar.
ipcMain.handle('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('win:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('win:close', () => mainWindow && mainWindow.close());
ipcMain.handle('win:isMaximized', () => mainWindow && mainWindow.isMaximized());

module.exports = { createWindow, get, isAlive, send };
