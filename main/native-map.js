'use strict';

// Де живе користувацька карта нативних гліфів KH1 (kh1-native-map.json з
// генератора шрифту): <userData>/kh1-native-map.json. Кодек читає її замість
// data/kh1_native.json, якщо файл існує (додаткові символи для інших мов).

const { app } = require('electron');
const path = require('path');

function nativeMapPathFor() {
  return path.join(app.getPath('userData'), 'kh1-native-map.json');
}

module.exports = { nativeMapPathFor };
