import { getCurrentGame } from '../app-shell.js';
import { importApplyBtn, importCancelBtn, importConflicts, importOverlay, importOverwriteBtn, importSummary } from '../core/dom.js';

import { toast } from '../core/log.js';
import { validateTokens } from '../core/shared.js';
import { gState, tState } from '../core/state.js';
import { isRealTranslation, refreshProgress, renderRows } from './files.js';
import { refreshGlossaryProgress, renderGlossaryRows, saveGlossary } from './glossary.js';

// in-flight import preview
let importPending = null;  // { matched: [{en, uk}], conflicts: [{en, oldUk, newUk}], unmatched: [{en, uk}] }

// =====================================================================
// Import translations from external file (HTML/CSV/TSV)
// — substring matching: HTML "phrase" → знаходимо як підрядок у glossary entries,
//   заміняємо текстову частину, керуючі коди / токени лишаємо.
// =====================================================================
export const IMPORT_MIN_PHRASE_LEN = 4;

export function applySubstringSubstitutions(text, pairs) {
  // Знайти ВСІ можливі збіги
  const matches = [];
  for (let i = 0; i < pairs.length; i++) {
    const en = pairs[i].en;
    const uk = pairs[i].uk;
    if (!en || en.length < IMPORT_MIN_PHRASE_LEN) continue;
    // Захист: якщо імпортована пара втрачає або змінює `{...}` токени
    // (наприклад перекладач у HTML-джерелі забув `.{0x06}`), ігноруємо її —
    // інакше система мовчки запише до глосарію UK без керівних байтів і
    // це зламає рендер у грі.
    if (!validateTokens(en, uk).ok) continue;
    let pos = 0;
    while (true) {
      const idx = text.indexOf(en, pos);
      if (idx < 0) break;
      matches.push({ start: idx, end: idx + en.length, en: en, uk: uk });
      pos = idx + 1; // дозволяємо overlap-кандидатам бути знайденими, відсіємо нижче
    }
  }
  if (!matches.length) return null;

  // Жадібний вибір: довший збіг переважає, потім лівіший.
  matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);

  const taken = new Array(text.length).fill(false);
  const chosen = [];
  for (const m of matches) {
    let overlap = false;
    for (let i = m.start; i < m.end; i++) {
      if (taken[i]) { overlap = true; break; }
    }
    if (overlap) continue;
    for (let i = m.start; i < m.end; i++) taken[i] = true;
    chosen.push(m);
  }
  if (!chosen.length) return null;

  // Зібрати результат у порядку позицій
  chosen.sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const m of chosen) {
    out += text.substring(pos, m.start);
    out += m.uk;
    pos = m.end;
  }
  out += text.substring(pos);

  if (out === text) return null;
  return { uk: out, sources: chosen.map(m => m.en) };
}

