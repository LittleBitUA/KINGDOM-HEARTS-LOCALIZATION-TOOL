'use strict';

// Re:CoM @CTD — макети («хмаринки») по 0x30 байтів. Макет покриває `count`
// (u16 @0x14) послідовних повідомлень починаючи з `msgId` (u16 @0x10, дорівнює
// сумі count попередніх макетів — так їх обходить CCtd у грі, FUN_140240850):
// кілька сторінок однієї хмаринки. У меню (FORM) макетів менше, ніж рядків.
//
//   0x00 u8   0
//   0x01 u8   порядковий номер макета
//   0x02 u16  прапорці (0x0408 / 0x0410 …)
//   0x04 RGBA заливка, 0x08 RGBA рамка, 0x0C RGBA тінь/друга рамка
//   0x10 u16  id першого повідомлення (у грі сюди пишеться вказівник на таблицю зсувів)
//   0x14 u16  кількість повідомлень (сторінок) цього макета
//   0x16 u16  X   0x18 u16 Y   0x1A u16 W   0x1C u16 H   (екран 512×416, px PS2)
//   0x1E u16  стиль: молодший байт — вирівнювання (0 = X/Y з макета, 1 = X=32,
//             2 = по центру екрана, 3 = X=480−W), старший — тип вікна (3 = підказка)
//   0x20 u8   відступ, u8 ?;  0x22 u16 висота рядка (22 evtfont / 18 sysfont)
//   0x2C u16  вид хвостика, 0x2E i16 зсув хвостика
//
// Ширина тексту в одиницях .binl (1 од. = 2 px HD-атласу) → px PS2: × UNIT_PX.
// Мінімальний запас, що трапляється в оригінальних макетах, — MIN_PAD.
//
// Гра (CTextWnd::open, FUN_1402b1520 у Re_Chain of Memories.exe): id репліки =
// tag<<16 | макет<<8 | сторінка; W/H беруться з макета як є (округлені до
// парних), позиція — з макета, якщо сцена не задала свою; під текст ніщо не
// підганяється. Тому ширший переклад треба супроводити ширшим макетом.

const LAYOUT_SIZE = 0x30;
const OFF = { ordinal: 0x01, flags: 0x02, msgId: 0x10, count: 0x14, x: 0x16, y: 0x18, w: 0x1A, h: 0x1C, style: 0x1E, pad: 0x20, lineHeight: 0x22, tail: 0x2C, tailOff: 0x2E };
const SCREEN_W = 512;
const SCREEN_H = 416;
// Одиниця ширини .binl → px PS2. Підібрано за скриншотами (sysfont і evtfont
// дають 0,70–0,71) і за 19 903 англійськими макетами: при 0,7 і пробілі
// 0,35·line найтісніший оригінал має запас ≈ 10 px, при 2/3 чи 0,75 частина
// оригіналів «не влазила б» у власні хмаринки.
const UNIT_PX = 0.7;
// Пробіл: гра НЕ бере ширину гліфа 0 (18–20 од. — ширший за «m»), крок ≈ 0,35·line.
const SPACE_RATIO = 0.35;
const spaceAdvance = (font) => Math.round(((font && font.line) || 26) * SPACE_RATIO);
const MIN_PAD = 12;          // найменший запас W − текст в оригіналі ≈ 10–12 px
const MIN_VPAD = 8;          // H − рядки×lineHeight у типових макетах: 8 (1–2 рядки), 10 (3)

function readLayout(buf) {
  if (!buf || buf.length < LAYOUT_SIZE) throw new Error('layout: short record');
  return {
    ordinal: buf[OFF.ordinal],
    flags: buf.readUInt16LE(OFF.flags),
    colors: [buf.readUInt32LE(0x04), buf.readUInt32LE(0x08), buf.readUInt32LE(0x0C)],
    msgId: buf.readUInt16LE(OFF.msgId),
    count: buf.readUInt16LE(OFF.count),
    x: buf.readUInt16LE(OFF.x), y: buf.readUInt16LE(OFF.y), w: buf.readUInt16LE(OFF.w), h: buf.readUInt16LE(OFF.h),
    style: buf.readUInt16LE(OFF.style),
    pad: buf[OFF.pad],
    lineHeight: buf.readUInt16LE(OFF.lineHeight),
    tail: buf.readUInt16LE(OFF.tail),
    tailOff: buf.readInt16LE(OFF.tailOff)
  };
}

const clampU16 = (v) => Math.max(0, Math.min(0xFFFF, Math.round(Number(v) || 0)));

// writeLayout(buf, fields) — лише геометрія (x, y, w, h) і зсув хвостика;
// решту (кольори, стиль, id) не чіпаємо.
function writeLayout(buf, f) {
  if (!f) return buf;
  if (f.x != null) buf.writeUInt16LE(clampU16(f.x), OFF.x);
  if (f.y != null) buf.writeUInt16LE(clampU16(f.y), OFF.y);
  if (f.w != null) buf.writeUInt16LE(clampU16(f.w), OFF.w);
  if (f.h != null) buf.writeUInt16LE(clampU16(f.h), OFF.h);
  if (f.tailOff != null) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(Number(f.tailOff) || 0))), OFF.tailOff);
  return buf;
}

