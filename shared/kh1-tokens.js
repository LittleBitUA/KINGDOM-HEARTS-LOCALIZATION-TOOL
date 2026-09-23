'use strict';

// Людські імена керівних токенів KH1 замість сирих `{0x..}`.
//
// Джерело семантики — код гри (Ghidra): рендерер діалогів FUN_140171e80
// (діалект «dialog»: .evdl/.binl/.ev/*_mes_data) і рендерери меню
// FUN_1402cb210 / FUN_1402cd670 / FUN_1402e7060 (діалект «menu»: sysmsg.binl,
// md_*.kmb, SAW*/SASA*/Challenge). Див. docs/formats/kh1-dialog-text.md і
// docs/formats/kh1-menu-text.md.
//
//   nameTokens(text, dialect) — сирі `{0x..}` і старі CamelCase-імена → нові
//                               імена у snake_case (`{wait 90}`, `{item_name}`).
//   rawTokens(text)           — зворотне перетворення у «стару» форму, яку
//                               розуміє кодувальник і якою заключені старі
//                               ключі глосарія. nameTokens ∘ rawTokens = identity
//                               на всьому тексті гри (перевірено тестом).
//
// Імена в обох діалектах РІЗНІ (кодувальник не знає діалекту), напр. байт 0x04
// — це `{page}` у діалогах і `{align_l}` у меню.
//
// UMD: module.exports для Node, window.KH.kh1Tokens для renderer.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KH = root.KH || {}; root.KH.kh1Tokens = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {


// ── старі імена → нові (однобайтові гліфи + двобайтові команди) ──────────────
const RENAMED = {
  // гліфи-іконки шрифту
  '{Potion}': '{icon_potion}', '{Tent}': '{icon_tent}', '{Gem}': '{icon_gem}',
  '{Ability}': '{icon_ability}', '{Key}': '{icon_key}', '{Staff}': '{icon_staff}',
  '{Shield}': '{icon_shield}', '{Ring}': '{icon_ring}', '{Hat}': '{icon_hat}',
  '{Mickey}': '{icon_mickey}',
  '{PSCircle}': '{icon_circle}', '{PSCross}': '{icon_cross}',
  '{PSTriangle}': '{icon_triangle}', '{PSSquare}': '{icon_square}',
  '{iGummi0}': '{icon_gummi_0}', '{iGummi1}': '{icon_gummi_1}', '{iGummi2}': '{icon_gummi_2}',
  '{iGummi3}': '{icon_gummi_3}', '{iGummi4}': '{icon_gummi_4}', '{iGummi5}': '{icon_gummi_5}',
  '{iGummi6}': '{icon_gummi_6}', '{iGummi7}': '{icon_gummi_7}', '{iGummi8}': '{icon_gummi_8}',
  '{iGummi9}': '{icon_gummi_9}',
  '{III}': '{roman_3}', '{VII}': '{roman_7}', '{VIII}': '{roman_8}', '{X}': '{roman_10}',
  // кнопки геймпада (0x09 NN, NN ≥ 200 — залежать від розкладки)
  '{Cross}': '{btn_cross}', '{Circle}': '{btn_circle}', '{Square}': '{btn_square}',
  '{Triangle}': '{btn_triangle}', '{Button}': '{btn_button}', '{Analog}': '{btn_analog}',
  '{DPad}': '{btn_dpad}', '{L1}': '{btn_l1}', '{L2}': '{btn_l2}',
  '{R1}': '{btn_r1}', '{R2}': '{btn_r2}',
  // кольори (0x0C NN)
  '{ColorRed}': '{color_red}', '{ColorViolet}': '{color_violet}',
  '{ColorGreen}': '{color_green}', '{ColorBase}': '{color_base}',
  // змінні (0x0E NN)
  '{VarItem}': '{item_name}', '{VarSpell}': '{spell_name}', '{VarSpellNew}': '{spell_name_new}',
  '{VarValue}': '{number_8}', '{VarNum1}': '{number_1}', '{VarNum2}': '{number_2}',
  '{VarNum3}': '{number_3}'
};
const UNRENAMED = {};
for (const k of Object.keys(RENAMED)) UNRENAMED[RENAMED[k]] = k;

