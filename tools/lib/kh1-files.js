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
  // kh1_third: original/exchange/UK_*.bin|BIN (магазини, SAWDMSG…), UK/psel.bin, *.nam (назви локацій)
  if (/^original\/exchange\/UK_[^/]+\.(bin|nam)$/i.test(rel)) return !KH1_UI_LAYOUT.test(base);
  if (/^original\/exchange\/UK\/[^/]+\.bin$/i.test(rel)) return true;
  if (/^original\/exchange\/US_allarea\.nam$/i.test(rel)) return true;
  // kh1_third: gummi-повідомлення, словник/гімн/Jiminy у md_*.kmb
  if (/^remastered\/gumi\/[^/]+\/UK_[^/]+\.bin$/i.test(rel)) return true;
  if (/^remastered\/menu\/md_[^/]+\.kmb\/UK_[^/]+\.kmb$/i.test(rel)) return true;
  // kh1_fourth: worldmap/challenge (ChallengeMsg.bin + ChallengeOfs.binl)
  if (/^remastered\/worldmap\/[^/]+\/UK_[^/]+\.(bin|binl)$/i.test(rel)) return true;
  return false;
}

module.exports = { isKh1TextFile, KH1_UI_LAYOUT };
