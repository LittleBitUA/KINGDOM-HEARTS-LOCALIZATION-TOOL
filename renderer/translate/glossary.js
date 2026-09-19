import { getCurrentGame } from '../app-shell.js';
import { gBuild, gComposeAll, gDashBarFill, gDashDone, gDashIssues, gDashPct, gDashSameEn, gDashTotal, gDashUntrans, gDashboard, gRows, gSave, gStat, tProgress, tStatus } from '../core/dom.js';
import { toast } from '../core/log.js';
import { autoFixStructure, syncPaddingFromEn, tokenIssueText, validateTokens } from '../core/shared.js';
import { gState, tState } from '../core/state.js';
import { kState } from '../kerning/kerning.js';
import { openSettings } from '../settings-modal.js';
import { exportFileTxt, flushGlossaryAutoSave, importFileTxt, refreshProgress, renderRows, scheduleGlossaryAutoSave, setSubtab } from './files.js';
import { snapshotGlossary, undoLastBulk, canUndoBulk, lastBulkLabel, onHistoryChange } from './history.js';

// =====================================================================
// Glossary
// =====================================================================
export async function loadGlossaryFromDisk() {
  if (!tState.settings.tsvDir) return;
  try {
    const r = await window.kh1.translate.readGlossary(tState.settings.tsvDir);
    if (r.ok) {
      gState.translations = Object.assign(Object.create(null), r.entries || {});
      refreshGlossaryProgress();
    }
  } catch (_) {}
}

export async function buildGlossary() {
  if (gState.busy) return;
  // Required dirs варіюються по грі: KH1 = engDir + rusDir, BBS = тільки engDir.
  const game = getCurrentGame();
  const requiredDirs = (game && game.dirs && game.dirs.includes('rusDir'))
    ? ['engDir', 'rusDir']
    : ['engDir'];
  for (const k of requiredDirs) {
    if (!tState.settings[k]) {
      toast(window.i18n.t('toastConfigEngRus'), 'error');
      openSettings();
      return;
    }
  }
  if (!tState.files || !tState.files.length) {
    toast(window.i18n.t('toastEmptyFilesReload'), 'error');
    return;
  }

  gState.busy = true;
  gBuild.disabled = true;
  tProgress.classList.add('busy');
  tProgress.textContent = window.i18n.t('gScanning');

  try {
    const r = await window.kh1.translate.buildGlossary({
      engDir: tState.settings.engDir,
      rusDir: tState.settings.rusDir,
      files: tState.files.map(f => f.rel),
      safeMode: tState.safeMode
    });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }

    gState.entries = r.entries || [];
    const migrated = migrateLegacyKeys();
    renderGlossaryRows();
    refreshGlossaryProgress();
    const parts = [window.i18n.t('gBuiltSummary', { n: gState.entries.length })];
    if (migrated) parts.push(window.i18n.t('gMigratedKeys', { n: migrated }));
    parts.push(window.i18n.t('gProcessed', { n: r.processed }));
    if (r.skipped) parts.push(window.i18n.t('gSkipped', { n: r.skipped }));
    if (r.skippedUnsafe) parts.push(window.i18n.t('gSkippedUnsafe', { n: r.skippedUnsafe }));
    toast(parts.join(' · '), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  } finally {
    gState.busy = false;
    gBuild.disabled = false;
    tProgress.classList.remove('busy');
  }
}