// ── команди з параметрами ───────────────────────────────────────────────────
// kind: 'none' — сам байт; 'u16'/'i16' — 1–2 байти параметра (молодший перший);
// 'u8' — один байт; 'bytes' — усі байти як є; 'rgba' — 4 байти hex.
// fixed — токен без параметра, що відповідає конкретній послідовності байтів.
const DIALOG = {
  0x01: { name: 'space', kind: 'none' },
  0x03: { name: 'pause', kind: 'none' },            // ∞-таймер: чекати гравця
  0x04: { name: 'page', kind: 'none' },             // кінець сторінки
  0x05: { name: 'wait', kind: 'u16' },              // тривалість показу, кадри
  0x06: { name: 'wait2', kind: 'u16' },             // те саме для віконець «Отримано…»
  0x07: { name: 'yshift', kind: 'i16' },            // зсув по Y
  0x08: { name: 'style_1', kind: 'none' },          // режим показу (local_198 = 1)
  0x09: { name: 'icon', kind: 'u8' },               // іконка кнопки за номером
  0x0A: { name: 'text_size', kind: 'none' },        // розмір шрифту / маркер кінця
  0x0B: { name: 'text_x', kind: 'none' },           // позиція X / маркер кінця
  0x0C: { name: 'color', kind: 'u8' },              // колір
  0x0D: { name: 'text_width', kind: 'none' },       // стиснення по ширині
  0x0E: { name: 'var', kind: 'u8' },                // змінна (див. VARS)
  0x10: { name: 'style_5', kind: 'none' },
  0x11: { name: 'style_6', kind: 'none' },
  0x12: { name: 'wait_at', kind: 'u16' }
};
// 0x0E NN — змінні; кожна бере назву з окремої таблиці гри
const VARS = {
  0x00: 'number_cur',      // *(DAT_142e1baf0+0x1c) через %d
  0x02: 'sys_text',        // рядок із системної таблиці (sysmsg) за номером у регістрі
  0x03: 'menu_text',       // рядок із меню-буфера (+0xAD1)
  0x04: 'ability_name',    // таблиця здібностей (записи по 0xC)
  0x05: 'spell_name_cur',
  0x06: 'summon_name',     // «Learned summon spell …»
  0x07: 'text_var_7',
  0x22: 'spell_name_3', 0x23: 'spell_name_4'
};
for (let n = 0x10; n <= 0x17; n++) VARS[n] = 'number_' + (n - 0x0F);   // number_1…number_8
// спец-послідовності діалогу
const DIALOG_FIXED = [
  { name: 'style_2', bytes: [0x0F, 0x00] },
  { name: 'rtl_on', bytes: [0x0F, 0x02] },          // праворуч-ліворуч (DAT_1422e8a40 = 1)
  { name: 'rtl_off', bytes: [0x0F, 0x03] }
];

const MENU = {
  0x01: { name: 'space', kind: 'none' },
  0x03: { name: 'line_h', kind: 'u8' },             // висота рядка + новий рядок
  0x04: { name: 'align_l', kind: 'none' },
  0x05: { name: 'align_c', kind: 'none' },
  0x06: { name: 'align_r', kind: 'none' },
  0x07: { name: 'palette', kind: 'u8' },            // колір із палітри
  0x08: { name: 'rgba', kind: 'rgba' },             // колір RGBA
  0x09: { name: 'num', kind: 'none' },              // вставити число з аргументів
  0x0A: { name: 'sub_msg', kind: 'none' },          // вставити вкладене повідомлення
  0x0B: { name: 'm_icon', kind: 'bytes' },          // іконка/текстура (3 байти)
  0x0C: { name: 'scale', kind: 'u8' },              // масштаб шрифту
  // у діалекті меню довжина команди фіксована (i16 завжди 2 байти параметра)
  0x0D: { name: 'dx', kind: 'i16f' },
  0x0E: { name: 'dy', kind: 'i16f' },
  0x0F: { name: 'sys_str', kind: 'u8' },            // вставити системний рядок
  0x10: { name: 'end2', kind: 'none' },
  0x11: { name: 'abs_x', kind: 'i16f' },
  0x12: { name: 'abs_y', kind: 'i16f' },
  0x13: { name: 'abs_x2', kind: 'i16f' },
  0x14: { name: 'abs_y2', kind: 'i16f' }
};

const RAW_RE = /\{0x([0-9A-Fa-f]{2})((?:,0x[0-9A-Fa-f]{2})*)\}/g;
const NAMED_RE = /\{([a-z][a-z0-9_]*)(?: (-?[0-9a-fA-F,]+))?\}/g;
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const RENAMED_RE = new RegExp(Object.keys(RENAMED).map(escapeRe).join('|'), 'g');
const UNRENAMED_RE = new RegExp(Object.keys(UNRENAMED).map(escapeRe).join('|'), 'g');

function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function rawOf(bytes) { return '{' + bytes.map(b => '0x' + hex2(b)).join(',') + '}'; }
function bytesOf(m1, m2) {
  const out = [parseInt(m1, 16)];
  if (m2) for (const p of m2.split(',')) { if (p) out.push(parseInt(p.replace(/0x/i, ''), 16)); }
  return out;
}

