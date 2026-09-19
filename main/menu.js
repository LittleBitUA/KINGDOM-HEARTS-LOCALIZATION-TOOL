'use strict';

// Application menu + мова main-процесу (renderer має свій i18n.js).

const { Menu } = require('electron');
const win = require('./window');

let appLang = 'uk';

const MENU_DICT = {
  uk: {
    file: 'Файл', import: 'Імпортувати...', export: 'Експортувати як...',
    modeEditor: 'Режим: Редактор', modeTranslate: 'Режим: Переклад', modeKerning: 'Режим: Кернінг',
    quit: 'Вийти',
    edit: 'Редагування', undo: 'Скасувати', redo: 'Повторити',
    cut: 'Вирізати', copy: 'Копіювати', paste: 'Вставити', selectAll: 'Виділити все',
    find: 'Знайти...', findNext: 'Знайти далі', replace: 'Замінити в глосарії...',
    view: 'Вигляд', reload: 'Перезавантажити', devTools: 'Інструменти розробника',
    zoomIn: 'Збільшити масштаб', zoomOut: 'Зменшити масштаб', resetZoom: 'Скинути масштаб',
    fullscreen: 'Повноекранний режим',
    help: 'Довідка', about: 'Про програму', checkUpdates: 'Перевірити оновлення'
  },
  en: {
    file: 'File', import: 'Import...', export: 'Export as...',
    modeEditor: 'Mode: Editor', modeTranslate: 'Mode: Translate', modeKerning: 'Mode: Kerning',
    quit: 'Quit',
    edit: 'Edit', undo: 'Undo', redo: 'Redo',
    cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    find: 'Find...', findNext: 'Find Next', replace: 'Replace in glossary...',
    view: 'View', reload: 'Reload', devTools: 'Developer Tools',
    zoomIn: 'Zoom In', zoomOut: 'Zoom Out', resetZoom: 'Reset Zoom',
    fullscreen: 'Fullscreen',
    help: 'Help', about: 'About', checkUpdates: 'Check for updates'
  }
};
function ml(key) { return (MENU_DICT[appLang] && MENU_DICT[appLang][key]) || MENU_DICT.uk[key] || key; }

function getLang() { return appLang; }
function setLang(lang) { appLang = (lang === 'en') ? 'en' : 'uk'; }

function buildMenu() {
  const send = (channel) => () => win.send(channel);

  const template = [
    {
      label: ml('file'),
      submenu: [
        { label: ml('import'), accelerator: 'CmdOrCtrl+O', click: send('menu:open') },
        { label: ml('export'), accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { type: 'separator' },
        { label: ml('modeEditor'), accelerator: 'CmdOrCtrl+1', click: send('menu:mode-editor') },
        { label: ml('modeTranslate'), accelerator: 'CmdOrCtrl+2', click: send('menu:mode-translate') },
        { label: ml('modeKerning'), accelerator: 'CmdOrCtrl+3', click: send('menu:mode-kerning') },
        { type: 'separator' },
        { label: ml('quit'), role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    {
      label: ml('edit'),
      submenu: [
        { label: ml('undo'), role: 'undo' },
        { label: ml('redo'), role: 'redo' },
        { type: 'separator' },
        { label: ml('cut'), role: 'cut' },
        { label: ml('copy'), role: 'copy' },
        { label: ml('paste'), role: 'paste' },
        { label: ml('selectAll'), role: 'selectAll' },
        { type: 'separator' },
        { label: ml('find'), accelerator: 'CmdOrCtrl+F', click: send('menu:find') },
        { label: ml('findNext'), accelerator: 'F3', click: send('menu:find-next') },
        { label: ml('replace'), accelerator: 'CmdOrCtrl+H', click: send('menu:replace') }
      ]
    },
    {
      label: ml('view'),
      submenu: [
        { label: ml('reload'), role: 'reload' },
        { label: ml('devTools'), role: 'toggleDevTools' },
        { type: 'separator' },
        { label: ml('zoomIn'), role: 'zoomIn' },
        { label: ml('zoomOut'), role: 'zoomOut' },
        { label: ml('resetZoom'), role: 'resetZoom' },
        { type: 'separator' },
        { label: ml('fullscreen'), role: 'togglefullscreen' }
      ]
    },
    {
      label: ml('help'),
      submenu: [
        { label: ml('checkUpdates'), click: send('menu:check-updates') },
        { type: 'separator' },
        { label: ml('about'), click: send('menu:about') }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu, getLang, setLang, ml };