// applyLayoutOverrides(parsed, overrides) — overrides: { [msgId]: {x,y,w,h,tailOff?} }
// (ключі — id повідомлення). Повертає кількість змінених макетів.
function applyLayoutOverrides(parsed, overrides) {
  if (!parsed || !overrides) return 0;
  let n = 0;
  for (const l of parsed.layouts) {
    const id = l.readUInt16LE(OFF.msgId);
    const o = overrides[id] != null ? overrides[id] : overrides[String(id)];
    if (!o) continue;
    writeLayout(l, o);
    n++;
  }
  return n;
}

// Ширина рядків повідомлення в одиницях .binl. font = { count, widths, map, line }
// (parseHeader з ipc-comkern); ключ таблиці: ASCII → code−0x20, двобайтові →
// (lead−0x81)·192 + lo + 32 (0x82xx → 224+lo); {icon}/{color} — 2 байти
// (іконка ≈ ширина комірки).
function lineWidths(bytes, font, iconWidth) {
  const lines = [];
  let w = 0, i = 0;
  const iw = iconWidth == null ? 26 : iconWidth;
  const sp = spaceAdvance(font);
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c === 0x0A) { lines.push(w); w = 0; continue; }
    if (c === 0xF5) { i++; w += iw; continue; }
    if (c === 0xF9) { i++; continue; }
    if (c === 0x20) { w += sp; continue; }
    let code = c;
    if (c >= 0x81 && c <= 0x9F && i < bytes.length) {
      const t = bytes[i];
      if (t >= 0x40 && t <= 0xFC && t !== 0x7F) { code = (c << 8) | t; i++; }
    }
    let g = null;
    if (code >= 0x20 && code < 0x80) g = font.map[code - 0x20];
    else if (code > 0xFF) { const k = ((code >> 8) - 0x81) * 192 + (code & 0xFF) + 32; g = k < font.map.length ? font.map[k] : null; }
    if (g != null && g >= 0 && g < font.count) w += font.widths[g];
  }
  lines.push(w);
  return lines;
}

// Макет-заглушка: якщо англійський текст сам не влазить у X/Y/W/H (у FORM/SYS
// усі макети файла однакові 40,40,250×50), розмір вікна задає код гри — такі
// пропускаємо.
function layoutUsable(layout, enWidths) {
  const enMax = Math.max(0, ...enWidths) * UNIT_PX;
  const lh = layout.lineHeight || 22;
  if (enMax > layout.w - 2) return false;
  if (enWidths.length * lh > layout.h + 12) return false;
  return true;
}

// suggestGeometry(layout, enWidths, ukWidths, ukLines) → { w, h, x, y }
//   зберігаємо запас оригіналу (W − текст EN), але не менше MIN_PAD; центр
//   хмаринки лишаємо на місці; не виходимо за екран.
// X, який реально використає гра (CTextWnd, FUN_1402b1f70) для стилю макета.
function effectiveX(style, x, w) {
  const align = style & 0xFF;
  if (align === 1) return 32;
  if (align === 2) return 256 - (w >> 1);
  if (align === 3) return 480 - w;
  return x;
}

function suggestGeometry(layout, enWidths, ukWidths) {
  const enMax = Math.max(0, ...enWidths) * UNIT_PX;
  const ukMax = Math.max(0, ...ukWidths) * UNIT_PX;
  const padW = Math.max(MIN_PAD, layout.w - enMax);
  const lh = layout.lineHeight || 22;
  const padH = Math.max(MIN_VPAD, layout.h - enWidths.length * lh);
  let w = Math.ceil(ukMax + padW);
  let h = Math.ceil(ukWidths.length * lh + padH);
  if (w < layout.w && ukMax <= enMax) w = layout.w;        // коротший текст — хмаринку не звужуємо
  if (h < layout.h) h = layout.h;
  w = Math.min(w, SCREEN_W - 2 * 8);
  if (w & 1) w++;                                          // CTextWnd округлює W/H до парних (W + (W & 1))
  if (h & 1) h++;
  let x = layout.x;
  if (((layout.style || 0) & 0xFF) === 0) {                  // вільна позиція: центр лишаємо, в екран вписуємо
    x = Math.round(layout.x + (layout.w - w) / 2);
    x = Math.max(8, Math.min(SCREEN_W - 8 - w, x));
  }
  let y = layout.y;
  if (y + h > SCREEN_H - 4) y = Math.max(4, SCREEN_H - 4 - h);
  return { w, h, x, y };
}

module.exports = { LAYOUT_SIZE, OFF, SCREEN_W, SCREEN_H, UNIT_PX, SPACE_RATIO, MIN_PAD, MIN_VPAD, readLayout, writeLayout, applyLayoutOverrides, lineWidths, suggestGeometry, effectiveX, layoutUsable, spaceAdvance };
