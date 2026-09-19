'use strict';

// Чи схожий декодований KH1-рядок на справжній текст, а не на шматок байткоду.
// Без RUS-оракула екстрактори бачать усі 0x00-сегменти, і серед них — параметри
// команд, які декодуються як `{0x19}`, `H`, `Bö ìoèy` (байти 0xC8+ = акцентована
// латиниця в базовій таблиці). Правила:
//   • сирі токени `{0x..}`/`{eol}`/`{lf}` не рахуються (літера «x» у `{0x19}` — не текст),
//     а іменовані ({ColorGreen}, {VarItem}, {Key}…) — підстановки у справжньому тексті
//     («{ColorGreen}{Potion}{VarItem}s{ColorBase}.»), вони роблять рядок перекладним;
//   • інакше потрібні ≥2 літери поспіль (ASCII або кирилиця);
//   • акцентована латиниця (À–ÿ) у англійських файлах — ознака байткоду:
//     відкидаємо, якщо її не менше, ніж половина ASCII-літер.
const RE_TOKENS = /\{[^{}\n]*\}/g;
const RE_NAMED_TOKEN = /\{(?!0x)(?!eol\})(?!lf\})[A-Za-z][^{}\n]*\}/;
const RE_RUN = /[A-Za-z]{2}|[А-Яа-яЁёЇїІіЄєҐґ]{2}/;
const RE_ASCII = /[A-Za-z]/g;
const RE_CYR = /[А-Яа-яЁёЇїІіЄєҐґ]/g;
const RE_ACCENT = /[À-ÖØ-öø-ÿŒœ]/g;

function looksLikeText(decoded) {
  if (!decoded) return false;
  const t = decoded.replace(RE_TOKENS, ' ');
  if (!RE_RUN.test(t) && !RE_NAMED_TOKEN.test(decoded)) return false;
  const ascii = (t.match(RE_ASCII) || []).length;
  const cyr = (t.match(RE_CYR) || []).length;
  const accent = (t.match(RE_ACCENT) || []).length;
  if (accent > 0 && accent * 2 >= ascii + cyr) return false;
  return true;
}

module.exports = { looksLikeText };
