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

module.exports = { isKh1TextFile, KH1_UI_LAYOUT };
