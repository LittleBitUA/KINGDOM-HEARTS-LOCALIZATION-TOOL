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

// Заголовки native-діалогів і назви фільтрів файлів (main-процес не має
// доступу до renderer/i18n.js).
const DIALOG_DICT = {
  uk: {
    allFiles: 'Усі файли', supported: 'Підтримувані файли', binFiles: 'BIN файли', binlFiles: 'BINL файли',
    ardFiles: 'ARD файли', ctdlFiles: 'CTDL файли', knjFiles: 'Kanji файли', ddsFiles: 'DDS текстури',
    txtFiles: 'Текстові файли', tableFiles: 'Таблиці перекладів (HTML/CSV/TSV)',
    importFile: 'Імпортувати файл BIN/BINL/ARD', exportFile: 'Експортувати файл BIN/BINL/ARD',
    pickDir: 'Виберіть теку', pickArcDir: 'Вкажіть теку з розпакованим FontEn.arc (мають бути .inf/.cod/.mtx файли)',
    pickHdDir: 'Вкажіть HD-remastered теку (PNG атласи), або скасуйте',
    loadKnj: 'Завантажити .knj', loadDds: 'Завантажити .dds atlas', saveKnj: 'Зберегти .knj',
    importTranslations: 'Виберіть один або кілька файлів з готовими перекладами',
    exportTxt: 'Експортувати переклад у .txt', importTxt: 'Імпортувати переклад з .txt',
    appName: 'KH Localization Tool — редактор тексту Kingdom Hearts'
  },
  en: {
    allFiles: 'All files', supported: 'Supported files', binFiles: 'BIN files', binlFiles: 'BINL files',
    ardFiles: 'ARD files', ctdlFiles: 'CTDL files', knjFiles: 'Kanji files', ddsFiles: 'DDS textures',
    txtFiles: 'Text files', tableFiles: 'Translation tables (HTML/CSV/TSV)',
    importFile: 'Import BIN/BINL/ARD file', exportFile: 'Export BIN/BINL/ARD file',
    pickDir: 'Select folder', pickArcDir: 'Select the unpacked FontEn.arc folder (.inf/.cod/.mtx files)',
    pickHdDir: 'Select the HD-remastered folder (PNG atlases), or cancel',
    loadKnj: 'Load .knj', loadDds: 'Load .dds atlas', saveKnj: 'Save .knj',
    importTranslations: 'Select one or more files with ready translations',
    exportTxt: 'Export translation to .txt', importTxt: 'Import translation from .txt',
    appName: 'KH Localization Tool — Kingdom Hearts text editor'
  }
};
function dl(key) { return (DIALOG_DICT[appLang] && DIALOG_DICT[appLang][key]) || DIALOG_DICT.uk[key] || key; }

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

module.exports = { buildMenu, getLang, setLang, ml, dl };
