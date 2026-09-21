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

  // ---- BBS: імпорт таблиць, зроблених через OpenKh CTD Editor ----
  // Його теги інші й місцями lossy: {:color yellow} → наш {color yellow},
  // {:icon button-l} → {icon l}, {:icon unk} → {icon3 unk}, {0xF0} → {b f0},
  // а {0xF1}/{0xF5} — це лише перший байт двобайтової іконки ({icon ba}, {icon3 66}…),
  // тож їх можна відновити тільки з самого ключа гри (bbsShapeMatch нижче).
  function bbsNormalizeTags(s) {
    return String(s || '')
      .replace(/\{:color\s+([^}]+)\}/g, '{color $1}')
      .replace(/\{:icon\s+button-([^}]+)\}/g, '{icon $1}')
      .replace(/\{:icon\s+unk\}/g, '{icon3 unk}')
      .replace(/\{0x83\}\{0xD4\}/gi, 'χ')   // χ-blade: OpenKh лишає сирі байти cp932
      .replace(/\{0x([0-9A-Fa-f]{2})\}/g, (_, h) => '{b ' + h.toLowerCase() + '}');
  }
  // «Форма» рядка: теги → \u0001, повноширинні пробіли U+3000 → звичайні, серії
  // пробілів/табів → один пробіл, переноси лишаються. Так порівнюємо текст, коли
  // теги в таблиці lossy, а вирівнювання (U+3000) експорт замінив на пробіли.
  // «Форма» рядка: теги → \u0001, тире гри «―∥» ≡ «--» ≡ «—», будь-які пробіли/
  // переноси/повноширинні пробіли (U+3000) → один пробіл. Так порівнюємо текст, коли
  // теги в таблиці lossy, а вирівнювання й переноси експорт/перекладач змінив.
  function bbsShape(s) {
    return String(s || '').replace(/\{[^}]*\}/g, '\u0001').replace(/―∥|--|—/g, '—').replace(/[\u3000\s]+/g, ' ').trim();
  }
  // bbsShapeMatch(pairs, keys) → нові пари { en: ключ гри, uk: переклад з тегами ключа }.
  // Для пари, чий en не є ключем, шукаємо всі ключі з тією ж формою (різні переноси —
  // різні ключі, усі отримують переклад); якщо кількість тегів у ключі, en і uk
  // однакова — підставляємо в uk теги ключа по порядку.
  function bbsShapeMatch(pairs, keys) {
    const byShape = new Map();
    const keySet = new Set(keys);
    for (const k of keySet) { const sh = bbsShape(k); if (!sh) continue; if (!byShape.has(sh)) byShape.set(sh, []); byShape.get(sh).push(k); }
    const out = [];
    let ambiguous = 0;
    for (const p of pairs) {
      if (!p || !p.en || !p.uk || keySet.has(p.en)) continue;
      const cands = byShape.get(bbsShape(p.en));
      if (!cands) continue;
      const et = p.en.match(/\{[^}]*\}/g) || [];
      const ut = p.uk.match(/\{[^}]*\}/g) || [];
      for (const key of cands) {
        const kt = key.match(/\{[^}]*\}/g) || [];
        if (kt.length !== et.length || ut.length !== kt.length) { ambiguous++; continue; }
        let i = 0;
        const uk = p.uk.replace(/\{[^}]*\}/g, () => kt[i++]);
        out.push({ en: key, uk, shaped: true });
      }
    }
    return { pairs: out, ambiguous };
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
  // Той самий рядок у різних файлах може мати ключ з хвостовим {eol} (ev-файли
  // додають термінатор) і без нього (binl). Якщо точного ключа в глосарії нема —
  // беремо переклад сусіднього варіанта, узгодивши хвіст. Повертає '' якщо нема.
  function lookupEolVariant(glossary, key) {
    if (!glossary || !key) return '';
    const has = (k) => Object.prototype.hasOwnProperty.call(glossary, k) && glossary[k];
    if (key.endsWith('{eol}')) {
      const bare = key.slice(0, -5);
      if (has(bare)) { const v = String(glossary[bare]); return v.endsWith('{eol}') ? v : v + '{eol}'; }
    } else if (has(key + '{eol}')) {
      const v = String(glossary[key + '{eol}']);
      return v.endsWith('{eol}') ? v.slice(0, -5) : v;
    }
    return '';
  }

  // Переписати UK зі старої форми токенів у нову (щоб token-guard не відкинув переклад).
  function upgradeLegacyUk(newKey, oldKey, uk) {
    if (!uk || !oldKey || oldKey === newKey) return uk;
    let out = uk;
    for (const [oldTok, newTok] of legacyTokenPairs(newKey, oldKey)) out = out.split(oldTok).join(newTok);
    return out;
  }

  // KH1: текст лежить у п'яти архівах kh1_first…kh1_fifth. У робочій теці (ENG/
  // PROGRESS/DONE) шлях починається з імені архіву: `kh1_second/al01.ard/UK_….binl`;
  // старий плоский шлях без префікса (`dc01.ard/…`) — це kh1_first.
  var KH1_ARCHIVES = ['kh1_first', 'kh1_second', 'kh1_third', 'kh1_fourth', 'kh1_fifth'];
  var KH1_ARC_RE = /^(kh1_(?:first|second|third|fourth|fifth))\/(.*)$/i;
  // { archive, rest } — архів і шлях усередині нього (без remastered/|original/).
  function kh1SplitRel(rel) {
    const r = String(rel || '').replace(/\\/g, '/');
    const m = KH1_ARC_RE.exec(r);
    return m ? { archive: m[1].toLowerCase(), rest: m[2] } : { archive: 'kh1_first', rest: r };
  }
  // Шлях без префікса архіву (для підписів світів/кімнат: `al01.ard/…`).
  function kh1StripArchive(rel) { return kh1SplitRel(rel).rest; }
  // Шлях у DONE / грі: `<archive>/(original|remastered)/…` — так, як лежить у
  // розпакованому `<archive>.hed_out`: exchange/* → original/, решта → remastered/.
  // Шляхи, що вже мають remastered/|original/, лишаємо.
  function kh1OutRel(rel) {
    const { archive, rest } = kh1SplitRel(rel);
    if (/^(remastered|original)\//i.test(rest)) return archive + '/' + rest;
    return archive + '/' + (/^exchange\//i.test(rest) ? 'original/' : 'remastered/') + rest;
  }

  // Розкладка «як для патча» KHPCPatchManager: тека, яку перетягують на exe,
  // містить <archive>/(original|remastered)/… БЕЗ суфікса .hed_out (інакше гра
  // не читає). KH1 — kh1OutRel; BBS/DDD (ENG лежить як <archive>.hed_out/…) —
  // прибираємо суфікс; Re:CoM (ENG/FILES/… без префікса) — додаємо Recom/.
  function patchOutRel(gameId, rel) {
    const r = String(rel || '').replace(/\\/g, '/');
    if (gameId === 'kh1-final-mix') return kh1OutRel(r);
    const m = /^([^/]+)\.hed_out\/(.*)$/i.exec(r);
    if (m) return m[1] + '/' + m[2];
    if (gameId === 'kh-re-com') return /^Recom\//i.test(r) ? r : 'Recom/' + r;
    return r;
  }

  return {
    LETTER_RE,
    KH1_ARCHIVES,
    patchOutRel,
    kh1SplitRel,
    kh1StripArchive,
    kh1OutRel,
    legacyTokenPairs,
    lookupEolVariant,
    upgradeLegacyUk,
    preserveStructure,
    tokensOf,
    validateTokens,
    tokenIssueText,
    segmentByTokens,
    autoFixStructure,
    syncPaddingFromEn, bbsNormalizeTags, bbsShape, bbsShapeMatch };
}));
