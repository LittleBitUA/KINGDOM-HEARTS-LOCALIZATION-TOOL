'use strict';

// Жорсткі межі гри для ОДНІЄЇ сторінки повідомлення KH1 (з коду:
// FUN_140172de0/FUN_140170960 виділяють буфер розкладки `FUN_140289080(0x1f18)`,
// а FUN_140171e80 пише в нього БЕЗ перевірки меж):
//
//   0x1F18 байт = 3980 u16:
//     • гліфи        — запис 0x14 байт на гліф, від зсуву 0x14 до 0x1E14
//       → максимум 384 гліфи на сторінку;
//     • паузи/таймери — float-и 0x1E14…0x1E94 → максимум 32;
//     • рядки        — лічильник u16 @0x1E94, ширини рядків (u32) @0x1E98…0x1F18
//       → максимум 32 рядки (і саме звідси гра бере ширину/висоту хмаринки).
//
// Сторінка — це шматок повідомлення до `{page}` (0x04) або до кінця (0x00):
// команда 0x04 завершує розкладку, далі гра рахує наступну сторінку з нуля.
//
// Що рахується гліфом (FUN_140171e80): звичайний символ (байт ≥ 0x20), пробіл
// (0x01), двобайтовий гліф (0x18/0x19..0x1F + NN, тобто наша кирилиця), іконка
// кнопки (0x09 NN). Підстановки (0x0E NN — назва предмета/магії) розгортаються у
// рядок під час гри: їхню довжину рахуємо як 12 гліфів «на око».
//
// UMD: module.exports для Node, window.KH.kh1Limits для renderer.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KH = root.KH || {}; root.KH.kh1Limits = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

const LAYOUT_BUFFER = 0x1F18;
const MAX_GLYPHS = 384;
const MAX_LINES = 32;
const MAX_PAUSES = 32;
const VAR_GLYPHS = 12;          // груба оцінка довжини підстановки

// pageStats(bytes) → [{ glyphs, lines, pauses }] — по одному запису на сторінку.
// bytes — закодований рядок (діалект діалогів).
function pageStats(bytes) {
  const pages = [];
  let g = 0, lines = 1, pauses = 0;
  const push = () => { pages.push({ glyphs: g, lines, pauses }); g = 0; lines = 1; pauses = 0; };
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b === 0x00) { push(); i++; continue; }              // кінець повідомлення
    if (b === 0x04) { push(); i++; continue; }              // кінець сторінки
    if (b === 0x01) { g++; i++; continue; }                 // пробіл
    if (b === 0x02) { lines++; i++; continue; }             // новий рядок
    if (b === 0x03) { pauses++; i++; continue; }            // пауза «натисни»
    if (b === 0x05 || b === 0x06 || b === 0x07 || b === 0x12) { pauses++; i += 3; continue; }
    if (b === 0x09) { g++; i += 2; continue; }              // іконка кнопки
    if (b === 0x0A || b === 0x0B || b === 0x0D) {
      const n = bytes[i + 1];
      i += (b === 0x0A ? (n === 0 ? 4 : 2) : (n === 0x00 || n === 0x01 || (b === 0x0B && n === 0x10) ? 4 : 2));
      continue;
    }
    if (b === 0x0C || b === 0x0F) { i += 2; continue; }      // колір / режим
    if (b === 0x0E) { g += VAR_GLYPHS; i += 2; continue; }   // підстановка
    if (b === 0x08 || b === 0x10 || b === 0x11) { i++; continue; }
    if (b >= 0x18 && b <= 0x1F) { g++; i += 2; continue; }   // двобайтовий гліф (кирилиця)
    if (b >= 0x20) { g++; i++; continue; }
    i++;
  }
  if (g || lines > 1 || pauses) push();
  return pages;
}

// overflowIssue(bytes) → текст помилки або null.
function overflowIssue(bytes) {
  const pages = pageStats(bytes);
  for (let n = 0; n < pages.length; n++) {
    const p = pages[n];
    const where = pages.length > 1 ? ' (сторінка ' + (n + 1) + ')' : '';
    if (p.glyphs > MAX_GLYPHS) return 'задовга сторінка' + where + ': ' + p.glyphs + ' гліфів, гра вміщає ' + MAX_GLYPHS + ' — розбий на дві сторінки ({page})';
    if (p.lines > MAX_LINES) return 'забагато рядків' + where + ': ' + p.lines + ', гра вміщає ' + MAX_LINES;
    if (p.pauses > MAX_PAUSES) return 'забагато пауз/таймерів' + where + ': ' + p.pauses + ', гра вміщає ' + MAX_PAUSES;
  }
  return null;
}

return { LAYOUT_BUFFER, MAX_GLYPHS, MAX_LINES, MAX_PAUSES, pageStats, overflowIssue };
}));
