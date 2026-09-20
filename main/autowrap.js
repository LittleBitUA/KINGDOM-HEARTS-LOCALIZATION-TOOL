'use strict';

// Auto-wrap за метриками .knj: measureMany / autoWrap / autoWrapAdaptive.

const { ipcMain } = require('electron');
const codec = require('../shared/codec');

// =====================================================================
// Auto-wrap by font metrics — використовує .knj kerning info, щоб
// автоматично вставити {lf} між словами де UK-переклад не вміщується
// в задану максимальну ширину (~440 px типово).
// =====================================================================
const WRAP_KERNING_OFFSET = 0x40080;
const WRAP_SPACE_PX = 10;
const WRAP_MAX_GLYPHS = 336;

// Ширина за гліфами: нативна кирилиця — 2 байти `19 NN` (гліф 224+NN), решта —
// 1 байт (гліф b−32); токени `{…}` (команди, іконки) не рахуємо. Та сама формула,
// що в renderer/translate/width.js для бейджів у глосарії.
const glyphWidthCache = new Map();
function glyphIdxOf(ch) {
  if (glyphWidthCache.has(ch)) return glyphWidthCache.get(ch);
  let idx = -1;
  try {
    const b = codec.encode(ch);
    if (b.length === 2 && b[0] >= 0x19 && b[0] <= 0x1F) idx = (b[0] - 0x19) * 256 + b[1] + 224;
    else if (b.length === 1) idx = b[0] - 32;
  } catch (_) { idx = -1; }
  glyphWidthCache.set(ch, idx);
  return idx;
}
function measureTextWithKnj(text, knj) {
  let w = 0;
  const s = String(text || '');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') { const close = s.indexOf('}', i); if (close > i) { i = close + 1; continue; } }
    i++;
    if (ch === ' ') { w += WRAP_SPACE_PX; continue; }
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const idx = glyphIdxOf(ch);
    if (idx < 0 || idx >= WRAP_MAX_GLYPHS) continue;
    w += (knj[WRAP_KERNING_OFFSET + idx] || 0) * 2;
  }
  return w;
}
function measureBytesWithKnj(bytes, knj) { return measureTextWithKnj(codec.decode(Buffer.from(bytes)), knj); }


function autoWrapText(text, maxWidth, knj) {
  if (!text || !knj) return text;
  // Зберігаємо існуючі {lf} як hard breaks
  const lines = text.split('{lf}');
  const out = [];
  const spaceW = measureTextWithKnj(' ', knj);
  for (const line of lines) {
    // Розбиваємо на токени по пробілах, але зберігаємо {tokens}
    const words = line.split(/\s+/).filter(w => w.length > 0);
    if (!words.length) { out.push(line); continue; }
    let currLine = words[0];
    let currWidth = measureTextWithKnj(currLine, knj);
    const wrapped = [];
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      const wWidth = measureTextWithKnj(w, knj);
      const need = currWidth + spaceW + wWidth;
      if (need > maxWidth && currLine.length > 0) {
        wrapped.push(currLine);
        currLine = w;
        currWidth = wWidth;
      } else {
        currLine += ' ' + w;
        currWidth = need;
      }
    }
    wrapped.push(currLine);
    out.push(wrapped.join('{lf}'));
  }
  return out.join('{lf}');
}

