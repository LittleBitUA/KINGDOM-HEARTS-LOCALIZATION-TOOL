'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const VALID_MENU_CHANNELS = new Set([
  'menu:save',
  'menu:find',
  'menu:about',
  'menu:mode-translate',
  'menu:replace',
  'menu:mode-kerning',
  'menu:check-updates'
]);

contextBridge.exposeInMainWorld('kh1', {
  about: () => ipcRenderer.invoke('app:about'),
  // Electron 32+ прибрав нестандартний File.path — єдиний спосіб дістати
  // абсолютний шлях drag-and-drop файла з sandboxed renderer'а.
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; }
    catch (_) { return ''; }
  },
  // Custom title bar API
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onState: (callback) => {
      const listener = (_, state) => callback(state);
      ipcRenderer.on('win:state', listener);
      return () => ipcRenderer.removeListener('win:state', listener);
    }
  },
  app: {
    setLanguage: (lang) => ipcRenderer.invoke('app:setLanguage', lang),
    getCharMap: () => ipcRenderer.invoke('app:getCharMap'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    // Graceful close: main шле 'app:before-close', renderer скидає autosave
    // і відповідає closeReady().
    onBeforeClose: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = () => callback();
      ipcRenderer.on('app:before-close', listener);
      return () => ipcRenderer.removeListener('app:before-close', listener);
    },
    closeReady: () => ipcRenderer.send('app:close-ready'),
    downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    installDone: (payload) => ipcRenderer.invoke('translate:installDone', payload),
    onUpdate: (channel, callback) => {
      const valid = ['update:checking', 'update:available', 'update:none', 'update:error', 'update:progress', 'update:downloaded'];
      if (!valid.includes(channel) || typeof callback !== 'function') return () => {};
      const listener = (_e, p) => callback(p);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  onMenu: (channel, callback) => {
    if (!VALID_MENU_CHANNELS.has(channel)) return () => {};
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  translate: {
    getSettings: (gameId) => ipcRenderer.invoke('translate:getSettings', gameId),
    saveSettings: (s, gameId) => ipcRenderer.invoke('translate:saveSettings', s, gameId),
    pickDirectory: (title) => ipcRenderer.invoke('translate:pickDirectory', title),
    listFiles: (rusDir) => ipcRenderer.invoke('translate:listFiles', rusDir),
    extract: (payload) => ipcRenderer.invoke('translate:extract', payload),
    compose: (payload) => ipcRenderer.invoke('translate:compose', payload),
    saveTsv: (payload) => ipcRenderer.invoke('translate:saveTsv', payload),
    readTsv: (tsvPath) => ipcRenderer.invoke('translate:readTsv', tsvPath),
    tsvExists: (tsvPath) => ipcRenderer.invoke('translate:tsvExists', tsvPath),
    readGlossary: (tsvDir) => ipcRenderer.invoke('translate:readGlossary', tsvDir),
    saveGlossary: (payload) => ipcRenderer.invoke('translate:saveGlossary', payload),
    buildGlossary: (payload) => ipcRenderer.invoke('translate:buildGlossary', payload),
    composeAll: (payload) => ipcRenderer.invoke('translate:composeAll', payload),
    importTranslations: (opts) => ipcRenderer.invoke('translate:importTranslations', opts),
    exportFileTxt: (payload) => ipcRenderer.invoke('translate:exportFileTxt', payload),
    importFileTxt: () => ipcRenderer.invoke('translate:importFileTxt'),
    measureMany: (payload) => ipcRenderer.invoke('translate:measureMany', payload),
    autoWrap: (payload) => ipcRenderer.invoke('translate:autoWrap', payload),
    knjWidths: (payload) => ipcRenderer.invoke('translate:knjWidths', payload),
    autoWrapAdaptive: (payload) => ipcRenderer.invoke('translate:autoWrapAdaptive', payload),
    getWorldsMap: () => ipcRenderer.invoke('translate:getWorldsMap'),
    exportTextAll: (payload) => ipcRenderer.invoke('translate:exportTextAll', payload),
    importTextAll: (payload) => ipcRenderer.invoke('translate:importTextAll', payload),
    importTextAllPair: (payload) => ipcRenderer.invoke('translate:importTextAllPair', payload),
    pickTextFile: (opts) => ipcRenderer.invoke('translate:pickTextFile', opts || {}),
    saveTextFile: (payload) => ipcRenderer.invoke('translate:saveTextFile', payload),
    onProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_e, p) => callback(p);
      ipcRenderer.on('translate:progress', listener);
      return () => ipcRenderer.removeListener('translate:progress', listener);
    }
  },
  setup: {
    status:  () => ipcRenderer.invoke('setup:status'),
    run:     (payload) => ipcRenderer.invoke('setup:run', payload),
    detectGames: () => ipcRenderer.invoke('setup:detectGames'),
    checkGameDir: (payload) => ipcRenderer.invoke('setup:checkGameDir', payload),
    pickDir: (title)   => ipcRenderer.invoke('setup:pickDir', title),
    reset:   () => ipcRenderer.invoke('setup:reset'),
    onProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_e, p) => callback(p);
      ipcRenderer.on('setup:progress', listener);
      return () => ipcRenderer.removeListener('setup:progress', listener);
    }
  },
  comkern: {
    locate: (payload) => ipcRenderer.invoke('comkern:locate', payload),
    open:   () => ipcRenderer.invoke('comkern:open'),
    load:   (payload) => ipcRenderer.invoke('comkern:load', payload),
    save:   (payload) => ipcRenderer.invoke('comkern:save', payload),
    cyrTable: () => ipcRenderer.invoke('comkern:cyrTable')
  },
  bubbles: {
    scan:   (payload) => ipcRenderer.invoke('bubbles:scan', payload),
    glyphs: (payload) => ipcRenderer.invoke('bubbles:glyphs', payload),
    atlas:  (payload) => ipcRenderer.invoke('bubbles:atlas', payload),
    load:   (payload) => ipcRenderer.invoke('bubbles:load', payload),
    save:   (payload) => ipcRenderer.invoke('bubbles:save', payload)
  },
  patch: {
    status: (payload) => ipcRenderer.invoke('patch:status', payload),
    build:  (payload) => ipcRenderer.invoke('patch:build', payload),
    apply:  (payload) => ipcRenderer.invoke('patch:apply', payload),
    onProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_e, p) => callback(p);
      ipcRenderer.on('patch:progress', listener);
      return () => ipcRenderer.removeListener('patch:progress', listener);
    }
  },
  uafonts: {
    python:     () => ipcRenderer.invoke('uafonts:python'),
    pipInstall: () => ipcRenderer.invoke('uafonts:pipInstall'),
    locate:     (payload) => ipcRenderer.invoke('uafonts:locate', payload),
    generate:   (payload) => ipcRenderer.invoke('uafonts:generate', payload),
    install:    (payload) => ipcRenderer.invoke('uafonts:install', payload),
    openDir:    (dir) => ipcRenderer.invoke('uafonts:openDir', dir),
    defaults:   (gameId) => ipcRenderer.invoke('uafonts:defaults', gameId),
    pickFont:   () => ipcRenderer.invoke('uafonts:pickFont'),
    onProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_e, p) => callback(p);
      ipcRenderer.on('uafonts:progress', listener);
      return () => ipcRenderer.removeListener('uafonts:progress', listener);
    }
  },
  bbsfont: {
    pickArcDir:  () => ipcRenderer.invoke('bbsfont:pickArcDir'),
    autoArc:     () => ipcRenderer.invoke('bbsfont:autoArc'),
    pickHdDir:   () => ipcRenderer.invoke('bbsfont:pickHdDir'),
    listFonts:   (dir) => ipcRenderer.invoke('bbsfont:listFonts', dir),
    loadFont:    (fontFiles) => ipcRenderer.invoke('bbsfont:loadFont', fontFiles),
    saveCod:     (payload) => ipcRenderer.invoke('bbsfont:saveCod', payload),
    listHdPngs:  (hdDir) => ipcRenderer.invoke('bbsfont:listHdPngs', hdDir)
  },
  kerning: {
    openKnj: () => ipcRenderer.invoke('kerning:openKnj'),
    loadKnjFromPath: (knjPath) => ipcRenderer.invoke('kerning:loadKnjFromPath', knjPath),
    openDds: (suggestedDir) => ipcRenderer.invoke('kerning:openDds', suggestedDir),
    loadDdsFromPath: (ddsPath) => ipcRenderer.invoke('kerning:loadDdsFromPath', ddsPath),
    autoFindDds: (knjPath) => ipcRenderer.invoke('kerning:autoFindDds', knjPath),
    saveKnj: (payload) => ipcRenderer.invoke('kerning:saveKnj', payload),
    encodeText: (text) => ipcRenderer.invoke('kerning:encodeText', text)
  }
});
