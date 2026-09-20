import { getCurrentGame, getCurrentGameId } from '../app-shell.js';
import { gBuild, gComposeAll, gDashBarFill, gDashDone, gDashIssues, gDashPct, gDashSameEn, gDashTotal, gDashUntrans, gDashboard, gFilterMode, gRows, gSave, gStat, tProgress, tStatus } from '../core/dom.js';
import { toast } from '../core/log.js';
import { autoFixStructure, syncPaddingFromEn, tokenIssueText, validateTokens } from '../core/shared.js';
import { gState, tState } from '../core/state.js';
import { kState } from '../kerning/kerning.js';
import { openSettings } from '../settings-modal.js';
import { flushGlossaryAutoSave, scheduleGlossaryAutoSave, setOpProgress } from './files.js';
import { snapshotGlossary, undoLastBulk, canUndoBulk, lastBulkLabel, onHistoryChange } from './history.js';
import { buildGlossaryTxtMgs, buildGlossaryTxtMgsAppend, looksLikeMgsTxt, parseGlossaryTxtMgs } from './glossary-txt-mgs.js';

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

// force — перебудувати, ігноруючи кеш індексу (кнопка «Побудувати / оновити»).
export async function buildGlossary(force) {
  if (gState.busy) return;
  // Обов'язкова лише ENG-тека; MYFILES (rusDir) для KH1 опційна — є вбудований еталон.
  const requiredDirs = ['engDir'];
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
  setOpProgress(window.i18n.t('gScanning'));

  try {
    const r = await window.kh1.translate.buildGlossary({
      engDir: tState.settings.engDir,
      rusDir: tState.settings.rusDir,
      files: tState.files.map(f => f.rel),
      // сигнатура для кешу індексу (rel + розмір + mtime): без змін у ENG — миттєво
      filesMeta: tState.files.map(f => ({ rel: f.rel, size: f.size, mtimeMs: f.mtimeMs })),
      useCache: !force,
      safeMode: tState.safeMode
    });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }

    gState.entries = r.entries || [];
    const migrated = migrateLegacyKeys();
    renderGlossaryRows();
    refreshGlossaryProgress();
    const parts = [window.i18n.t('gBuiltSummary', { n: gState.entries.length })];
    if (migrated) parts.push(window.i18n.t('gMigratedKeys', { n: migrated }));
    parts.push(r.cached ? window.i18n.t('gFromCache') : window.i18n.t('gProcessed', { n: r.processed }));
    if (r.skipped) parts.push(window.i18n.t('gSkipped', { n: r.skipped }));
    if (r.skippedUnsafe) parts.push(window.i18n.t('gSkippedUnsafe', { n: r.skippedUnsafe }));
    toast(parts.join(' · '), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  } finally {
    gState.busy = false;
    gBuild.disabled = false;
    tProgress.classList.remove('busy');
    setOpProgress('');
    refreshGlossaryProgress();
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
// Старі експорти також не мали пробілів навколо {lf} і на початку рядка
// (« All right!», «I'd better {lf}get busy») — нормалізуємо пробіли для пошуку;
// при збірці preserveStructure відновлює провідні/кінцеві пробіли з EN.
export function normalizeKeyWs(s) {
  return s.replace(/ +\{lf\}/g, '{lf}').replace(/\{lf\} +/g, '{lf}').replace(/^ +| +$/g, '');
}
const stripEol = (s) => s.replace(/\{eol\}$/, '');
export function lookalikeKeyMap() {
  // Порядок вставки: точні ключі перші; варіанти без {eol} і з нормалізованими
  // пробілами — лише якщо ще не зайняті (щоб не перекрити точніший збіг).
  const m = new Map();
  const put = (k, e) => { if (!m.has(k)) m.set(k, e); };
  for (const e of gState.entries || []) m.set(e.english, e);
  for (const e of gState.entries || []) { put(normalizeKeyWs(e.english), e); }
  for (const e of gState.entries || []) { put(stripEol(e.english), e); put(stripEol(normalizeKeyWs(e.english)), e); }
  return m;
}
export function resolveImportedKey(en, legacy, lookalike) {
  if (legacy.has(en)) return legacy.get(en);
  const lat = /[А-Яа-яІіЇїЄєҐґ]/.test(en) ? latinizeLookalikes(en) : en;
  const nk = normalizeKeyWs(lat);
  return lookalike.get(lat) || lookalike.get(nk) || lookalike.get(stripEol(lat)) || lookalike.get(stripEol(nk)) || null;
}
// Якщо знайдений ключ закінчується на {eol} (ev/evdl/mes_ofs), а UK зі старого
// експорту — ні, додаємо {eol}, інакше token-guard відкине пару.
export function alignEol(entryKey, uk) {
  if (/\{eol\}$/.test(entryKey) && !/\{eol\}$/.test(uk)) return uk + '{eol}';
  if (!/\{eol\}$/.test(entryKey) && /\{eol\}$/.test(uk)) return uk.replace(/\{eol\}$/, '');
  return uk;
}
// Пари токенів старий→новий і переписування UK живуть у shared/text-structure.js
// (той самий код у main при compose).
export const legacyTokenPairs = (newKey, oldKey) => window.KH.textStructure.legacyTokenPairs(newKey, oldKey);
export function upgradeLegacyUk(entry, uk) {
  if (!uk || !entry.legacyKey) return uk;
  return window.KH.textStructure.upgradeLegacyUk(entry.english, entry.legacyKey, uk);
}
// Підтягнути переклади для ключів індексу, у яких у глосарії є лише «сусідня»
// форма: (1) старі 2-байтові 05/06/07-токени (legacyKey); (2) той самий рядок
// з/без хвостового {eol} — ev-файли додають термінатор, binl ні. Це те саме
// зшивання, що робить compose у main (glossaryLookup), тож лічильник і список
// показують те, що реально збереться.
export function migrateLegacyKeys() {
  let n = 0;
  const tr = gState.translations;
  for (const e of gState.entries || []) {
    const cur = tr[e.english];
    if (cur !== undefined && cur !== '') continue;
    if (e.legacyKey && e.legacyKey !== e.english && tr[e.legacyKey]) {
      tr[e.english] = upgradeLegacyUk(e, tr[e.legacyKey]); n++; continue;
    }
    const viaEol = window.KH.textStructure.lookupEolVariant(tr, e.english);
    if (viaEol) { tr[e.english] = viaEol; n++; }
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

// =====================================================================
// Рендер списку — порціями. 16k рядків × textarea = ~115k DOM-вузлів і
// пів секунди на кожен перерендер; натомість тримаємо відсортований і
// відфільтрований порядок індексів (_order) і домальовуємо по CHUNK рядків,
// коли прокрутка наближається до кінця. Фільтр — по заздалегідь
// нормалізованому тексту (entry._norm), тож пошук по 16k рядків — мілісекунди.
// =====================================================================
const CHUNK = 120;
let _order = [];       // індекси gState.entries у порядку показу (після сортування+фільтра)
let _rendered = 0;     // скільки з _order уже в DOM

function buildRow(i) {
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
  // крапка статусу (колір через CSS за класами рядка) + бейдж входжень
  const dot = document.createElement('i');
  dot.className = 't-dot';
  const cnt = document.createElement('span');
  cnt.className = 't-count';
  cnt.textContent = '× ' + entry.count;
  cnt.title = window.i18n.t('gInFiles', { n: entry.fileCount });
  meta.appendChild(dot);
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

  // файл першого входження (+N інших) — колонка «Файл»
  const file = document.createElement('div');
  file.className = 't-file';
  const rel = entry.file || (entry.occurrences && entry.occurrences[0] && entry.occurrences[0].rel) || '';
  const base = rel ? String(rel).split(/[\\/]/).pop() : '';
  file.textContent = base + (entry.fileCount > 1 ? ' +' + (entry.fileCount - 1) : '');
  file.title = rel;

  row.appendChild(meta);
  row.appendChild(en);
  row.appendChild(uk);
  row.appendChild(file);
  return row;
}

function entryVisible(entry, search, mode) {
  if (search) {
    if (entry._norm === undefined) entry._norm = normalizeLookalikes(entry.english);
    if (entry._norm.indexOf(search) === -1) return false;
  }
  if (mode === 'all') return true;
  const uk = gState.translations[entry.english] || '';
  if (mode === 'untranslated') return !uk;
  if (mode === 'translated') return !!uk;
  if (mode === 'same-as-en') return uk === entry.english;
  if (mode === 'token-issues') return !!uk && !validateTokens(entry.english, uk).ok;
  return true;
}

function appendChunk() {
  if (_rendered >= _order.length) return;
  const frag = document.createDocumentFragment();
  const end = Math.min(_order.length, _rendered + CHUNK);
  for (let k = _rendered; k < end; k++) frag.appendChild(buildRow(_order[k]));
  _rendered = end;
  const sentinel = gRows.querySelector('.t-more');
  if (sentinel) sentinel.remove();
  gRows.appendChild(frag);
  if (_rendered < _order.length) {
    const more = document.createElement('div');
    more.className = 't-more';
    more.textContent = window.i18n.t('gMoreRows', { n: _order.length - _rendered });
    gRows.appendChild(more);
  }
}

function maybeAppendOnScroll() {
  if (_rendered >= _order.length) return;
  if (gRows.scrollTop + gRows.clientHeight >= gRows.scrollHeight - 900) appendChunk();
}
gRows.addEventListener('scroll', maybeAppendOnScroll);

// Повний перерендер: порядок (сортування) → фільтр → перша порція.
export function renderGlossaryRows() {
  while (gRows.firstChild) gRows.removeChild(gRows.firstChild);
  _order = [];
  _rendered = 0;
  if (!gState.entries.length) {
    const div = document.createElement('div');
    div.className = 't-empty';
    const p = document.createElement('p');
    p.textContent = window.i18n.t('gEmptyHint');
    div.appendChild(p);
    gRows.appendChild(div);
    return;
  }
  const search = normalizeLookalikes(gState.filter.search || '');
  const mode = gState.filter.mode || 'all';
  const order = getGlossaryRenderOrder();
  for (const i of order) if (entryVisible(gState.entries[i], search, mode)) _order.push(i);
  if (!_order.length) {
    const div = document.createElement('div');
    div.className = 't-empty';
    const p = document.createElement('p');
    p.textContent = window.i18n.t('gNoMatches');
    div.appendChild(p);
    gRows.appendChild(div);
    return;
  }
  gRows.scrollTop = 0;
  appendChunk();
  // якщо перша порція не заповнила видиму область — домалювати ще
  maybeAppendOnScroll();
}

// Кирилично-латинські look-alike — у KH1 один і той самий гліф у шрифті
// має той самий байт, тому старі експорти дають Cyrillic-look замість Latin
// (P→Р, o→о, p→р тощо). Нормалізуємо обидва напрямки до Latin для пошуку,
// щоб «Press» матчив і «Рress».
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

// Фільтр/пошук — той самий перерендер (порядок + фільтр + перша порція).
export function applyGlossaryFilter() {
  renderGlossaryRows();
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

  tStatus.textContent = window.i18n.t(gState.dirty ? 'gStatusUnsaved' : 'gStatusSaved');

  gSave.disabled = !tState.settings.tsvDir;
  // compose precondition: ENG + DONE (MYFILES опційна для всіх ігор)
  gComposeAll.disabled = total === 0 || done === 0 ||
    !tState.settings.engDir || !tState.settings.outDir;
}

// «Знайти поламані рядки» у меню Перевірка — це фільтр «З проблемами токенів».
const gShowBroken = document.getElementById('g-show-broken');
if (gShowBroken) gShowBroken.addEventListener('click', () => {
  gFilterMode.value = 'token-issues';
  gFilterMode.dispatchEvent(new Event('change', { bubbles: true }));
});

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
  // Потрібні engDir + outDir; MYFILES (rusDir) опційна.
  if (!tState.settings.engDir || !tState.settings.outDir) {
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
      safeMode: tState.safeMode,
      outLayout: 'patch',
      gameId: getCurrentGameId()
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
    setOpProgress('');
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
// Ім'я txt-глосарію за грою: kh1_glossary.txt, recom_glossary.txt, bbs_…, ddd_….
const GLOSSARY_TXT_PREFIX = { 'kh1-final-mix': 'kh1', 'kh-re-com': 'recom', 'kh-bbs-final-mix': 'bbs', 'kh-ddd': 'ddd' };
function glossaryTxtName() {
  const prefix = GLOSSARY_TXT_PREFIX[getCurrentGameId()] || String(getCurrentGameId() || 'kh');
  // BBS/Re:CoM/DDD — формат MGS1: один файл перекладу гри (bbs.txt), KH1 — kh1_glossary.txt
  return isMgsTxtGame() ? prefix + '.txt' : prefix + '_glossary.txt';
}
function isMgsTxtGame() { const g = getCurrentGame(); return !!(g && g.txtFormat === 'mgs'); }

// Ключ з txt → ключ індексу: у заголовку MGS-формату переноси показані як ⏎ і
// відновлюються як '\n'; ключі KH1 містять {lf} — пробуємо обидва варіанти.
function resolveTxtKey(en) {
  if (Object.prototype.hasOwnProperty.call(gState.translations, en) || (gState.entries || []).some(e => e.english === en)) return en;
  const lf = en.replace(/\n/g, '{lf}');
  if (lf !== en && (gState.entries || []).some(e => e.english === lf)) return lf;
  return en;
}

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
  // Усі рядки індексу (у порядку списку) з поточним перекладом або порожнім UK —
  // щоб перекладати у txt і те, чого ще нема. Якщо індекс не побудовано —
  // лише наявні переклади.
  let entries;
  if (gState.entries && gState.entries.length) {
    const seen = new Set();
    entries = [];
    for (const e of gState.entries) {
      if (seen.has(e.english)) continue;
      seen.add(e.english);
      entries.push([e.english, gState.translations[e.english] || '']);
    }
    for (const [en, uk] of Object.entries(gState.translations)) {
      if (!seen.has(en) && uk && uk.trim()) { seen.add(en); entries.push([en, uk]); }
    }
  } else {
    entries = Object.entries(gState.translations).filter(([_, uk]) => uk && uk.trim());
  }
  const translated = entries.filter(([_, uk]) => uk && uk.trim()).length;
  const game = getCurrentGame();
  out.push('# ' + (game ? game.name : 'KH') + ' — Glossary Export');
  out.push('# Total: ' + entries.length + ' entries, translated: ' + translated);
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
    // Кривий маркер кінця блоку, що потрапив у текст (старі експорти з опискою).
    uk = uk.replace(/\n?=+\s*END\s*=+\s*$/i, '');
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
    if (/^=+\s*END\s*=+$/i.test(ln.trim())) { commitBlock(); continue; }   // толерантно до «=== END ==»

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
      const res = looksLikeMgsTxt(r.content) || (isMgsTxtGame() && !/^\[#\d+\]/m.test(r.content))
        ? buildGlossaryTxtMgsAppend(r.content, gState.entries, gState.translations)
        : buildGlossaryTxtAppend(r.content, keys, gState.translations);
      if (!res.added) { toast(window.i18n.t('toastAppendTxtNothing', { n: keys.length }), 'info', 5000); return; }
      // Запис — лише через діалог збереження: користувач сам вирішує, куди (за
      // замовчуванням — той самий файл).
      const name = (r.filePath || glossaryTxtName()).split(/[\\/]/).pop();
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
    if (isMgsTxtGame() && !(gState.entries && gState.entries.length)) {
      toast(window.i18n.t('toastAppendTxtNeedIndex'), 'info', 5000); return;
    }
    if (!isMgsTxtGame() && !Object.keys(gState.translations).length && !(gState.entries && gState.entries.length)) {
      toast(window.i18n.t('toastEmptyGlossary'), 'info'); return;
    }
    const gameName = (getCurrentGame() && getCurrentGame().name) || 'KH';
    const content = isMgsTxtGame() ? buildGlossaryTxtMgs(gState.entries, gState.translations, gameName) : buildGlossaryTxt();
    try {
      const r = await window.kh1.translate.exportFileTxt({
        defaultName: glossaryTxtName(),
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
      const parsed = looksLikeMgsTxt(r.content) ? parseGlossaryTxtMgs(r.content) : parseGlossaryTxt(r.content);
      if (looksLikeMgsTxt(r.content)) {
        // ключі з ⏎ → '\n' або {lf} — як в індексі
        parsed.pairs = parsed.pairs.map(p => { const en = resolveTxtKey(p.en); return en === p.en ? p : { en, uk: /\{lf\}/.test(en) ? p.uk.replace(/\n/g, '{lf}') : p.uk }; });
      }
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
        const p = hit ? { en: hit.english, uk: alignEol(hit.english, hit.legacyKey ? upgradeLegacyUk(hit, p0.uk) : p0.uk) } : p0;
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

// «Встановити DONE у гру» — лише KH1: DONE → kh1_first.hed_out (remastered/ + original/exchange/).
export const gInstallDoneBtn = document.getElementById('g-install-done');
// Кнопки лише для KH1: «Встановити DONE у гру» і «Дописати відсутні у .txt»
// (формат [#N]/--- EN ---/--- UK ---/=== END === — робочий txt-глосарій KH1).
export function refreshInstallDoneVisibility() {
  const notKh1 = getCurrentGameId() !== 'kh1-final-mix';
  if (gInstallDoneBtn) gInstallDoneBtn.hidden = notKh1;
  if (gAppendTxtBtn) gAppendTxtBtn.hidden = false;
}
if (gInstallDoneBtn) {
  gInstallDoneBtn.addEventListener('click', async () => {
    let gameDir = '';
    try { const st = await window.kh1.setup.status(); gameDir = (st && st.gameDirectories && st.gameDirectories['kh1-final-mix']) || ''; } catch (_) {}
    if (!gameDir) { toast(window.i18n.t('toastInstallDoneNoGame'), 'error', 6000); return; }
    let backupDir = '';
    try { const d = await window.kh1.uafonts.defaults('kh1-final-mix'); backupDir = d.backupDir.replace(/FONTS/, 'BACKUP'); } catch (_) {}
    if (!window.confirm(window.i18n.t('installDoneConfirm', { b: backupDir }))) return;
    gInstallDoneBtn.disabled = true;
    try {
      const r = await window.kh1.app.installDone({ doneDir: tState.settings.outDir, gameDir, backupDir });
      if (!r.ok) toast((r.error || (r.errors || []).slice(0, 3).join('; ')), 'error', 9000);
      else toast(window.i18n.t('toastInstallDone', { n: r.copied, t: r.target, b: r.backedUp }) + (r.skipped ? ' · пропущено: ' + r.skipped : ''), 'success', 9000);
    } catch (e) {
      toast(window.i18n.t('toastError', { msg: e.message }), 'error', 6000);
    } finally { gInstallDoneBtn.disabled = false; }
  });
}
