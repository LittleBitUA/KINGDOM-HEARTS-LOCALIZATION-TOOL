'use strict';

// Які файли з розпакованих архівів KH1 (kh1_first…kh1_fifth) є текстом для
// перекладу. Шлях — відносно <archive>.hed_out, '/'-розділювачі.

const KH1_UI_LAYOUT = /^UK_(uibin_|mg_|get_|com_battle|danger)/i;
function isKh1TextFile(rel) {
  const base = rel.split('/').pop();
  if (/\.(png|dds|scd|vset|mdls|tim2|imd|tm2|dpx)$/i.test(base)) return false;
  if (/^remastered\/[^/]+\.ard\/[^/]+$/i.test(rel)) {
    if (/^UK_[^/]+\.(binl|evdl|ev)$/i.test(base)) return true;
    return /\.ev$/i.test(base) && !/^[A-Z]{2}_/.test(base);   // di01a.ev — без мовного префікса
  }
  if (/^remastered\/btltbl\.bin\/UK_[^/]+\.bin$/i.test(rel)) return true;
  if (/^remastered\/menu\/uk\/sysmsg\.bin\/UK_sysmsg\.binl$/i.test(rel)) return true;
  // kh1_third: original/exchange/UK_*.bin|BIN (магазини, кубки, SAW*MSG + таблиці зсувів)
  if (/^original\/exchange\/UK_[^/]+\.bin$/i.test(rel)) return !KH1_UI_LAYOUT.test(base);
  // kh1_first: original/exchange/UK_treasure.ev — скрині/далматинці/«Отримано …»
  if (/^original\/exchange\/UK_[^/]+\.ev$/i.test(rel)) return true;
  // НЕ текст: exchange/UK/psel.bin (графіка), *_allarea.nam — назви кімнат у
  // fullwidth Shift-JIS для шрифту меню (окрема задача разом із sysmsg).
  // kh1_third: gummi-повідомлення, словник/гімн/Jiminy/синопсис (md_*.kmb), memo sysmsg
  if (/^remastered\/gumi\/[^/]+\/UK_[^/]+\.bin$/i.test(rel)) return true;
  if (/^remastered\/menu\/md_[^/]+\.kmb\/UK_[^/]+\.kmb$/i.test(rel)) return true;
  if (/^remastered\/menu\/md_memo_sysmsg\.bin\/UK_[^/]+\.binl$/i.test(rel)) return true;
  // kh1_fourth: worldmap/challenge (ChallengeMsg.bin + ChallengeOfs.binl)
  if (/^remastered\/worldmap\/[^/]+\/UK_[^/]+\.(bin|binl)$/i.test(rel)) return true;
  return false;
}

// ---- Слоти, які насправді не текст ----
//
// Частина файлів KH1 містить двійкові дані там, де розбирач шукає текст
// (найгірший приклад — `kh1_first/di03.ard/di03a.ev`: усі 188 слотів сміття,
// схоже на розкладку деталей ґаммі-корабля). Декодер чесно перетворює байти
// на символи, а двобайтові пари — на імена токенів, тож у глосарій сипалися
// сотні записів на кшталт `îЕiвáґ{0xA8}{icon_gummi_0}{roman_3}▼®`.
//
// Ознака: є сирий токен `{0xNN}` (декодер не знайшов байту імені) І немає
// жодного справжнього слова. Справжнім словом вважаємо:
//   * латиницю з 4+ літер;
//   * АБО суцільно велику латиницю з 2+ літер — це короткі написи інтерфейсу
//     `HP`, `MP`, `AP`, `STR`, `DEF`, які інакше відсіклися б разом із
//     перекладом (ОЗ, ОМ, ОВ, СИЛ., ЗАХ.);
//   * АБО кирилицю з 4+ літер, де велика може бути ЛИШЕ перша — у сміттєвих
//     рядках великі стоять усередині («ґЗТЙ», «еЙО», «РїЙМЖ»).
//
// Умова про слово обов'язкова: інакше відсіклися б `{0xC2}Phil Cup{0xC3}`,
// `{rgba …}Strength…` і щоденникові статті DUMBO/MUSHU/SIMBA — там сирі байти
// сусідять зі справжнім текстом. Правило свідомо поблажливе: із 895 рядків із
// сирими байтами воно лишає 22, з яких 7 усе-таки сміття (містять «PS» або
// «SRVW»). Краще кілька зайвих записів, ніж загублений переклад.
const RAW_BYTE = /\{0x[0-9A-Fa-f]{2}/;
const LATIN_WORD = /[A-Za-z]{4,}/;
const LATIN_CAPS = /\b[A-Z]{2,}\b/;
const CYR_LOWER = 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя';
const CYR_WORD = new RegExp('[' + CYR_LOWER + CYR_LOWER.toUpperCase() + ']{4,}', 'g');

function hasRealWord(text) {
  const bare = String(text).replace(/\{[^}]*\}/g, ' ');
  if (LATIN_WORD.test(bare) || LATIN_CAPS.test(bare)) return true;
  CYR_WORD.lastIndex = 0;
  let m;
  while ((m = CYR_WORD.exec(bare)) !== null) {
    const w = m[0];
    let ok = true;
    for (let i = 1; i < w.length; i++) if (CYR_LOWER.indexOf(w[i]) < 0) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// isBinaryJunk(text) → true, якщо цей «рядок» не варто показувати перекладачеві.
function isBinaryJunk(text) {
  if (!text) return false;
  return RAW_BYTE.test(text) && !hasRealWord(text);
}

// Формати KH1, до яких правило застосовне. BBS/Re:CoM/DDD мають свої кодеки,
// де `{0x..}` — нормальна частина розмітки, тож їх не чіпаємо.
const KH1_KINDS = new Set(['ev', 'binl', 'binl-v361', 'rawbin', 'mesofs', 'kmb']);

module.exports = { isKh1TextFile, KH1_UI_LAYOUT, isBinaryJunk, hasRealWord, KH1_KINDS };
