import { repApply, repCancel, repCase, repFind, repOverlay, repPreview, repRegex, repReplace, repStat, repWholeWord } from '../core/dom.js';
import { toast } from '../core/log.js';
import { gState, tState } from '../core/state.js';
import { isRealTranslation, refreshProgress, renderRows, scheduleTsvAutoSave } from './files.js';
import { refreshGlossaryProgress, renderGlossaryRows, saveGlossary } from './glossary.js';
import { snapshotGlossary } from './history.js';

// =====================================================================
// Find & Replace (Ctrl+H) — у глосарії + у відкритому файлі
// =====================================================================
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Будує regex з опціями. Повертає null якщо вираз невалідний (для regex-режиму).
export function buildSearchRegex(find, opts) {
  if (!find) return null;
  const caseSensitive = !!(opts && opts.caseSensitive);
  const wholeWord = !!(opts && opts.wholeWord);
  const isRegex = !!(opts && opts.regex);
  let pattern = isRegex ? find : escapeRegex(find);
  if (wholeWord) pattern = '\\b(?:' + pattern + ')\\b';
  try {
    return new RegExp(pattern, 'g' + (caseSensitive ? '' : 'i'));
  } catch (_) { return null; }
}
export function countOcc(haystack, needle, opts) {
  // backward-compat: opts може бути boolean (старий caseSensitive flag)
  const o = (typeof opts === 'boolean') ? { caseSensitive: opts } : (opts || {});
  if (!needle || !haystack) return 0;
  const re = buildSearchRegex(needle, o);
  if (!re) return 0;
  return (String(haystack).match(re) || []).length;
}
export function replaceAll(text, find, repl, opts) {
  const o = (typeof opts === 'boolean') ? { caseSensitive: opts } : (opts || {});
  if (!find || !text) return text;
  const re = buildSearchRegex(find, o);
  if (!re) return text;
  return String(text).replace(re, repl);
}

export function showReplace() {
  repOverlay.classList.remove('hidden');
  repOverlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => { repFind.focus(); repFind.select(); }, 0);
  updateReplaceStat();
}
export function hideReplace() {
  repOverlay.classList.add('hidden');
  repOverlay.setAttribute('aria-hidden', 'true');
}