export async function importTranslations() {
  if (!gState.entries.length) {
    toast(window.i18n.t('toastBuildFirst'), 'error', 5000);
    return;
  }

  // Колонкова розкладка варіюється по грі:
  //   KH1 HTML (Pro100luk-style):   col 0 = EN,    col 1 = UK,        \n → {lf}
  //   BBS HTML (моя розкладка):     col 0 = path,  col 1 = EN, col 2 = UK,  \n залишається
  // Якщо у майбутньому з'являться інші формати — додавай у gamesConfig.
  const game = getCurrentGame();
  const importOpts = (game && game.id === 'kh-bbs-final-mix')
    ? { enCol: 1, ukCol: 2, lineBreakToken: null }
    : { enCol: 0, ukCol: 1 };

  let r;
  try { r = await window.kh1.translate.importTranslations(importOpts); }
  catch (e) { toast(window.i18n.t('toastError', {msg: e.message}), 'error'); return; }

  if (r.canceled) return;
  if (r.error) { toast(window.i18n.t('toastParseError', {msg: r.error}), 'error', 6000); return; }

  const sources = r.sources || [];
  const errs = r.errors || [];
  if (errs.length) {
    toast(window.i18n.t('toastParseFilesError', {n: errs.length, first: errs[0].error}), 'error', 6000);
  }

  // Нормалізація Pro100luk-style токенів з пробілами → канонічні без пробілів,
  // щоб substring-match знаходив їх в глосарій-ключах (наш decoder завжди
  // повертає канонічну форму).
  const TOKEN_ALIAS_MAP = {
    // Curly-brace Pro100luk-style (з пробілами)
    '{Color Red}':         '{ColorRed}',
    '{Color Violet}':      '{ColorViolet}',
    '{Color Green}':       '{ColorGreen}',
    '{Base Color}':        '{ColorBase}',
    '{Variable Item}':     '{VarItem}',
    '{Variable Item 2}':   '{VarItem}',
    '{Variable Spell}':    '{VarSpell}',
    '{Variable Spell New}': '{VarSpellNew}',
    '{Variable Value}':    '{VarValue}',
    '{Variable Number 1}': '{VarNum1}',
    '{Variable Number 2}': '{VarNum2}',
    '{Variable Number 3}': '{VarNum3}',
    // Square-bracket варіант (Google Sheets подекуди їсть {} і ставить [])
    '[Color Red]':         '{ColorRed}',
    '[Color Violet]':      '{ColorViolet}',
    '[Color Green]':       '{ColorGreen}',
    '[Base Color]':        '{ColorBase}',
    '[ColorRed]':          '{ColorRed}',
    '[ColorViolet]':       '{ColorViolet}',
    '[ColorGreen]':        '{ColorGreen}',
    '[ColorBase]':         '{ColorBase}',
    '[Variable Item]':     '{VarItem}',
    '[Variable Item 2]':   '{VarItem}',
    '[Variable Spell]':    '{VarSpell}',
    '[Variable Spell New]': '{VarSpellNew}',
    '[Variable Value]':    '{VarValue}',
    '[Variable Number 1]': '{VarNum1}',
    '[Variable Number 2]': '{VarNum2}',
    '[Variable Number 3]': '{VarNum3}',
    '[VarItem]':           '{VarItem}',
    '[VarSpell]':          '{VarSpell}',
    '[VarSpellNew]':       '{VarSpellNew}',
    '[VarValue]':          '{VarValue}',
    '[VarNum1]':           '{VarNum1}',
    '[VarNum2]':           '{VarNum2}',
    '[VarNum3]':           '{VarNum3}'
  };
  function normalizeTokens(s) {
    if (!s) return s;
    let out = s;
    for (const k in TOKEN_ALIAS_MAP) out = out.split(k).join(TOKEN_ALIAS_MAP[k]);
    return out;
  }

  // Розщеплення multi-line: HTML інколи зберігає кілька фраз через ¶ (=> {lf}).
  // У грі це часто 3 окремі слоти. Якщо EN та UK мають ОДНАКОВУ кількість
  // сегментів — додаємо кожен як окрему під-пару, щоб substring-match знайшов
  // їх у відповідних slotах глосарія.
  // Підрахувати скільки в сегменті "справжніх" літер (поза {...}-токенами).
  // Якщо менше 3 — сегмент майже-весь токени, ¶-split безпечно
  // зробити НЕЛЬЗЯ (перекладачі часто переставляють порядок частин).
  function letterCountOutsideTokens(s) {
    const stripped = String(s || '').replace(/\{[^}]+\}/g, '');
    const letters = stripped.match(/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g);
    return letters ? letters.length : 0;
  }

  const expandedRaw = [];
  let splitAdded = 0;
  let splitSkipped = 0;
  let normalized = 0;
  for (const rawP of (r.pairs || [])) {
    if (!rawP || !rawP.en || !rawP.uk) continue;
    const en0 = normalizeTokens(rawP.en);
    const uk0 = normalizeTokens(rawP.uk);
    if (en0 !== rawP.en || uk0 !== rawP.uk) normalized++;
    const p = { en: en0, uk: uk0 };
    expandedRaw.push(p);
    const enParts = p.en.split('{lf}');
    const ukParts = p.uk.split('{lf}');
    if (enParts.length > 1 && enParts.length === ukParts.length) {
      // Класифікуємо кожен сегмент: 'text' (>=3 літери поза токенами) або 'tokens'
      const enCls = enParts.map(s => letterCountOutsideTokens(s) >= 3 ? 'text' : 'tokens');
      const ukCls = ukParts.map(s => letterCountOutsideTokens(s) >= 3 ? 'text' : 'tokens');
      let directOK = true;
      let reversedOK = true;
      const N = enParts.length;
      for (let i = 0; i < N; i++) {
        if (enCls[i] !== ukCls[i]) directOK = false;
        if (enCls[i] !== ukCls[N - 1 - i]) reversedOK = false;
      }
      // Прямі пари мають пріоритет; reversed дозволяємо коли direct невалідне
      // (перекладач переставив структуру речення — типово для ENG→UKR).
      if (directOK) {
        for (let i = 0; i < N; i++) {
          const en = enParts[i].trim();
          const uk = ukParts[i].trim();
          if (en && uk) { expandedRaw.push({ en, uk }); splitAdded++; }
        }
      } else if (reversedOK && N === 2) {
        // лише для 2-сегментного випадку (найбезпечніше)
        for (let i = 0; i < N; i++) {
          const en = enParts[i].trim();
          const uk = ukParts[N - 1 - i].trim();
          if (en && uk) { expandedRaw.push({ en, uk }); splitAdded++; }
        }
      } else {
        splitSkipped++;
      }
    } else if (enParts.length > 1 && ukParts.length === 1 &&
               letterCountOutsideTokens(ukParts[0]) >= 3) {
      // EN multi-segment, UK single-block. Спершу пробуємо РОЗУМНО розбити
      // UK по знаках кінця речення (. ! ? + після пробіл/кінець).
      const ukText = ukParts[0];
      const sentRe = /[.!?…]+(?=\s|$)/g;
      const matches = [];
      let m;
      while ((m = sentRe.exec(ukText)) !== null) matches.push(m);
      let smartUk = null;
      if (matches.length === enParts.length) {
        const arr = [];
        let lastEnd = 0;
        for (const mm of matches) {
          const end = mm.index + mm[0].length;
          arr.push(ukText.substring(lastEnd, end).trim());
          lastEnd = end;
        }
        if (arr.every(s => s.length > 0)) smartUk = arr;
      }

      if (smartUk) {
        // Direct pairing по reчeннях
        for (let i = 0; i < enParts.length; i++) {
          const en = enParts[i].trim();
          const uk = smartUk[i];
          if (en && uk) { expandedRaw.push({ en, uk }); splitAdded++; }
        }
      } else {
        // Fallback: повний UK на 1-й EN, інші — пробіл (мінімальний blank)
        const en0 = enParts[0].trim();
        const uk0 = ukParts[0].trim();
        if (en0 && uk0) { expandedRaw.push({ en: en0, uk: uk0 }); splitAdded++; }
        for (let i = 1; i < enParts.length; i++) {
          const enI = enParts[i].trim();
          if (enI && letterCountOutsideTokens(enI) >= 3) {
            expandedRaw.push({ en: enI, uk: ' ' });
            splitAdded++;
          }
        }
      }
    }
  }

  // Dedupe by EN — якщо однакові EN в кількох файлах/сегментах, останній виграє.
  // Одночасно відсікаємо пари, де UK не зберіг {...}-токени з EN: це майже
  // завжди помилка перекладача у HTML-джерелі (пропустив {0xXX}, {VarItem}
  // тощо), і застосування такої пари зламало б керівні байти у грі.
  const enToUk = new Map();
  let duplicates = 0;
  let tokensBroken = 0;
  for (const p of expandedRaw) {
    if (!validateTokens(p.en, p.uk).ok) { tokensBroken++; continue; }
    if (enToUk.has(p.en) && enToUk.get(p.en) !== p.uk) duplicates++;
    enToUk.set(p.en, p.uk);
  }
  const pairs = [...enToUk.entries()].map(([en, uk]) => ({ en, uk }));

  if (!pairs.length) {
    toast(window.i18n.t('toastNoValidPairs'), 'error');
    return;
  }

  const parts = ['Завантажено ' + sources.length + ' файл(ів)', pairs.length + ' унікальних пар'];
  if (splitAdded) parts.push('розщеплено ¶: +' + splitAdded);
  if (splitSkipped) parts.push('пропущено split (інверсія): ' + splitSkipped);
  if (normalized) parts.push('нормалізовано токенів: ' + normalized);
  if (tokensBroken) parts.push('⚠ пропущено через втрату токенів: ' + tokensBroken);
  if (duplicates) parts.push('дублікати: ' + duplicates);
  toast(parts.join(' · '), 'info', 5500);

  const matched = [];      // { english, computedUk, sources }
  const conflicts = [];    // { english, oldUk, newUk, sources }
  const sameAlready = [];  // { english, uk }
  const usedPhrases = new Set();

  for (const entry of gState.entries) {
    const enKey = entry.english;
    const result = applySubstringSubstitutions(enKey, pairs);
    if (!result) continue;
    for (const s of result.sources) usedPhrases.add(s);

    const cur = gState.translations[enKey];
    if (!cur || cur === enKey) {
      matched.push({ english: enKey, computedUk: result.uk, sources: result.sources });
    } else if (cur === result.uk) {
      sameAlready.push({ english: enKey, uk: result.uk });
    } else {
      conflicts.push({ english: enKey, oldUk: cur, newUk: result.uk, sources: result.sources });
    }
  }

  const unmatched = pairs.filter(p => !usedPhrases.has(p.en));

  importPending = { matched, conflicts, unmatched, sameAlready, source: r.source, format: r.format };

  // Render summary
  importSummary.innerHTML = '';
  function statBox(num, lbl, cls) {
    const d = document.createElement('div');
    d.className = 'import-stat ' + (cls || '');
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = String(num);
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = lbl;
    d.appendChild(n); d.appendChild(l);
    return d;
  }
  importSummary.appendChild(statBox(matched.length, 'Збігів (нові)', 'match'));
  importSummary.appendChild(statBox(sameAlready.length, 'Вже однакові', ''));
  importSummary.appendChild(statBox(conflicts.length, 'Конфлікти', 'conflict'));
  importSummary.appendChild(statBox(unmatched.length, 'Не знайдено', 'miss'));

  // Render conflicts list (first 100)
  importConflicts.innerHTML = '';
  if (conflicts.length) {
    const head = document.createElement('div');
    head.className = 'conflict-row';
    head.innerHTML = '';
    const a = document.createElement('div');
    const b = document.createElement('div');
    const aLbl = document.createElement('div'); aLbl.className = 'ch'; aLbl.textContent = 'Поточне (буде замінене якщо "Перезаписати")';
    const bLbl = document.createElement('div'); bLbl.className = 'ch'; bLbl.textContent = 'З імпорту';
    a.appendChild(aLbl); b.appendChild(bLbl);
    head.appendChild(a); head.appendChild(b);
    importConflicts.appendChild(head);

    const limit = Math.min(100, conflicts.length);
    for (let i = 0; i < limit; i++) {
      const c = conflicts[i];
      const row = document.createElement('div');
      row.className = 'conflict-row';
      const left = document.createElement('div');
      const right = document.createElement('div');
      const lEn = document.createElement('div'); lEn.className = 'ch'; lEn.textContent = '« ' + c.english;
      const lOld = document.createElement('div'); lOld.className = 'cv old'; lOld.textContent = c.oldUk;
      const rEn = document.createElement('div'); rEn.className = 'ch'; rEn.textContent = '« ' + c.english;
      const rNew = document.createElement('div'); rNew.className = 'cv new'; rNew.textContent = c.newUk;
      left.appendChild(lEn); left.appendChild(lOld);
      right.appendChild(rEn); right.appendChild(rNew);
      row.appendChild(left); row.appendChild(right);
      importConflicts.appendChild(row);
    }
    if (conflicts.length > limit) {
      const more = document.createElement('div');
      more.className = 'conflict-row';
      const span = document.createElement('div');
      span.className = 'ch';
      span.textContent = '… і ще ' + (conflicts.length - limit) + ' конфліктів';
      more.appendChild(span);
      importConflicts.appendChild(more);
    }
  }

  importApplyBtn.disabled = matched.length === 0;
  importOverwriteBtn.disabled = matched.length + conflicts.length === 0;

  importOverlay.classList.remove('hidden');
  importOverlay.setAttribute('aria-hidden', 'false');
}

