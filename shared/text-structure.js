'use strict';

// Структурні операції над «текстом з токенами» (`{lf}`, `{ColorRed}`,
// `{0x06}` …) — спільні для main (composeAll) і renderer (валідація,
// auto-fix, import-guard). Чисті функції без I/O.
//
// UMD: module.exports для Node, window.KH.textStructure для renderer.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KH = root.KH || {}; root.KH.textStructure = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Регекс для «літер» — кирилиця + латиниця. Якщо в text-сегменті є хоч 1
  // літера — це «контентний» текст (перекладається). Інакше це punctuation /
  // digits / whitespace — частина skeleton-у, копіюємо з EN.
  const LETTER_RE = /[a-zA-Zа-яА-ЯёЁїЇіІєЄґҐ]/;

  // Зберегти leading/trailing whitespace з оригіналу — гра використовує
  // провідні пробіли як форматування. Якщо користувач випадково знищив
  // (наприклад через Ctrl+A + новий текст), повертаємо їх.
  function preserveStructure(originalEng, userUk) {
    if (!userUk || !originalEng) return userUk || '';
    let r = userUk;
    const lead = originalEng.match(/^[ \t]+/);
    if (lead && !/^[ \t]/.test(r)) r = lead[0] + r;
    const trail = originalEng.match(/[ \t]+$/);
    if (trail && !/[ \t]$/.test(r)) r = r + trail[0];
    return r;
  }

  // tokensOf(text) → Map<token, count>. {lf} НЕ рахується: перекладач
  // легально розбиває рядки інакше; реальна структура вирівнюється через
  // Auto-wrap (за EN). Інакше HTML-імпорт відсікав би валідні пари.
  function tokensOf(text) {
    const set = new Map();
    if (!text) return set;
    const reCurly = /\{([^{}\n]+)\}/g;
    let m;
    while ((m = reCurly.exec(text)) !== null) {
      const t = '{' + m[1] + '}';
      if (t === '{lf}') continue;
      set.set(t, (set.get(t) || 0) + 1);
    }
    return set;
  }

  // validateTokens(en, uk) → { ok, missing:[{token,expected,got}], extra:[{token,count}] }
  function validateTokens(en, uk) {
    const enT = tokensOf(en);
    const ukT = tokensOf(uk);
    const missing = [];
    const extra = [];
    for (const [t, n] of enT) {
      const have = ukT.get(t) || 0;
      if (have < n) missing.push({ token: t, expected: n, got: have });
    }
    for (const [t, n] of ukT) {
      if (!enT.has(t)) extra.push({ token: t, count: n });
    }
    return { missing, extra, ok: missing.length === 0 };
  }

  function tokenIssueText(en, uk) {
    const v = validateTokens(en, uk);
    if (v.ok && v.extra.length === 0) return '';
    const parts = [];
    if (v.missing.length) {
      parts.push('Missing: ' + v.missing.map(x =>
        x.expected > 1 ? x.token + '×' + (x.expected - x.got) : x.token).join(', '));
    }
    if (v.extra.length) {
      parts.push('Extra: ' + v.extra.map(x => x.token).join(', '));
    }
    return parts.join(' · ');
  }

  // segmentByTokens(text) → [{type:'token'|'text', value}]
  function segmentByTokens(text) {
    const out = [];
    let i = 0;
    let lastTextStart = 0;
    while (i < text.length) {
      if (text[i] === '{') {
        const close = text.indexOf('}', i);
        if (close < 0) { i++; continue; }
        if (i > lastTextStart) {
          out.push({ type: 'text', value: text.slice(lastTextStart, i) });
        }
        out.push({ type: 'token', value: text.slice(i, close + 1) });
        i = close + 1;
        lastTextStart = i;
      } else {
        i++;
      }
    }
    if (text.length > lastTextStart) {
      out.push({ type: 'text', value: text.slice(lastTextStart) });
    }
    return out;
  }

  // Auto-fix structure — реконструює UK з EN-skeleton'у.
  //
  // ПРИНЦИП: гра очікує ВСЕ окрім англ. тексту 1:1 з EN (всі {...}-токени,
  // `{lf}`, контрольні байти, whitespace-padding). Перекладач замінює лише
  // «реальний» текст (з літерами); решта — структурна.
  //
  // 1. Розбиваємо EN та UK на сегменти: TOKEN (`{...}`) і TEXT (решта).
  // 2. EN-skeleton = всі токени + whitespace/punct-only text сегменти у тій же
  //    послідовності. Цей skeleton копіюємо буквально.
  // 3. Реальний текст (з літерами) — беремо з UK по позиції.
  //    Edge-whitespace кожного EN-real-text сегмента переноситься у результат.
  // 4. Якщо real-text count в EN ≠ в UK → auto-fix не може чесно мапити
  //    (перекладач злив/розщепив текст). Повертаємо null — потрібен manual fix.
  function autoFixStructure(en, uk) {
    if (!en || !uk) return null;
    const enSeg = segmentByTokens(en);
    const ukSeg = segmentByTokens(uk);
    const enLetters = enSeg.filter(s => s.type === 'text' && LETTER_RE.test(s.value));
    const ukLetters = ukSeg.filter(s => s.type === 'text' && LETTER_RE.test(s.value));

    if (ukLetters.length > enLetters.length) return null;
    if (ukLetters.length > 0 && ukLetters.length < enLetters.length) return null;

    let result = '';
    let letterIdx = 0;
    for (const seg of enSeg) {
      if (seg.type === 'token') {
        result += seg.value;
      } else if (LETTER_RE.test(seg.value)) {
        if (letterIdx < ukLetters.length) {
          const enText = seg.value;
          const ukText = ukLetters[letterIdx++].value;
          const enLead = (enText.match(/^[ \t]+/) || [''])[0];
          const enTrail = (enText.match(/[ \t]+$/) || [''])[0];
          const ukCore = ukText.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
          result += enLead + ukCore + enTrail;
        }
      } else {
        result += seg.value;
      }
    }
    return result;
  }

  // Sync padding from EN — копіює leading/trailing whitespace кожного
  // {lf}-рядка з EN у UK (типово втрачається після HTML-імпорту). Повертає
  // null якщо кількість рядків різна (спершу потрібен Auto-wrap за EN) або
  // якщо нічого не змінилось.
  function syncPaddingFromEn(en, uk) {
    const enLines = en.split('{lf}');
    const ukLines = uk.split('{lf}');
    if (enLines.length !== ukLines.length) return null;
    let changed = false;
    for (let i = 0; i < enLines.length; i++) {
      const enLine = enLines[i];
      let ukLine = ukLines[i];
      const enLead = (enLine.match(/^[ \t]+/) || [''])[0];
      if (enLead && !/^[ \t]/.test(ukLine)) { ukLine = enLead + ukLine; changed = true; }
      const enTrail = (enLine.match(/[ \t]+$/) || [''])[0];
      if (enTrail && !/[ \t]$/.test(ukLine)) { ukLine = ukLine + enTrail; changed = true; }
      ukLines[i] = ukLine;
    }
    return changed ? ukLines.join('{lf}') : null;
  }

  // Пари [старий токен, новий токен] між новим ключем (`{0x06,0x2C,0x01}`) і
  // старим (`{0x06,0x2C}` + символ третього байта: ' ', {lf}, {0xNN} чи літера).
  // Текст навколо токенів однаковий, тож ідемо по обох рядках синхронно.
  const RE_U16_TOKEN = /\{0x0[567],0x[0-9A-F]{2},0x[0-9A-F]{2}\}/g;
  function legacyTokenPairs(newKey, oldKey) {
    const pairs = [];
    let shift = 0;
    RE_U16_TOKEN.lastIndex = 0;
    let m;
    while ((m = RE_U16_TOKEN.exec(newKey)) !== null) {
      const tok = m[0];
      const at = m.index + shift;
      const head = tok.slice(0, 10) + '}';            // `{0x06,0x2C}` (11 символів)
      if (oldKey.slice(at, at + 11) !== head) return pairs;
      const j = at + 11;
      const tail = oldKey[j] === '{' ? oldKey.slice(j, oldKey.indexOf('}', j) + 1) : (oldKey[j] || '');
      const oldTok = head + tail;
      pairs.push([oldTok, tok]);
      shift += oldTok.length - tok.length;
    }
    return pairs;
  }
  // Переписати UK зі старої форми токенів у нову (щоб token-guard не відкинув переклад).
  function upgradeLegacyUk(newKey, oldKey, uk) {
    if (!uk || !oldKey || oldKey === newKey) return uk;
    let out = uk;
    for (const [oldTok, newTok] of legacyTokenPairs(newKey, oldKey)) out = out.split(oldTok).join(newTok);
    return out;
  }

  return {
    LETTER_RE,
    legacyTokenPairs,
    upgradeLegacyUk,
    preserveStructure,
    tokensOf,
    validateTokens,
    tokenIssueText,
    segmentByTokens,
    autoFixStructure,
    syncPaddingFromEn
  };
}));
