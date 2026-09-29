'use strict';

// Де живе користувацька карта нативних гліфів KH1 (kh1-native-map.json з
// генератора шрифту): <userData>/kh1-native-map.json. Кодек читає її замість
// data/kh1_native.json, якщо файл існує (додаткові символи для інших мов).

const { app } = require('electron');
const path = require('path');

function nativeMapPathFor() {
  return path.join(app.getPath('userData'), 'kh1-native-map.json');
}

// Те саме для СИСТЕМНОГО шрифту (меню, sysmsg, btltbl): карта «літера → байт»
// з tools/py/kh1/kh1sysfont.py. Без неї кодек бере вбудовану data/kh1sys_ua.json.
function sysFontMapPathFor() {
  return path.join(app.getPath('userData'), 'kh1-sysfont-map.json');
}

module.exports = { nativeMapPathFor, sysFontMapPathFor };