export function applyImport(includeConflicts) {
  if (!importPending) return;
  let applied = 0;
  for (const p of importPending.matched) {
    gState.translations[p.english] = p.computedUk;
    applied++;
  }
  if (includeConflicts) {
    for (const c of importPending.conflicts) {
      gState.translations[c.english] = c.newUk;
      applied++;
    }
  }
  gState.dirty = true;
  renderGlossaryRows();
  refreshGlossaryProgress();

  // 1) Одразу зберегти глосарій на диск (без чекання auto-save)
  saveGlossary(true);

  // 2) Оновити слоти відкритого файлу — підтягнути нові переклади з глосарія
  let updatedInFile = 0;
  if (tState.currentRel && tState.slots.length) {
    for (const slot of tState.slots) {
      if (isRealTranslation(slot)) continue; // не чіпаємо що користувач сам вводив
      const fromGloss = gState.translations[slot.english];
      if (fromGloss && fromGloss !== slot.english) {
        slot.ukText = fromGloss;
        updatedInFile++;
      }
    }
    if (updatedInFile > 0) {
      renderRows();
      refreshProgress();
    }
  }

  hideImport();
  const msg = 'Застосовано ' + applied + ' перекладів у глосарій · збережено' +
    (updatedInFile ? ' · оновлено ' + updatedInFile + ' слотів у відкритому файлі' : '');
  toast(msg, 'success', 6000);
}

export function hideImport() {
  importOverlay.classList.add('hidden');
  importOverlay.setAttribute('aria-hidden', 'true');
  importPending = null;
}

importApplyBtn.addEventListener('click', () => applyImport(false));
importOverwriteBtn.addEventListener('click', () => {
  if (importPending && importPending.conflicts.length > 0) {
    if (!window.confirm('Перезаписати ' + importPending.conflicts.length + ' існуючих перекладів?')) return;
  }
  applyImport(true);
});
importCancelBtn.addEventListener('click', hideImport);
importOverlay.addEventListener('click', (e) => { if (e.target === importOverlay) hideImport(); });

