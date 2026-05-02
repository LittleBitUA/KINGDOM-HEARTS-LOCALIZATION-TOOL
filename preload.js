'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const VALID_MENU_CHANNELS = new Set([
  'menu:open',
  'menu:save',
  'menu:find',
  'menu:find-next',
  'menu:about',
  'menu:mode-editor',
  'menu:mode-translate',
  'menu:replace',
  'menu:mode-kerning',
  'menu:check-updates'
]);

contextBridge.exposeInMainWorld('kh1', {
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (text, suggestedName) =>
    ipcRenderer.invoke('file:save', { text, suggestedName }),
  about: () => ipcRenderer.invoke('app:about'),
  app: {
    setLanguage: (lang) => ipcRenderer.invoke('app:setLanguage', lang),
    getCharMap: () => ipcRenderer.invoke('app:getCharMap'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
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
    getSettings: () => ipcRenderer.invoke('translate:getSettings'),
    saveSettings: (s) => ipcRenderer.invoke('translate:saveSettings', s),
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
    importTranslations: () => ipcRenderer.invoke('translate:importTranslations'),
    exportFileTxt: (payload) => ipcRenderer.invoke('translate:exportFileTxt', payload),
    importFileTxt: () => ipcRenderer.invoke('translate:importFileTxt'),
    measureMany: (payload) => ipcRenderer.invoke('translate:measureMany', payload),
    autoWrap: (payload) => ipcRenderer.invoke('translate:autoWrap', payload),
    autoWrapAdaptive: (payload) => ipcRenderer.invoke('translate:autoWrapAdaptive', payload),
    getWorldsMap: () => ipcRenderer.invoke('translate:getWorldsMap'),
    onProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_e, p) => callback(p);
      ipcRenderer.on('translate:progress', listener);
      return () => ipcRenderer.removeListener('translate:progress', listener);
    }
  },
  kerning: {
    openKnj: () => ipcRenderer.invoke('kerning:openKnj'),
    openDds: (suggestedDir) => ipcRenderer.invoke('kerning:openDds', suggestedDir),
    autoFindDds: (knjPath) => ipcRenderer.invoke('kerning:autoFindDds', knjPath),
    saveKnj: (payload) => ipcRenderer.invoke('kerning:saveKnj', payload),
    encodeText: (text) => ipcRenderer.invoke('kerning:encodeText', text)
  }
});
