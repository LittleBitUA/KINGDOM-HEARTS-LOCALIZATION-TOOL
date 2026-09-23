'use strict';

// Межі повідомлень і сторінок у діалоговому байткоді KH1.
//
// Історія: раніше текст різався просто по кожному байту 0x00. Але 0x00 — це
// ще й ЗВИЧАЙНИЙ байт параметра команд (`05 54 00` = {wait 84}, `0B 00 04 00`
// = зсув X, `0A 00 00 00` = міжрядковий інтервал). Через це одне повідомлення
// розпадалося в середньому на 7 «рядків», у кінці кожного теліпався недогризений
// токен (`…{lf}{text_x}`), а речення інколи рвалося навпіл.
//
// Довжини команд — із рендерера діалогів гри FUN_140171e80 (Ghidra),
// див. docs/formats/kh1-dialog-text.md.
//
// UMD: module.exports для Node, window.KH.kh1Message для renderer.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KH = root.KH || {}; root.KH.kh1Message = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

const MSG_END = 0x00;     // кінець повідомлення
const PAGE_END = 0x04;    // кінець сторінки (розкладка повертається, чекаємо гравця)

// Довжина команди в байтах (включно із самим байтом команди).
// b1 — наступний байт (0, якщо його нема): від нього залежать «широкі» форми
// 0x0A/0x0B/0x0D.
function cmdLen(b, b1) {
  if (b >= 0x20) return 1;                                   // гліф
  if (b <= 0x04) return 1;                                   // 00 кінець, 01 пробіл, 02 lf, 03 пауза, 04 сторінка
  if (b === 0x05 || b === 0x06 || b === 0x07 || b === 0x12) return 3;   // u16/i16-параметр
  if (b === 0x08 || b === 0x10 || b === 0x11) return 1;      // прапорці стилю
  if (b === 0x09 || b === 0x0C || b === 0x0E || b === 0x0F) return 2;   // іконка / колір / змінна / кнопка
  if (b === 0x0A) return b1 === 0x00 ? 4 : 2;                // міжрядковий інтервал
  if (b === 0x0B) return (b1 === 0x00 || b1 === 0x01 || b1 === 0x10) ? 4 : 2;   // позиція X
  if (b === 0x0D) return (b1 === 0x00 || b1 === 0x01) ? 4 : 2;                  // ширина/швидкість
  if (b >= 0x13 && b <= 0x17) return 1;                      // не в switch гри → default (+1)
  return 2;                                                  // 0x18…0x1F — двобайтовий гліф
}

// splitSlots(buf, from, to) → [{ start, end, term }]
//   start..end — байти слота БЕЗ термінатора; term — байт-роздільник
//   (0x00 кінець повідомлення, 0x04 кінець сторінки) або -1, якщо його нема.
// Один слот = одна СТОРІНКА: саме її гра вимірює й малює в одному вікні,
// і саме на неї діють межі 384 гліфи / 32 рядки.
function splitSlots(buf, from, to) {
  const out = [];
  const end = Math.min(to, buf.length);
  let i = Math.max(0, from);
  let start = i;
  while (i < end) {
    const b = buf[i];
    if (b === MSG_END || b === PAGE_END) {
      out.push({ start, end: i, term: b });
      i++;
      start = i;
      continue;
    }
    const n = cmdLen(b, i + 1 < end ? buf[i + 1] : 0);
    i += n > 0 ? n : 1;
  }
  if (start < end) out.push({ start, end, term: -1 });
  return out;
}

// Чи розбір «сходиться»: жодна команда не вилазить за межі діапазону.
// Використовується як запобіжник для файлів, які лише схожі на діалоговий
// байткод (евристичний rawbin): якщо не сходиться — лишаємо старий розбір.
function walkFits(buf, from, to) {
  const end = Math.min(to, buf.length);
  let i = Math.max(0, from);
  while (i < end) {
    const b = buf[i];
    if (b === MSG_END || b === PAGE_END) { i++; continue; }
    const n = cmdLen(b, i + 1 < end ? buf[i + 1] : 0);
    if (i + n > end) return false;
    i += n;
  }
  return i === end;
}

return { cmdLen, splitSlots, walkFits, MSG_END, PAGE_END };
}));