// сирий токен → нове ім'я (або null, якщо форма не збігається з очікуваною)
function nameOfRaw(bytes, dialect) {
  const table = dialect === 'menu' ? MENU : DIALOG;
  const b0 = bytes[0];
  if (dialect !== 'menu') {
    for (const f of DIALOG_FIXED) {
      if (f.bytes.length === bytes.length && f.bytes.every((x, i) => x === bytes[i])) return '{' + f.name + '}';
    }
    if (b0 === 0x0E && bytes.length === 2 && VARS[bytes[1]]) return '{' + VARS[bytes[1]] + '}';
  }
  const d = table[b0];
  if (!d) return null;
  const rest = bytes.length - 1;
  if (d.kind === 'none') return rest === 0 ? '{' + d.name + '}' : null;
  if (d.kind === 'u8') return rest === 1 ? '{' + d.name + ' ' + bytes[1] + '}' : null;
  if (d.kind === 'rgba') return rest === 4 ? '{' + d.name + ' ' + bytes.slice(1).map(hex2).join('') + '}' : null;
  if (d.kind === 'bytes') return rest >= 1 ? '{' + d.name + ' ' + bytes.slice(1).map(hex2).join(',') + '}' : null;
  if (d.kind === 'i16f') {
    if (rest !== 2) return null;
    let v = bytes[1] | (bytes[2] << 8);
    if (v > 0x7FFF) v -= 0x10000;
    return '{' + d.name + ' ' + v + '}';
  }
  if (d.kind === 'u16' || d.kind === 'i16') {
    // Декодувальник пакує третій байт у токен, лише коли він ≠ 0, тож
    // «двобайтова» форма завжди означає 0 < v ≤ 255 — маркер не потрібен.
    if (rest !== 1 && rest !== 2) return null;
    let v = bytes[1] | ((rest === 2 ? bytes[2] : 0) << 8);
    if (d.kind === 'i16' && v > 0x7FFF) v -= 0x10000;
    if (rest === 1 ? !(v >= 0 && v <= 255) : !(v < 0 || v > 255)) return null;
    return '{' + d.name + ' ' + v + '}';
  }
  return null;
}

// нове ім'я + аргумент → байти (null, якщо ім'я не наше)
function rawOfName(name, arg) {
  for (const f of DIALOG_FIXED) if (f.name === name) return f.bytes;
  for (const [n, vn] of Object.entries(VARS)) if (vn === name) return [0x0E, Number(n)];
  for (const [dialect, table] of [['dialog', DIALOG], ['menu', MENU]]) {
    void dialect;
    for (const [b, d] of Object.entries(table)) {
      if (d.name !== name) continue;
      const b0 = Number(b);
      if (d.kind === 'none') return arg === undefined ? [b0] : null;
      if (arg === undefined) return null;
      if (d.kind === 'u8') return [b0, Number(arg) & 0xFF];
      if (d.kind === 'rgba') {
        if (!/^[0-9A-Fa-f]{8}$/.test(arg)) return null;
        return [b0, parseInt(arg.slice(0, 2), 16), parseInt(arg.slice(2, 4), 16), parseInt(arg.slice(4, 6), 16), parseInt(arg.slice(6, 8), 16)];
      }
      if (d.kind === 'bytes') return [b0].concat(arg.split(',').map(x => parseInt(x, 16) & 0xFF));
      if (d.kind === 'i16f') {
        const v = Number(arg);
        if (!Number.isFinite(v) || !/^-?\d+$/.test(String(arg))) return null;
        const u = v < 0 ? v + 0x10000 : v;
        return [b0, u & 0xFF, (u >> 8) & 0xFF];
      }
      if (d.kind === 'u16' || d.kind === 'i16') {
        const v = Number(arg);
        if (!Number.isFinite(v) || !/^-?\d+$/.test(String(arg))) return null;
        const wide = v < 0 || v > 255;
        const u = v < 0 ? v + 0x10000 : v;
        return wide ? [b0, u & 0xFF, (u >> 8) & 0xFF] : [b0, u & 0xFF];
      }
    }
  }
  return null;
}

// nameTokens(text, dialect) — сирі токени і старі імена → нові імена
function nameTokens(text, dialect) {
  let s = String(text == null ? '' : text);
  if (s.indexOf('{') < 0) return s;
  s = s.replace(RAW_RE, (m, b1, rest) => {
    const named = nameOfRaw(bytesOf(b1, rest), dialect);
    return named === null ? m : named;
  });
  if (/[A-Z]/.test(s)) s = s.replace(RENAMED_RE, (m) => RENAMED[m] || m);
  // `{0x0F}` + літера — це не текст, а ідентифікатор кнопки (0F 'X')
  if (dialect !== 'menu') s = s.replace(/\{0x0F\}([A-Za-z0-9])/g, '{button $1}');
  return s;
}

// rawTokens(text) — нові імена назад у «стару» форму (сирі токени / старі імена)
function rawTokens(text) {
  let s = String(text == null ? '' : text);
  if (s.indexOf('{') < 0) return s;
  s = s.replace(/\{button ([A-Za-z0-9])\}/g, '{0x0F}$1');
  s = s.replace(UNRENAMED_RE, (m) => UNRENAMED[m] || m);
  s = s.replace(NAMED_RE, (m, name, arg) => {
    const bytes = rawOfName(name, arg);
    return bytes === null ? m : rawOf(bytes);
  });
  return s;
}

return { nameTokens, rawTokens, RENAMED, DIALOG, MENU, VARS, DIALOG_FIXED };
}));