ipcMain.handle('translate:measureMany', async (_e, payload) => {
  const texts = (payload && payload.texts) || [];
  const knjData = payload && payload.knjData;
  if (!knjData) return { error: 'no knj' };
  try {
    const knj = new Uint8Array(knjData);
    const widths = texts.map(t => {
      // Для багаторядкового тексту вертаємо max ширину рядка
      if (!t) return 0;
      const lines = String(t).split('{lf}');
      let mx = 0;
      for (const ln of lines) {
        const w = measureTextWithKnj(ln, knj);
        if (w > mx) mx = w;
      }
      return mx;
    });
    return { ok: true, widths };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('translate:autoWrap', async (_e, payload) => {
  const texts = (payload && payload.texts) || [];
  const knjData = payload && payload.knjData;
  const maxWidth = (payload && payload.maxWidth) || 440;
  if (!knjData) return { error: 'no knj' };
  try {
    const knj = new Uint8Array(knjData);
    const wrapped = texts.map(t => {
      try { return autoWrapText(String(t || ''), maxWidth, knj); }
      catch (_) { return t; }
    });
    return { ok: true, wrapped };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

// =====================================================================
// Adaptive auto-wrap — копіюємо структуру EN 1:1.
//   1) Розкладаємо EN та UK на (prefix, body, suffix), де prefix/suffix —
//      провідні/завершальні фігурні токени (керівні байти + {lf}), а body
//      — все, що містить видимий текст.
//   2) Префікс і суфікс беремо ВЛАСНЕ з EN (бо це формат гри/контролер
//      курсорів-діалогу — не переклад).
//   3) UK body «розгортаємо»: прибираємо існуючі {lf}, очищаємо пробіли
//      впритул до керівних токенів {0xXX}.
//   4) Беремо `N` = скільки {lf} було в EN body. Розставляємо в UK body
//      рівно стільки ж — у пропорційно близьких до EN позиціях, з
//      перевагою межам речення (.!?) і коми (,:;).
//      Якщо UK слів менше за N+1 — fallback: кожне слово на свій рядок.
// =====================================================================
function splitPrefSuf(text) {
  if (!text) return { prefix: '', body: '', suffix: '' };
  // Префікс: послідовні провідні `{...}` токени (без пробілів між ними).
  let prefixEnd = 0;
  while (prefixEnd < text.length && text[prefixEnd] === '{') {
    const close = text.indexOf('}', prefixEnd);
    if (close < 0) break;
    prefixEnd = close + 1;
  }
  // Суфікс: послідовні завершальні `{...}` токени (без пробілів між ними).
  let suffixStart = text.length;
  while (suffixStart > 0 && text[suffixStart - 1] === '}') {
    const open = text.lastIndexOf('{', suffixStart - 1);
    if (open < 0) break;
    suffixStart = open;
  }
  // Захист від оверлапу (короткі рядки на кшталт `{lf}` без видимого тексту).
  if (suffixStart < prefixEnd) {
    return { prefix: text.slice(0, prefixEnd), body: '', suffix: '' };
  }
  return {
    prefix: text.slice(0, prefixEnd),
    body: text.slice(prefixEnd, suffixStart),
    suffix: text.slice(suffixStart)
  };
}

function tokenizeWords(text) {
  // Слова, де токен `{...}` — частина слова (не точка розриву).
  const out = [];
  let cur = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      i++; continue;
    }
    if (ch === '{') {
      const close = text.indexOf('}', i);
      if (close < 0) { cur += text.slice(i); break; }
      cur += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur) out.push(cur);
  return out;
}

function cleanUkBody(body) {
  return body
    .replace(/\{lf\}/g, ' ')
    .replace(/\s+(\{0x[0-9A-Fa-f]{2}\})/g, '$1')
    .replace(/(\{0x[0-9A-Fa-f]{2}\})\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeBreaks(ukFlat, enWidths, knj) {
  const N = enWidths.length - 1; // кількість {lf} у EN body
  if (N <= 0) return ukFlat;
  const words = tokenizeWords(ukFlat);
  if (words.length <= N) return words.join('{lf}');

  const spaceW = measureTextWithKnj(' ', knj);
  const wordW = words.map(w => measureTextWithKnj(w, knj));
  const cum = [];
  let s = 0;
  for (let i = 0; i < words.length; i++) {
    if (i > 0) s += spaceW;
    s += wordW[i];
    cum.push(s);
  }
  const totalUk = cum[cum.length - 1] || 1;
  const totalEn = enWidths.reduce((a, b) => a + b, 0) || 1;

  // Цільові кумулятивні позиції (у px) для кожного {lf}.
  const targets = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += enWidths[i];
    targets.push((acc / totalEn) * totalUk);
  }

  const breakIdxs = [];
  let lo = 0;
  for (let k = 0; k < N; k++) {
    const tw = targets[k];
    const remain = N - k - 1;
    const hi = words.length - 2 - remain;
    let bestIdx = lo;
    let bestScore = Infinity;
    for (let i = lo; i <= hi; i++) {
      const stripped = words[i].replace(/\{[^{}]*\}/g, '');
      const lastChar = stripped.slice(-1);
      let punctBonus = 0;
      if (/[.!?]/.test(lastChar)) punctBonus = -25;
      else if (/[,;:]/.test(lastChar)) punctBonus = -8;
      const score = Math.abs(cum[i] - tw) + punctBonus;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
    breakIdxs.push(bestIdx);
    lo = bestIdx + 1;
  }

  const out = [];
  let last = 0;
  for (const bi of breakIdxs) {
    out.push(words.slice(last, bi + 1).join(' '));
    last = bi + 1;
  }
  out.push(words.slice(last).join(' '));
  return out.join('{lf}');
}

ipcMain.handle('translate:autoWrapAdaptive', async (_e, payload) => {
  const pairs = (payload && payload.pairs) || [];
  const knjData = payload && payload.knjData;
  if (!knjData) return { error: 'no knj' };
  try {
    const knj = new Uint8Array(knjData);
    const wrapped = pairs.map(p => {
      try {
        const en = String((p && p.en) || '');
        const uk = String((p && p.uk) || '');
        if (!uk) return uk;
        const enS = splitPrefSuf(en);
        const ukS = splitPrefSuf(uk);
        const ukBody = cleanUkBody(ukS.body || '');
        if (!ukBody) {
          // Тільки контрольні токени — повертаємо UK як є (нічого розставляти).
          return uk;
        }
        const enLines = enS.body.split('{lf}');
        const N = enLines.length - 1;
        let newBody;
        if (N <= 0) {
          newBody = ukBody;
        } else {
          const enWidths = enLines.map(ln =>
            measureTextWithKnj(ln, knj)
          );
          newBody = placeBreaks(ukBody, enWidths, knj);
        }
        return enS.prefix + newBody + enS.suffix;
      } catch (_) { return p && p.uk; }
    });
    return { ok: true, wrapped };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
});

module.exports = { measureBytesWithKnj, autoWrapText, splitPrefSuf, tokenizeWords, cleanUkBody, placeBreaks };
