'use strict';
const f = require('./lib/bbs-font');
const { unpackDir } = require('./lib/user-paths');

const data = f.loadFont(f.discoverFonts(unpackDir()).find(x => x.name === 'mesfont'));

// OpenKh mapping для декоду charID → видимий char
const m81 = " ｡｡,.·:;?!_____^¯_________–-_/\\~-|…‥|||\"\"()__[]{}⟨⟩⟪⟫「」『』__+-±×·÷=≠<>≤≥∞∴♂♀°′″_¥$¢£%#&*@§☆★○●◇◆□■△▲▽▼※〒→←↑↓________________________________________________________________________♪†‡¶________";
const m99 = "ÀÁÂÄÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖŒÙÚÛÜßàáâäæçèéêëìíîïñòóôõöùúûüœ¿¡‚„—°«»≤≥❤¹²³⁴⁵£€§·¢¨'`'©®™‾ₐ";

function ch(id) {
  const lo = id & 0xFF, hi = (id >> 8) & 0xFF;
  if (hi === 0x00 && lo >= 0x20 && lo < 0x7F) return String.fromCharCode(lo);
  if (hi === 0x81 && lo >= 0x40 && lo - 0x40 < m81.length) return m81[lo - 0x40];
  if (hi === 0x99 && lo >= 0x80 && lo - 0x80 < m99.length) return m99[lo - 0x80];
  return null;
}

const have = new Set();
for (const e of data.entries) {
  const c = ch(e.id);
  if (c) have.add(c);
}

// Користувацька мапа Ukrainian → Latin Extended
const map = {
  'А':'À','а':'à','Б':'Á','б':'á','В':'Â','в':'â','Г':'Ã','г':'ã',
  'Ґ':'¥','ґ':'´','Д':'Ä','д':'ä','Е':'Å','е':'å','Є':'ª','є':'º',
  'Ж':'Æ','ж':'æ','З':'Ç','з':'ç','И':'È','и':'è','І':'²','і':'³',
  'Ї':'¯','ї':'¿','Й':'É','й':'é','К':'Ê','к':'ê','Л':'Ë','л':'ë',
  'М':'Ì','м':'ì','Н':'Í','н':'í','О':'Î','о':'î','П':'Ï','п':'ï',
  'Р':'Ð','р':'ð','С':'Ñ','с':'ñ','Т':'Ò','т':'ò','У':'Ó','у':'ó',
  'Ф':'Ô','ф':'ô','Х':'Õ','х':'õ','Ц':'Ö','ц':'ö','Ч':'×','ч':'÷',
  'Ш':'Ø','ш':'ø','Щ':'Ù','щ':'ù','ь':'ü','Ю':'Þ','ю':'þ','Я':'ß','я':'ÿ'
};

const okPairs = [];
const missingPairs = [];
for (const [ua, latin] of Object.entries(map)) {
  if (have.has(latin)) okPairs.push(`${ua}→${latin}`);
  else missingPairs.push(`${ua}→${latin}`);
}

console.log('=== OK (target IS in mesfont COD) ===');
console.log(okPairs.length + ' chars: ' + okPairs.join(' '));
console.log('');
console.log('=== MISSING (target NOT in mesfont COD) ===');
console.log(missingPairs.length + ' chars: ' + missingPairs.join(' '));
console.log('');
console.log('=== ALL chars present in mesfont (для довідки) ===');
console.log([...have].sort().join(''));