export function getReplaceOpts() {
  return {
    caseSensitive: repCase.checked,
    wholeWord: repWholeWord && repWholeWord.checked,
    regex: repRegex && repRegex.checked
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function updateReplaceStat() {
  const find = repFind.value;
  const repl = repReplace.value;
  const opts = getReplaceOpts();
  if (!find) {
    repStat.textContent = 'Введіть текст для пошуку...';
    repApply.disabled = true;
    repApply.textContent = 'Замінити';
    if (repPreview) repPreview.classList.add('hidden');
    return;
  }
  // Validate regex
  const testRe = buildSearchRegex(find, opts);
  if (!testRe) {
    repStat.textContent = '⚠ Невалідний regex';
    repApply.disabled = true;
    if (repPreview) repPreview.classList.add('hidden');
    return;
  }
  let totalOcc = 0, entries = 0;
  const previewItems = [];
  for (const en of Object.keys(gState.translations || {})) {
    const v = gState.translations[en];
    const o = countOcc(v, find, opts);
    if (o > 0) {
      totalOcc += o;
      entries++;
      if (previewItems.length < 5) {
        const newV = replaceAll(v, find, repl, opts);
        previewItems.push({ en, oldUk: v, newUk: newV });
      }
    }
  }
  let openSlots = 0;
  if (tState.currentRel && tState.slots && tState.slots.length) {
    for (const slot of tState.slots) {
      if (isRealTranslation(slot) && countOcc(slot.ukText, find, opts) > 0) openSlots++;
    }
  }
  if (totalOcc === 0 && openSlots === 0) {
    repStat.textContent = 'Не знайдено в глосарії або відкритому файлі.';
    repApply.disabled = true;
    repApply.textContent = 'Замінити';
    if (repPreview) repPreview.classList.add('hidden');
    return;
  }
  const parts = [];
  if (totalOcc) parts.push(totalOcc + ' входжень у ' + entries + ' записах глосарія');
  if (openSlots) parts.push(openSlots + ' слот(ів) у відкритому файлі');
  repStat.textContent = 'Знайдено ' + parts.join(', ');
  repApply.disabled = false;
  repApply.textContent = 'Замінити в ' + (entries + openSlots) + ' місцях';

  // Preview перших 5 змін
  if (repPreview && previewItems.length) {
    let html = '';
    for (const it of previewItems) {
      html += '<div class="rep-row">'
            + '<div class="rep-old">- ' + escapeHtml(it.oldUk.slice(0, 200)) + '</div>'
            + '<div class="rep-new">+ ' + escapeHtml(it.newUk.slice(0, 200)) + '</div>'
            + '</div>';
    }
    if (entries > 5) html += '<div class="rep-row" style="text-align:center;color:var(--text-muted)">…ще ' + (entries - 5) + '</div>';
    repPreview.innerHTML = html;
    repPreview.classList.remove('hidden');
  } else if (repPreview) {
    repPreview.classList.add('hidden');
  }
}

export async function doReplaceAll() {
  const find = repFind.value;
  const repl = repReplace.value;
  const opts = getReplaceOpts();
  if (!find) return;
  if (!window.confirm('Замінити "' + find + '" → "' + repl + '" у глосарії та відкритому файлі?')) return;

  snapshotGlossary('Find/Replace');
  let changedGloss = 0;
  for (const en of Object.keys(gState.translations || {})) {
    const old = gState.translations[en];
    if (!old) continue;
    if (countOcc(old, find, opts) === 0) continue;
    gState.translations[en] = replaceAll(old, find, repl, opts);
    changedGloss++;
  }

  let changedSlots = 0;
  if (tState.currentRel && tState.slots && tState.slots.length) {
    for (const slot of tState.slots) {
      if (!isRealTranslation(slot)) continue;
      if (countOcc(slot.ukText, find, opts) === 0) continue;
      slot.ukText = replaceAll(slot.ukText, find, repl, opts);
      changedSlots++;
    }
  }

  if (changedGloss) {
    gState.dirty = true;
    await saveGlossary(true);
    renderGlossaryRows();
    refreshGlossaryProgress();
  }
  if (changedSlots) {
    tState.dirty = true;
    renderRows();
    refreshProgress();
    scheduleTsvAutoSave();
  }
  hideReplace();
  toast(window.i18n.t('toastReplaceCount', {n: changedGloss}) +
    (changedSlots ? window.i18n.t('toastReplaceSlots', {n: changedSlots}) : ''),
    'success', 5000);
}

repFind.addEventListener('input', updateReplaceStat);
repReplace.addEventListener('input', updateReplaceStat);
repCase.addEventListener('change', updateReplaceStat);
if (repWholeWord) repWholeWord.addEventListener('change', updateReplaceStat);
if (repRegex) repRegex.addEventListener('change', updateReplaceStat);

export const gFindReplaceBtn = document.getElementById('g-find-replace');
if (gFindReplaceBtn) gFindReplaceBtn.addEventListener('click', showReplace);
repApply.addEventListener('click', doReplaceAll);
repCancel.addEventListener('click', hideReplace);
repOverlay.addEventListener('click', (e) => { if (e.target === repOverlay) hideReplace(); });
repFind.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (!repApply.disabled) doReplaceAll(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideReplace(); }
});
repReplace.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (!repApply.disabled) doReplaceAll(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideReplace(); }
});

export function joinPath(a, b) {
  if (!a) return b;
  const sep = a.indexOf('\\') >= 0 ? '\\' : '/';
  const aTrim = a.replace(/[\\/]+$/, '');
  const bNorm = b.replace(/[\\/]+/g, sep);
  return aTrim + sep + bNorm.replace(/^[\\/]+/, '');
}