// Переклади, збережені під старими ключами (2-байтові 05/06/07-токени), переносимо
// на нові ключі індексу. Старий ключ лишаємо — на нього ще можуть посилатися
// інші .txt; compose знаходить обидва.
export function legacyKeyMap() {
  const m = new Map();
  for (const e of gState.entries || []) if (e.legacyKey && e.legacyKey !== e.english) m.set(e.legacyKey, e);
  return m;
}
// Старі .txt-експорти (overlay-режим) мають EN-ключі з кириличними «двійниками»
// латиниці («Оbtаined» з кириличними О/а). Мапа: ключ з латинізованими двійниками → запис.
const LOOKALIKE_CASE = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X',
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x' };
export function latinizeLookalikes(s) {
  return s.replace(/[АВСЕНІКМОРТХаеіорсух]/g, ch => LOOKALIKE_CASE[ch] || ch);
}
export function lookalikeKeyMap() {
  const m = new Map();
  for (const e of gState.entries || []) {
    m.set(e.english, e);
    m.set(e.english.replace(/\{eol\}$/, ''), e);
  }
  return m;
}
export function resolveImportedKey(en, legacy, lookalike) {
  if (legacy.has(en)) return legacy.get(en);
  if (/[А-Яа-яІіЇїЄєҐґ]/.test(en)) {
    const lat = latinizeLookalikes(en);
    const e = lookalike.get(lat) || lookalike.get(lat.replace(/\{eol\}$/, ''));
    if (e) return e;
  }
  return null;
}
// Пари [старий токен, новий токен] між новим ключем (`{0x06,0x2C,0x01}`) і
// старим (`{0x06,0x2C}` + символ третього байта: ' ', {lf}, {0xNN} чи літера).
// Текст навколо токенів однаковий, тож ідемо по обох рядках синхронно.
const RE_U16 = /\{0x0[567],0x[0-9A-F]{2},0x[0-9A-F]{2}\}/g;
export function legacyTokenPairs(newKey, oldKey) {
  const pairs = [];
  let shift = 0;   // старий рядок коротший/довший на суму різниць попередніх токенів
  for (const m of newKey.matchAll(RE_U16)) {
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
export function upgradeLegacyUk(entry, uk) {
  if (!uk || !entry.legacyKey) return uk;
  let out = uk;
  for (const [oldTok, newTok] of legacyTokenPairs(entry.english, entry.legacyKey)) out = out.split(oldTok).join(newTok);
  return out;
}
export function migrateLegacyKeys() {
  let n = 0;
  for (const e of gState.entries || []) {
    if (!e.legacyKey || e.legacyKey === e.english) continue;
    const cur = gState.translations[e.english];
    const old = gState.translations[e.legacyKey];
    if ((cur === undefined || cur === '') && old) { gState.translations[e.english] = upgradeLegacyUk(e, old); n++; }
  }
  if (n) { gState.dirty = true; scheduleGlossaryAutoSave(); }
  return n;
}

export function getGlossaryRenderOrder() {
  const sort = (gState.filter && gState.filter.sort) || 'default';
  const idxs = gState.entries.map((_, i) => i);
  if (sort === 'en-len-desc') {
    idxs.sort((a, b) => gState.entries[b].english.length - gState.entries[a].english.length);
  } else if (sort === 'en-len-asc') {
    idxs.sort((a, b) => gState.entries[a].english.length - gState.entries[b].english.length);
  } else if (sort === 'uk-len-desc') {
    idxs.sort((a, b) => {
      const ukA = gState.translations[gState.entries[a].english] || '';
      const ukB = gState.translations[gState.entries[b].english] || '';
      return ukB.length - ukA.length;
    });
  } else if (sort === 'count-desc') {
    idxs.sort((a, b) => (gState.entries[b].count || 0) - (gState.entries[a].count || 0));
  }
  return idxs;
}

export function renderGlossaryRows() {
  while (gRows.firstChild) gRows.removeChild(gRows.firstChild);
  if (!gState.entries.length) {
    const div = document.createElement('div');
    div.className = 't-empty';
    const p = document.createElement('p');
    p.textContent = window.i18n.t('gEmptyHint');
    div.appendChild(p);
    gRows.appendChild(div);
    return;
  }

  const frag = document.createDocumentFragment();
  const order = getGlossaryRenderOrder();
  for (const i of order) {
    const entry = gState.entries[i];
    const ukText = gState.translations[entry.english] || '';

    const row = document.createElement('div');
    let cls = 't-row' + (ukText ? ' translated' : '');
    if (ukText) {
      const issue = tokenIssueText(entry.english, ukText);
      if (issue) { cls += ' token-warn'; row.title = issue; }
    }
    row.className = cls;
    row.dataset.gidx = String(i);

    const meta = document.createElement('div');
    meta.className = 't-meta';
    const cnt = document.createElement('span');
    cnt.className = 't-count';
    cnt.textContent = '× ' + entry.count;
    cnt.title = window.i18n.t('gInFiles', { n: entry.fileCount });
    meta.appendChild(cnt);

    const en = document.createElement('div');
    en.className = 't-en';
    en.textContent = entry.english;

    const uk = document.createElement('textarea');
    uk.className = 't-uk g-uk';
    uk.placeholder = 'Український переклад…';
    uk.value = ukText;
    uk.spellcheck = false;
    uk.rows = Math.min(4, Math.max(1, Math.ceil(entry.english.length / 70)));

    row.appendChild(meta);
    row.appendChild(en);
    row.appendChild(uk);
    frag.appendChild(row);
  }
  gRows.appendChild(frag);
  applyGlossaryFilter();
}

// Кирилично-латинські look-alike — у KH1 один і той самий гліф у шрифті
// має той самий бай т, тому розпарсений ENG-файл з overlay дає Cyrillic-look
// замість Latin (P→Р, o→о, p→р тощо). Нормалізуємо обидва напрямки до
// Latin для пошуку, щоб «Press» матчив і «Рress».
export const LOOKALIKE_TO_LATIN = {
  'А': 'a', 'В': 'b', 'С': 'c', 'Е': 'e', 'Н': 'h', 'К': 'k', 'М': 'm',
  'О': 'o', 'Р': 'p', 'Т': 't', 'Х': 'x', 'У': 'y', 'З': 'z',
  'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'к': 'k', 'м': 'm',
  'о': 'o', 'р': 'p', 'т': 't', 'х': 'x', 'у': 'y'
};
export function normalizeLookalikes(s) {
  let out = '';
  for (const ch of s) out += LOOKALIKE_TO_LATIN[ch] || ch;
  return out.toLowerCase();
}

export function applyGlossaryFilter() {
  const searchRaw = (gState.filter.search || '');
  const search = normalizeLookalikes(searchRaw);
  const mode = gState.filter.mode || 'all';
  const rowEls = gRows.querySelectorAll('.t-row');
  for (const rowEl of rowEls) {
    const idx = parseInt(rowEl.dataset.gidx, 10);
    const entry = gState.entries[idx];
    if (!entry) continue;
    const uk = gState.translations[entry.english] || '';
    let hide = false;
    if (search && normalizeLookalikes(entry.english).indexOf(search) === -1) hide = true;
    if (mode === 'untranslated' && uk) hide = true;
    if (mode === 'translated' && !uk) hide = true;
    if (mode === 'same-as-en' && uk !== entry.english) hide = true;
    if (mode === 'token-issues') {
      if (!uk || validateTokens(entry.english, uk).ok) hide = true;
    }
    rowEl.classList.toggle('hidden', hide);
  }
}

export function refreshGlossaryProgress() {
  const total = gState.entries.length;
  let done = 0, sameEn = 0, tokenIssues = 0;
  for (const e of gState.entries) {
    const uk = gState.translations[e.english];
    if (uk && uk.trim()) {
      done++;
      if (uk === e.english) sameEn++;
      if (!validateTokens(e.english, uk).ok) tokenIssues++;
    }
  }
  const untrans = total - done;
  const pct = total > 0 ? Math.round(100 * done / total) : 0;
  gStat.textContent = total > 0
    ? done + ' / ' + total + ' (' + pct + '%)'
    : '—';

  // Dashboard
  if (gDashboard) {
    if (total > 0) {
      gDashboard.removeAttribute('hidden');
      if (gDashDone) gDashDone.textContent = String(done);
      if (gDashTotal) gDashTotal.textContent = String(total);
      if (gDashPct) gDashPct.textContent = pct + '%';
      if (gDashBarFill) gDashBarFill.style.width = pct + '%';
      if (gDashUntrans) gDashUntrans.textContent = String(untrans);
      if (gDashSameEn) gDashSameEn.textContent = String(sameEn);
      if (gDashIssues) gDashIssues.textContent = String(tokenIssues);
    } else {
      gDashboard.setAttribute('hidden', 'hidden');
    }
  }

  if (tState.subtab === 'glossary') {
    tProgress.textContent = gStat.textContent;
    tStatus.textContent = 'Глосарій · ' + (gState.dirty ? '● незбережено' : 'збережено');
  }

  gSave.disabled = !tState.settings.tsvDir;
  // compose precondition залежить від гри (BBS не потребує rusDir)
  const _g = getCurrentGame();
  const _needsRus = !!(_g && _g.dirs && _g.dirs.includes('rusDir'));
  gComposeAll.disabled = total === 0 || done === 0 ||
    !tState.settings.engDir || (_needsRus && !tState.settings.rusDir) || !tState.settings.outDir;
}

// edit handler for glossary rows — event delegation
gRows.addEventListener('input', (e) => {
  const ta = e.target;
  if (!(ta && ta.classList && ta.classList.contains('g-uk'))) return;
  const row = ta.closest('.t-row');
  if (!row) return;
  const idx = parseInt(row.dataset.gidx, 10);
  const entry = gState.entries[idx];
  if (!entry) return;
  const v = ta.value;
  if (v.trim()) {
    gState.translations[entry.english] = v;
    row.classList.add('translated');
  } else {
    delete gState.translations[entry.english];
    row.classList.remove('translated');
  }
  // Token validation live update
  const ukText = gState.translations[entry.english] || '';
  if (ukText) {
    const issue = tokenIssueText(entry.english, ukText);
    row.classList.toggle('token-warn', !!issue);
    if (issue) row.title = issue; else row.removeAttribute('title');
  } else {
    row.classList.remove('token-warn');
    row.removeAttribute('title');
  }
  gState.dirty = true;
  refreshGlossaryProgress();
  scheduleGlossaryAutoSave();
});

export async function saveGlossary(silent) {
  if (!tState.settings.tsvDir) {
    if (!silent) { toast(window.i18n.t('toastConfigTsv'), 'error'); openSettings(); }
    return;
  }
  try {
    const r = await window.kh1.translate.saveGlossary({
      tsvDir: tState.settings.tsvDir,
      entries: gState.translations
    });
    if (r.error) {
      if (!silent) toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000);
      return;
    }
    gState.dirty = false;
    refreshGlossaryProgress();
    if (!silent) toast(window.i18n.t('toastGlossarySaved', {n: r.count}), 'success');
  } catch (e) {
    if (!silent) toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

export async function composeAllFiles() {
  if (gState.busy) return;
  // BBS не вимагає rusDir; KH1 вимагає engDir+rusDir+outDir.
  const game = getCurrentGame();
  const needsRus = !!(game && game.dirs && game.dirs.includes('rusDir'));
  if (!tState.settings.engDir || (needsRus && !tState.settings.rusDir) || !tState.settings.outDir) {
    toast(window.i18n.t('toastConfigEngRusUa'), 'error');
    openSettings();
    return;
  }
  if (!tState.files.length) { toast(window.i18n.t('toastEmptyFiles'), 'error'); return; }
  if (!Object.keys(gState.translations).length) { toast(window.i18n.t('toastEmptyGlossary'), 'error'); return; }

  // Token validation pre-check
  const { bad } = countGlossaryTokenIssues();
  if (bad > 0) {
    if (!window.confirm(window.i18n.t('composeAllWarnTokens', { n: bad }))) return;
  }

  if (!window.confirm(
    'Зібрати ' + tState.files.length + ' файлів у ' + tState.settings.outDir + '?\n\n' +
    'Per-file TSV-overrides з ' + (tState.settings.tsvDir || '(не задано)') + ' матимуть пріоритет над глосарієм.'
  )) return;

  gState.busy = true;
  gComposeAll.disabled = true;
  tProgress.classList.add('busy');

  // Гарантуємо що глосарій збережено перед mass-compose
  await flushGlossaryAutoSave();

  try {
    const r = await window.kh1.translate.composeAll({
      engDir: tState.settings.engDir,
      rusDir: tState.settings.rusDir,
      outDir: tState.settings.outDir,
      tsvDir: tState.settings.tsvDir || null,
      files: tState.files.map(f => f.rel),
      glossary: gState.translations,
      safeMode: tState.safeMode
    });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }

    const parts = ['Записано ' + r.written + ' / ' + r.processed + ' файлів',
                   r.totalReplacements + ' замін'];
    if (r.skippedNoTranslations) parts.push('без перекладів: ' + r.skippedNoTranslations);
    if (r.skippedUnsafe) parts.push('🛡 заблоковано небезпечних: ' + r.skippedUnsafe);
    if (r.errors && r.errors.length) {
      parts.push('з помилками: ' + r.errors.length);
      toast(parts.join(' · '), 'error', 9000);
    } else {
      toast(parts.join(' · '), 'success', 7000);
    }
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  } finally {
    gState.busy = false;
    gComposeAll.disabled = false;
    tProgress.classList.remove('busy');
    refreshGlossaryProgress();
  }
}

// =====================================================================
// Validate tokens — пошук перекладів з втраченими токенами
// =====================================================================
export function countGlossaryTokenIssues() {
  let total = 0, bad = 0;
  for (const en of Object.keys(gState.translations)) {
    const uk = gState.translations[en];
    if (!uk) continue;
    total++;
    if (!validateTokens(en, uk).ok) bad++;
  }
  return { total, bad };
}

export const gValidateBtn = document.getElementById('g-validate');
export const gAutoWrapBtn = document.getElementById('g-autowrap');
export const gMaxWidthInput = document.getElementById('g-maxwidth');

export async function autoWrapGlossary() {
  if (!kState.knjBuf) {
    toast(window.i18n.t('toastNeedKnj'), 'error', 6000); return;
  }
  const entries = Object.entries(gState.translations).filter(([en, uk]) => uk && uk.trim());
  if (!entries.length) {
    toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
  }
  // Adaptive: для кожного запису беремо maxWidth з найдовшого EN-рядка.
  // UK розмотується (видаляються попередні {lf}) і wrap'иться під ту саму ширину.
  // minWidth для дуже коротких EN береться з input (default 250).
  const minWidth = Math.max(100, Math.min(900, parseInt(gMaxWidthInput && gMaxWidthInput.value, 10) || 250));
  const pairs = entries.map(([en, uk]) => ({ en, uk }));
  const u8 = kState.knjBuf;
  const knjData = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  try {
    const r = await window.kh1.translate.autoWrapAdaptive({ pairs, knjData, minWidth, tolerance: 0 });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }
    let changed = 0, addedLfs = 0, structureFixed = 0;
    snapshotGlossary(window.i18n.t('autoWrapAdaptive'));
    for (let i = 0; i < entries.length; i++) {
      const [en, before] = entries[i];
      let after = r.wrapped[i];
      // Post-fix: Auto-wrap використовує splitPrefSuf, який може загубити токени
      // що стоять В СЕРЕДИНІ body (між літерами). Прогоняємо через
      // autoFixStructure щоб відновити повну EN-структуру (всі токени, крапки,
      // пробіли) в результаті.
      if (after) {
        const fixed = autoFixStructure(en, after);
        if (fixed && fixed !== after) { after = fixed; structureFixed++; }
      }
      if (after && after !== before) {
        gState.translations[en] = after;
        changed++;
        const beforeLfs = (before.match(/\{lf\}/g) || []).length;
        const afterLfs = (after.match(/\{lf\}/g) || []).length;
        addedLfs += Math.max(0, afterLfs - beforeLfs);
      }
    }
    if (changed) {
      gState.dirty = true;
      // Synchronize в активний файл якщо він відкритий
      if (tState.currentRel) {
        for (const slot of tState.slots) {
          if (gState.translations[slot.english] && slot.ukText !== gState.translations[slot.english]) {
            slot.ukText = gState.translations[slot.english];
            tState.dirty = true;
          }
        }
        renderRows();
        refreshProgress();
      }
      renderGlossaryRows();
      refreshGlossaryProgress();
      scheduleGlossaryAutoSave();
    }
    toast(window.i18n.t('toastAutoWrapDone', { changed, lfs: addedLfs }), 'success', 6000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

if (gAutoWrapBtn) gAutoWrapBtn.addEventListener('click', autoWrapGlossary);

if (gValidateBtn) {
  gValidateBtn.addEventListener('click', () => {
    const { total, bad } = countGlossaryTokenIssues();
    if (bad === 0) {
      toast(window.i18n.t('toastValidateClean', { n: total }), 'success', 5000);
      return;
    }
    toast(window.i18n.t('toastValidateBad', { n: bad, total }), 'error', 7000);
    // Switch to glossary view + filter to show only problematic entries via search hack
    setSubtab('glossary');
    // Re-render so token-warn classes are re-applied (in case glossary loaded fresh)
    renderGlossaryRows();
  });
}

export const gUndoBulkBtn = document.getElementById('g-undo-bulk');
if (gUndoBulkBtn) {
  onHistoryChange(() => {
    gUndoBulkBtn.disabled = !canUndoBulk();
    gUndoBulkBtn.title = canUndoBulk()
      ? window.i18n.t('undoBulkTitleWith', { label: lastBulkLabel() })
      : window.i18n.t('undoBulkTitle');
  });
  gUndoBulkBtn.addEventListener('click', () => {
    undoLastBulk(() => {
      renderGlossaryRows();
      refreshGlossaryProgress();
      scheduleGlossaryAutoSave();
    });
  });
}

export const gCleanBrokenBtn = document.getElementById('g-clean-broken');
if (gCleanBrokenBtn) {
  gCleanBrokenBtn.addEventListener('click', () => {
    const broken = [];
    for (const en of Object.keys(gState.translations)) {
      const uk = gState.translations[en];
      if (!uk) continue;
      if (!validateTokens(en, uk).ok) broken.push(en);
    }
    if (!broken.length) {
      toast(window.i18n.t('toastValidateClean', { n: Object.keys(gState.translations).length }), 'success', 4000);
      return;
    }
    const sample = broken.slice(0, 3).map(en => '• ' + en.slice(0, 60) + (en.length > 60 ? '…' : ''));
    const msg = window.i18n.t('confirmCleanBroken', { n: broken.length }) +
      '\n\n' + sample.join('\n') +
      (broken.length > 3 ? '\n…' : '');
    if (!confirm(msg)) return;
    snapshotGlossary(window.i18n.t('cleanBroken'));
    for (const en of broken) delete gState.translations[en];
    gState.dirty = true;
    renderGlossaryRows();
    refreshGlossaryProgress();
    scheduleGlossaryAutoSave();
    toast(window.i18n.t('toastCleanBrokenDone', { n: broken.length }), 'success', 5000);
  });
}

// =====================================================================
// Glossary TXT export/import — людино-читабельний формат для роботи поза
// програмою. Блок-структура:
//   [#N]
//   --- EN ---
//   <ключ> (з реальними переносами, {lf} перетворюється на \n)
//   --- UK ---
//   <переклад>
//   === END ===
// На імпорт реальні переноси у UK-секції зворотно конвертуються в {lf}
// (якщо користувач не залишив {lf} власноруч).
// =====================================================================
export function buildGlossaryTxt() {
  const out = [];
  const entries = Object.entries(gState.translations).filter(([_, uk]) => uk && uk.trim());
  out.push('# KH1 Glossary Export');
  out.push('# Total: ' + entries.length + ' entries');
  out.push('# ');
  out.push('# Інструкція:');
  out.push('#  • Редагуй ЛИШЕ блоки --- UK ---. EN — це ключ, не змінювати.');
  out.push('#  • Багаторядковий UK — пиши як є, реальні переноси конвертуються у {lf}.');
  out.push('#  • Токени типу {0x04}, {VarItem}, {ColorRed}, {0x06,0x3C} лишай як є.');
  out.push('#  • Якщо UK порожній — запис пропускається при імпорті.');
  out.push('# ============================================================');
  out.push('');
  for (let i = 0; i < entries.length; i++) {
    const [en, uk] = entries[i];
    out.push('[#' + (i + 1) + ']');
    out.push('--- EN ---');
    out.push(en.replace(/\{lf\}/g, '\n'));
    out.push('--- UK ---');
    out.push(uk.replace(/\{lf\}/g, '\n'));
    out.push('=== END ===');
    out.push('');
  }
  return out.join('\n');
}

// buildGlossaryTxtAppend(existing, keys, translations) → { content, added, translated }
// Лишає наявний .txt як є і дописує в кінець блоки для EN-ключів, яких у ньому
// немає: нумерація продовжується від максимального [#N]; UK — поточний переклад
// або порожньо (порожній UK при імпорті пропускається, тож round-trip безпечний).
export function buildGlossaryTxtAppend(existing, keys, translations) {
  const have = new Set(parseGlossaryTxt(existing, { keepEmptyUk: true }).pairs.map(p => p.en));
  let maxN = 0;
  for (const m of existing.matchAll(/^\[#(\d+)\]\s*$/gm)) maxN = Math.max(maxN, Number(m[1]));
  const out = [];
  let added = 0, translated = 0;
  for (const en of keys) {
    if (!en || have.has(en)) continue;
    have.add(en);
    const uk = (translations && translations[en]) || '';
    out.push('[#' + (++maxN) + ']');
    out.push('--- EN ---');
    out.push(en.replace(/\{lf\}/g, '\n'));
    out.push('--- UK ---');
    out.push(uk.replace(/\{lf\}/g, '\n'));
    out.push('=== END ===');
    out.push('');
    added++;
    if (uk) translated++;
  }
  if (!added) return { content: existing, added: 0, translated: 0 };
  const base = existing.replace(/\r\n/g, '\n');
  const sep = base.endsWith('\n\n') ? '' : (base.endsWith('\n') ? '\n' : '\n\n');
  return { content: base + sep + out.join('\n'), added, translated };
}

export function parseGlossaryTxt(content, opts) {
  // Повертає { pairs: [{en, uk}], errors: [...] }
  const pairs = [];
  const errors = [];
  const lines = content.split(/\r?\n/);

  let blockOpen = false;
  let section = null; // 'en' | 'uk'
  let enLines = [];
  let ukLines = [];

  function commitBlock() {
    if (!blockOpen) return;
    // НЕ трімимо взагалі — повністю довіряємо TXT-вмісту. Бо trailing space
    // перед {lf} (типу "Tired? {lf}{0x0B}") — це РЕАЛЬНА частина оригіналу
    // гри, і будь-який trim його з'їсть. А export → import має бути lossless.
    let en = enLines.join('\n');
    let uk = ukLines.join('\n');
    // Реальні переноси → {lf} (якщо користувач не лишив {lf} вручну)
    if (en && !en.includes('{lf}') && en.includes('\n')) en = en.replace(/\r?\n/g, '{lf}');
    if (uk && !uk.includes('{lf}') && uk.includes('\n')) uk = uk.replace(/\r?\n/g, '{lf}');
    if (en && (uk || (opts && opts.keepEmptyUk))) pairs.push({ en, uk });
    blockOpen = false;
    section = null;
    enLines = [];
    ukLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith('#') && !blockOpen) continue; // коментарі поза блоками

    if (/^\[#\d+\]\s*$/.test(ln)) {
      commitBlock();
      blockOpen = true;
      continue;
    }
    if (ln.trim() === '--- EN ---') { section = 'en'; continue; }
    if (ln.trim() === '--- UK ---') { section = 'uk'; continue; }
    if (ln.trim() === '=== END ===') { commitBlock(); continue; }

    if (section === 'en') enLines.push(ln);
    else if (section === 'uk') ukLines.push(ln);
  }
  commitBlock(); // на випадок якщо файл закінчується без === END ===
  return { pairs, errors };
}

export const gAppendTxtBtn = document.getElementById('g-append-txt');
if (gAppendTxtBtn) {
  gAppendTxtBtn.addEventListener('click', async () => {
    const keys = (gState.entries || []).map(e => e.english);
    if (!keys.length) { toast(window.i18n.t('toastAppendTxtNeedIndex'), 'info', 5000); return; }
    try {
      const r = await window.kh1.translate.importFileTxt();
      if (r.canceled) return;
      if (r.error) { toast(window.i18n.t('toastImportError', {msg: r.error}), 'error', 6000); return; }
      const res = buildGlossaryTxtAppend(r.content, keys, gState.translations);
      if (!res.added) { toast(window.i18n.t('toastAppendTxtNothing', { n: keys.length }), 'info', 5000); return; }
      // Запис — лише через діалог збереження: користувач сам вирішує, куди (за
      // замовчуванням — той самий файл).
      const name = (r.filePath || 'kh1_glossary.txt').split(/[\\/]/).pop();
      const w = await window.kh1.translate.exportFileTxt({ defaultName: name, content: res.content });
      if (w.canceled) return;
      if (w.error) { toast(window.i18n.t('toastExportError', {msg: w.error}), 'error', 6000); return; }
      toast(window.i18n.t('toastAppendTxtDone', { n: res.added, t: res.translated, path: w.filePath }), 'success', 7000);
    } catch (e) {
      toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
    }
  });
}

export const gFixStructureBtn = document.getElementById('g-fix-structure');
if (gFixStructureBtn) {
  gFixStructureBtn.addEventListener('click', () => {
    if (!Object.keys(gState.translations).length) {
      toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
    }
    const fixable = [];
    let unfixable = 0;
    for (const en of Object.keys(gState.translations)) {
      const uk = gState.translations[en];
      if (!uk) continue;
      const fixed = autoFixStructure(en, uk);
      if (fixed === null) {
        // Перевіряємо чи воно потребує виправлення (інакше unfixable не лічимо).
        if (!validateTokens(en, uk).ok) unfixable++;
      } else if (fixed !== uk) {
        fixable.push({ en, oldUk: uk, newUk: fixed });
      }
    }
    if (!fixable.length && !unfixable) {
      toast(window.i18n.t('toastFixStructureNothing'), 'info', 4000);
      return;
    }
    const sample = fixable.slice(0, 3).map(c => '• ' + c.en.slice(0, 50) + (c.en.length > 50 ? '…' : ''));
    let msg = window.i18n.t('confirmFixStructure', { n: fixable.length });
    if (sample.length) msg += '\n\n' + sample.join('\n') + (fixable.length > 3 ? '\n…' : '');
    if (unfixable) msg += '\n\n' + window.i18n.t('confirmFixStructureUnfixable', { n: unfixable });
    if (!fixable.length) {
      // Тільки unfixable — повідомляємо без confirm.
      toast(window.i18n.t('toastFixStructureUnfixable', { n: unfixable }), 'error', 6000);
      return;
    }
    if (!confirm(msg)) return;
    snapshotGlossary(window.i18n.t('fixStructure'));
    for (const c of fixable) gState.translations[c.en] = c.newUk;
    gState.dirty = true;
    renderGlossaryRows();
    refreshGlossaryProgress();
    scheduleGlossaryAutoSave();
    let toastMsg = window.i18n.t('toastFixStructureDone', { n: fixable.length });
    if (unfixable) toastMsg += ' · ' + window.i18n.t('toastFixStructureRemaining', { n: unfixable });
    toast(toastMsg, 'success', 6000);
  });
}

export const gSyncPaddingBtn = document.getElementById('g-sync-padding');
if (gSyncPaddingBtn) {
  gSyncPaddingBtn.addEventListener('click', () => {
    if (!Object.keys(gState.translations).length) {
      toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
    }
    const candidates = [];
    for (const en of Object.keys(gState.translations)) {
      const uk = gState.translations[en];
      if (!uk) continue;
      const fixed = syncPaddingFromEn(en, uk);
      if (fixed && fixed !== uk) candidates.push({ en, oldUk: uk, newUk: fixed });
    }
    if (!candidates.length) {
      toast(window.i18n.t('toastSyncPaddingNothing'), 'info', 4000);
      return;
    }
    const sample = candidates.slice(0, 3).map(c => '• ' + c.en.slice(0, 50) + (c.en.length > 50 ? '…' : ''));
    const msg = window.i18n.t('confirmSyncPadding', { n: candidates.length }) +
      '\n\n' + sample.join('\n') +
      (candidates.length > 3 ? '\n…' : '');
    if (!confirm(msg)) return;
    snapshotGlossary(window.i18n.t('syncPadding'));
    for (const c of candidates) gState.translations[c.en] = c.newUk;
    gState.dirty = true;
    renderGlossaryRows();
    refreshGlossaryProgress();
    scheduleGlossaryAutoSave();
    toast(window.i18n.t('toastSyncPaddingDone', { n: candidates.length }), 'success', 5000);
  });
}

export const gExportTxtBtn = document.getElementById('g-export-txt');
export const gImportTxtBtn = document.getElementById('g-import-txt');

if (gExportTxtBtn) {
  gExportTxtBtn.addEventListener('click', async () => {
    if (!Object.keys(gState.translations).length) {
      toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
    }
    const content = buildGlossaryTxt();
    try {
      const r = await window.kh1.translate.exportFileTxt({
        defaultName: 'kh1_glossary.txt',
        content
      });
      if (r.canceled) return;
      if (r.error) { toast(window.i18n.t('toastExportError', {msg: r.error}), 'error', 6000); return; }
      toast(window.i18n.t('toastExportedTxt', {path: r.filePath, n: r.byteLength}), 'success', 5000);
    } catch (e) {
      toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
    }
  });
}

if (gImportTxtBtn) {
  gImportTxtBtn.addEventListener('click', async () => {
    try {
      const r = await window.kh1.translate.importFileTxt();
      if (r.canceled) return;
      if (r.error) { toast(window.i18n.t('toastImportError', {msg: r.error}), 'error', 6000); return; }
      const parsed = parseGlossaryTxt(r.content);
      if (!parsed.pairs.length) {
        toast(window.i18n.t('toastNoValidPairs'), 'error'); return;
      }
      // Застосовуємо з token-guard (як HTML-імпорт): пропускаємо пари з втратою
      // не-{lf} токенів, щоб не переписати глосарій сміттям з помилок перекладача.
      let added = 0, updated = 0, unchanged = 0, tokensBroken = 0;
      snapshotGlossary(window.i18n.t('importTxt'));
      const legacy = legacyKeyMap();
      const lookalike = lookalikeKeyMap();
      let remapped = 0;
      for (const p0 of parsed.pairs) {
        // Старий ключ → новий: u16-параметри 05/06/07 (legacyKey) або кириличні
        // «двійники» латиниці у EN зі старих overlay-експортів.
        const hit = (!gState.translations[p0.en] && !lookalike.has(p0.en)) ? resolveImportedKey(p0.en, legacy, lookalike) : null;
        const p = hit ? { en: hit.english, uk: hit.legacyKey ? upgradeLegacyUk(hit, p0.uk) : p0.uk } : p0;
        if (hit) remapped++;
        if (!validateTokens(p.en, p.uk).ok) { tokensBroken++; continue; }
        const cur = gState.translations[p.en];
        if (cur === p.uk) { unchanged++; continue; }
        if (cur === undefined || cur === null || cur === '') {
          gState.translations[p.en] = p.uk;
          added++;
        } else {
          gState.translations[p.en] = p.uk;
          updated++;
        }
      }
      if (added || updated) {
        gState.dirty = true;
        renderGlossaryRows();
        refreshGlossaryProgress();
        scheduleGlossaryAutoSave();
      }
      const parts = [];
      if (added) parts.push(window.i18n.t('toastTxtImportAdded', { n: added }));
      if (remapped) parts.push(window.i18n.t('toastTxtImportRemapped', { n: remapped }));
      if (updated) parts.push(window.i18n.t('toastTxtImportUpdated', { n: updated }));
      if (unchanged) parts.push(window.i18n.t('toastTxtImportUnchanged', { n: unchanged }));
      if (tokensBroken) parts.push(window.i18n.t('toastTxtImportTokensBroken', { n: tokensBroken }));
      toast(parts.join(' · ') || window.i18n.t('toastTxtImportEmpty'), 'success', 6500);
    } catch (e) {
      toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
    }
  });
}
