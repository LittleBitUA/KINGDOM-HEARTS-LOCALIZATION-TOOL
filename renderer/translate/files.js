import { getCurrentGame, getCurrentGameFormats, getCurrentGameId } from '../app-shell.js';
import { gBuild, gComposeAll, gFilterMode, gImport, gSave, gSearch, gSortMode, subviewFiles, subviewGlossary, tAutoWrapBtn, tCompose, tExportTxt, tFileSel, tFilterMode, tImportTxt, tMaxWidthInput, tProgress, tReload, tRows, tSafeMode, tSaveTsv, tSearchInput, tSettingsBtn, tStatus, tabFiles, tabGlossary } from '../core/dom.js';
import { toast } from '../core/log.js';
import { patchOutRel, preserveStructure, tokenIssueText, tsvFormat } from '../core/shared.js';
import { gState, tState } from '../core/state.js';
import { kState } from '../kerning/kerning.js';
import { openSettings } from '../settings-modal.js';
import { applyGlossaryFilter, buildGlossary, composeAllFiles, loadGlossaryFromDisk, refreshGlossaryProgress, renderGlossaryRows, saveGlossary } from './glossary.js';
import { importTranslations } from './import.js';
import { joinPath } from './replace.js';

// =====================================================================
// Translate mode
// =====================================================================
export async function initTranslateMode() {
  try {
    tState.settings = await window.kh1.translate.getSettings(getCurrentGameId()) || tState.settings;
  } catch (_) {}

  // Source dir для списку файлів — для KH1 це rusDir, для BBS це engDir.
  const game = getCurrentGame();
  const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
  if (!tState.settings[sourceDirKey]) {
    tStatus.textContent = window.i18n.t('tStatusConfigure');
    openSettings();
    return;
  }

  await loadWorldsMap();
  await loadFileList();
  await loadGlossaryFromDisk();

  // BBS / Re:CoM / DDD: один список усіх рядків (вкладка «Файли» = колишній
  // глосарій), без окремої per-file вкладки.
  const single = !!(game && game.singleList);
  const view = document.getElementById('view-translate');
  if (view) view.classList.toggle('single-list', single);
  if (single) setSubtab('glossary');

  // Авто-відновлення останнього файлу
  const last = tState.settings.lastFile;
  if (!single && last && tState.files.some(f => f.rel === last)) {
    tFileSel.value = last;
    await loadFile(last);
  }
  // Індекс не зберігається між запусками — будуємо у фоні, щоб прогрес і список
  // були одразу (для single-list ігор це і є робочий екран).
  if (!gState.entries.length && tState.files.length && tState.settings.engDir) {
    buildGlossary().catch(() => {});
  }
}

// Завантаження карти світів (.ard → world / room name)
export let _worldsMap = null;
export async function loadWorldsMap() {
  if (_worldsMap) return _worldsMap;
  try {
    const r = await window.kh1.translate.getWorldsMap();
    if (r && r.ok) _worldsMap = r.map;
  } catch (_) {}
  return _worldsMap || {};
}
export function describeFile(rel) {
  if (!_worldsMap) return null;
  // `kh1_second/al01.ard/…` → світ шукаємо за `al01.ard`
  const inner = window.KH.textStructure.kh1StripArchive(rel);
  const seg = (inner.split('/')[0] || '').toLowerCase();
  return _worldsMap[seg] || null;
}
// Номер «набору» кімнати (gg3502 docs/ard_evdl_binl.md): `*_xx01_ard<N>.evdl` ↔
// `*_xx01_ard<0x3E8+N>.binl` — один набір скрипт+текст. Set 0 — основні діалоги,
// set 25 (ard401) є в кожній кімнаті. null, якщо ім'я не за схемою.
export function setNumberOf(rel) {
  const m = /_ard([0-9a-f]+)\.(binl|evdl)$/i.exec(rel);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const set = m[2].toLowerCase() === 'binl' ? v - 0x3E8 : v;
  return set >= 0 && set < 64 ? set : null;
}

// Дебаунсна запис позиції прокрутки в settings
export let _scrollSaveTimer = null;
export function scheduleScrollSave() {
  if (!tState.currentRel) return;
  if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
  _scrollSaveTimer = setTimeout(() => {
    _scrollSaveTimer = null;
    const map = Object.assign({}, tState.settings.scrollByFile || {});
    map[tState.currentRel] = tRows.scrollTop;
    tState.settings.scrollByFile = map;
    window.kh1.translate.saveSettings({ scrollByFile: map }).catch(() => {});
  }, 600);
}
tRows.addEventListener('scroll', scheduleScrollSave);

// =====================================================================
// Subtab switching
// =====================================================================
export function setSubtab(name) {
  tState.subtab = name;
  subviewFiles.classList.toggle('hidden', name !== 'files');
  subviewGlossary.classList.toggle('hidden', name !== 'glossary');
  tabFiles.classList.toggle('active', name === 'files');
  tabGlossary.classList.toggle('active', name === 'glossary');
  // Заголовок модуля і прогрес у header'і залежать від підвкладки.
  const view = document.getElementById('view-translate');
  if (view) view.classList.toggle('subtab-glossary', name === 'glossary');
  const title = document.getElementById('t-module-title');
  if (title) {
    const single = !!(getCurrentGame() && getCurrentGame().singleList);
    const key = (name === 'glossary' && !single) ? 'tabGlossary' : 'tabFiles';
    title.setAttribute('data-i18n', key);
    title.textContent = window.i18n ? window.i18n.t(key) : (key === 'tabGlossary' ? 'Глосарій' : 'Файли');
  }
  if (name === 'glossary') refreshGlossaryProgress();
  else refreshProgress();
}

export async function loadFileList() {
  const game = getCurrentGame();
  const sourceDirKey = (game && game.sourceDirKey) || 'rusDir';
  const sourceDir = tState.settings[sourceDirKey];
  if (!sourceDir) return;
  try {
    const r = await window.kh1.translate.listFiles(sourceDir);
    tState.files = (r.files || []).slice().sort((a, b) => a.rel.localeCompare(b.rel));
  } catch (e) {
    tState.files = [];
    toast(window.i18n.t('toastReadRusFail', {msg: e.message}), 'error');
  }

  // Two filters: (а) safe-mode → лише isTranslatable, (б) game-formats →
  // лише kind'и, що належать обраній грі (KH1 vs BBS).
  const gameFormats = getCurrentGameFormats();
  let visible = tState.safeMode
    ? tState.files.filter(f => f.isTranslatable)
    : tState.files;
  if (gameFormats && gameFormats.length) {
    visible = visible.filter(f => gameFormats.includes(f.kind));
  }

  while (tFileSel.firstChild) tFileSel.removeChild(tFileSel.firstChild);
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = window.i18n.t('selectFile');
  tFileSel.appendChild(blank);
  for (const f of visible) {
    const o = document.createElement('option');
    o.value = f.rel;
    const safety = f.isTranslatable ? '✓' : '⚠';
    const info = describeFile(f.rel);
    const filename = f.rel.split('/').pop();
    let label;
    const ard = (window.KH.textStructure.kh1StripArchive(f.rel).split('/')[0] || '').toLowerCase();
    if (info) {
      const room = info.room ? ' / ' + info.room : '';
      const set = setNumberOf(f.rel);
      const setLabel = set === null ? '' : ' · set ' + set;
      label = safety + ' [' + info.world + room + setLabel + ']  ' + ard + ' › ' + filename + '  (' + f.size + ' b)';
    } else {
      label = safety + '  ' + f.rel + '  (' + f.size + ' b)';
    }
    o.textContent = label;
    tFileSel.appendChild(o);
  }

  const allCount = tState.files.length;
  const safeCount = tState.files.filter(f => f.isTranslatable).length;
  const unsafeCount = allCount - safeCount;
  tStatus.textContent = tState.safeMode
    ? window.i18n.t('tStatusSafe', { safe: safeCount, unsafe: unsafeCount })
    : window.i18n.t('tStatusAll', { all: allCount, safe: safeCount });
}

tSafeMode.addEventListener('change', async (e) => {
  tState.safeMode = e.target.checked;
  if (!tState.safeMode) {
    if (!window.confirm(window.i18n.t('confirmUnsafeMode'))) {
      tSafeMode.checked = true;
      tState.safeMode = true;
      return;
    }
  }
  await loadFileList();
});

export async function loadFile(rel) {
  // Авто-зберегти попередній файл перед перемиканням, без діалогів.
  await flushTsvAutoSave();

  if (!tState.settings.engDir) {
    toast(window.i18n.t('toastConfigEng'), 'error');
    openSettings();
    return;
  }

  const engPath = joinPath(tState.settings.engDir, rel);
  // MYFILES опційна — без неї extract бере вбудований еталон.
  const rusPath = tState.settings.rusDir ? joinPath(tState.settings.rusDir, rel) : undefined;

  tStatus.textContent = window.i18n.t('tLoading', { rel });
  renderEmpty(window.i18n.t('tProcessing', { rel }));

  let r;
  try {
    r = await window.kh1.translate.extract({ engPath, rusPath, rusDir: tState.settings.rusDir || '', rel });
  } catch (e) {
    toast(window.i18n.t('toastExtractError', {msg: e.message}), 'error', 6000);
    renderEmpty(window.i18n.t('tLoadError'));
    return;
  }
  if (r.error) {
    toast(window.i18n.t('toastExtractError', {msg: r.error}), 'error', 6000);
    renderEmpty(window.i18n.t('tErrorPrefix', { msg: r.error }));
    return;
  }

  tState.slots = (r.slots || []).map(s => ({
    index: s.index,
    offset: s.offset,
    byteLen: s.byteLen,
    english: s.english,
    ukText: ''
  }));
  tState.currentRel = rel;
  tState.dirty = false;

  // 1) auto-fill from glossary (defaults)
  let glossFilled = 0;
  if (gState.translations && Object.keys(gState.translations).length) {
    for (const slot of tState.slots) {
      const uk = gState.translations[slot.english];
      if (uk && uk.trim() && !slot.ukText) { slot.ukText = uk; glossFilled++; }
    }
  }

  // 2) per-file TSV overrides (win over glossary)
  let tsvMerged = 0;
  if (tState.settings.tsvDir) {
    const tsvPath = joinPath(tState.settings.tsvDir, rel) + '.tsv';
    try {
      const tsvR = await window.kh1.translate.readTsv(tsvPath);
      if (tsvR.ok) {
        tsvMerged = mergeTsvIntoSlots(tsvR.content);
      }
    } catch (_) {}
  }

  // 3) stub-fill решти English-ом (зручніше редагувати ніж копіювати)
  let stubbed = 0;
  for (const slot of tState.slots) {
    if (!slot.ukText) { slot.ukText = slot.english; stubbed++; }
  }

  if (glossFilled || tsvMerged) {
    const parts = [];
    if (glossFilled) parts.push(window.i18n.t('tFromGlossary', { n: glossFilled }));
    if (tsvMerged) parts.push(window.i18n.t('tFromTsv', { n: tsvMerged }));
    toast(window.i18n.t('toastAutoFilled', {parts: parts.join(', ') + (stubbed ? ' · ' + window.i18n.t('tEnglishStubs', { n: stubbed }) : '')}), 'info');
  }

  renderRows();
  refreshProgress();

  // Запам'ятати як "останній файл" + відновити позицію прокрутки.
  // lastFile per-game (KH1 та BBS мають різні останні файли).
  tState.settings.lastFile = rel;
  window.kh1.translate.saveSettings({ lastFile: rel }, getCurrentGameId()).catch(() => {});
  const savedScroll = (tState.settings.scrollByFile || {})[rel];
  if (typeof savedScroll === 'number') {
    requestAnimationFrame(() => { tRows.scrollTop = savedScroll; });
  }
}

// Map offset → slot, перебудовується лінивo при зміні tState.slots
// (input-handler викликається на кожен keystroke — O(1) замість find()).
let _slotMap = null;
let _slotMapFor = null;
export function slotByOffset(off) {
  if (_slotMapFor !== tState.slots) {
    _slotMap = new Map(tState.slots.map(s => [s.offset, s]));
    _slotMapFor = tState.slots;
  }
  return _slotMap.get(off);
}

export function isRealTranslation(slot) {
  return !!(slot && slot.ukText && slot.ukText !== slot.english);
}

// =====================================================================
// Token validation: переконатись що UK-переклад зберіг всі контрольні
// токени з EN — {Color X}, {VarItem}, {0x04}, {lf}, {Triangle} тощо.
// Втрачений токен у грі = краш або порожнє місце.
// =====================================================================
// =====================================================================
// Auto-save: TSV (per-file) і Glossary, з дебаунсом
// =====================================================================
export const AUTOSAVE_DELAY_MS = 1500;
export let _tAutoSaveTimer = null;
export let _gAutoSaveTimer = null;
export function cancelAutoSaveTimers() {
  if (_tAutoSaveTimer) { clearTimeout(_tAutoSaveTimer); _tAutoSaveTimer = null; }
  if (_gAutoSaveTimer) { clearTimeout(_gAutoSaveTimer); _gAutoSaveTimer = null; }
}

export function scheduleTsvAutoSave() {
  if (_tAutoSaveTimer) clearTimeout(_tAutoSaveTimer);
  if (!tState.settings.tsvDir || !tState.currentRel) return;
  _tAutoSaveTimer = setTimeout(() => {
    _tAutoSaveTimer = null;
    if (tState.dirty) saveTsvProgress(true);
  }, AUTOSAVE_DELAY_MS);
}

export async function flushTsvAutoSave() {
  if (_tAutoSaveTimer) { clearTimeout(_tAutoSaveTimer); _tAutoSaveTimer = null; }
  if (tState.dirty && tState.settings.tsvDir && tState.currentRel) {
    await saveTsvProgress(true);
  }
}

export function scheduleGlossaryAutoSave() {
  if (_gAutoSaveTimer) clearTimeout(_gAutoSaveTimer);
  if (!tState.settings.tsvDir) return;
  _gAutoSaveTimer = setTimeout(() => {
    _gAutoSaveTimer = null;
    if (gState.dirty) saveGlossary(true);
  }, AUTOSAVE_DELAY_MS);
}

export async function flushGlossaryAutoSave() {
  if (_gAutoSaveTimer) { clearTimeout(_gAutoSaveTimer); _gAutoSaveTimer = null; }
  if (gState.dirty && tState.settings.tsvDir) {
    await saveGlossary(true);
  }
}

// Зберегти все перед закриттям вікна. Main перехоплює 'close', шле нам
// 'app:before-close' і чекає closeReady() (або 3с таймаут) — тому тут можна
// спокійно дочекатися async-запису TSV та глосарію.
if (window.kh1.app && window.kh1.app.onBeforeClose) {
  window.kh1.app.onBeforeClose(async () => {
    try { await flushTsvAutoSave(); } catch (_) {}
    try { await flushGlossaryAutoSave(); } catch (_) {}
    window.kh1.app.closeReady();
  });
}

export function mergeTsvIntoSlots(content) {
  const tsvByOff = tsvFormat.overridesByOffset(content);
  if (!tsvByOff) return 0;
  let merged = 0;
  for (const slot of tState.slots) {
    let uk = tsvByOff.get(slot.offset);
    if (uk) {
      // Старі TSV: 2-байтова форма токенів 05/06/07 → нова (як в EN слота).
      if (slot.legacyKey) uk = window.KH.textStructure.upgradeLegacyUk(slot.english, slot.legacyKey, uk);
      slot.ukText = uk; merged++;
    }
  }
  return merged;
}

// Будує DIV для відображення англійського тексту з видимим
// маркуванням leading/trailing whitespace (пробіли → ·, таби → ⇥).
export function buildEnDisplay(text) {
  const el = document.createElement('div');
  el.className = 't-en';
  const t = text == null ? '' : String(text);
  const leadM = t.match(/^[ \t]+/);
  const trailM = t.match(/[ \t]+$/);
  const startIdx = leadM ? leadM[0].length : 0;
  const endIdx = trailM ? t.length - trailM[0].length : t.length;
  if (leadM) {
    const s = document.createElement('span');
    s.className = 't-ws';
    s.textContent = leadM[0].replace(/ /g, '·').replace(/\t/g, '⇥');
    s.title = 'Leading whitespace: ' + leadM[0].length + ' символ(ів)';
    el.appendChild(s);
  }
  if (endIdx > startIdx) {
    el.appendChild(document.createTextNode(t.substring(startIdx, endIdx)));
  }
  if (trailM) {
    const s = document.createElement('span');
    s.className = 't-ws';
    s.textContent = trailM[0].replace(/ /g, '·').replace(/\t/g, '⇥');
    s.title = 'Trailing whitespace: ' + trailM[0].length + ' символ(ів)';
    el.appendChild(s);
  }
  return el;
}

// Помічає UK textarea, якщо в ньому бракує leading/trailing whitespace
// з оригіналу (preserveStructure повертає це при compose, але візуально треба).
export function updateUkWhitespaceWarn(uk, slot) {
  const enLead = (slot.english.match(/^[ \t]+/) || [''])[0];
  const enTrail = (slot.english.match(/[ \t]+$/) || [''])[0];
  const cur = slot.ukText || '';
  const missLead = enLead && !cur.startsWith(enLead);
  const missTrail = enTrail && !cur.endsWith(enTrail);
  const warn = !!(missLead || missTrail) && cur.length > 0 && cur !== slot.english;
  uk.classList.toggle('t-uk-warn', warn);
  if (warn) {
    const parts = [];
    if (missLead) parts.push('бракує leading «' + enLead.replace(/ /g, '·') + '»');
    if (missTrail) parts.push('бракує trailing «' + enTrail.replace(/ /g, '·') + '»');
    uk.title = parts.join(', ') + ' — буде авто-додано при compose';
  } else {
    uk.title = '';
  }
}

export function renderEmpty(msg) {
  while (tRows.firstChild) tRows.removeChild(tRows.firstChild);
  const div = document.createElement('div');
  div.className = 't-empty';
  const p = document.createElement('p');
  p.textContent = msg;
  div.appendChild(p);
  tRows.appendChild(div);
}

export function renderRows() {
  while (tRows.firstChild) tRows.removeChild(tRows.firstChild);
  if (tState.slots.length === 0) {
    renderEmpty(window.i18n.t('tNoTranslatable'));
    return;
  }

  const frag = document.createDocumentFragment();
  for (const slot of tState.slots) {
    const row = document.createElement('div');
    let cls = 't-row' + (isRealTranslation(slot) ? ' translated' : '');
    if (isRealTranslation(slot)) {
      const issue = tokenIssueText(slot.english, slot.ukText);
      if (issue) { cls += ' token-warn'; }
    }
    row.className = cls;
    row.dataset.off = String(slot.offset);
    if (isRealTranslation(slot)) {
      const issue = tokenIssueText(slot.english, slot.ukText);
      if (issue) row.title = issue;
    }

    const meta = document.createElement('div');
    meta.className = 't-meta';
    const dot = document.createElement('i');
    dot.className = 't-dot';
    meta.appendChild(dot);
    const idxSpan = document.createElement('span');
    idxSpan.className = 't-idx';
    idxSpan.textContent = '#' + slot.index;
    const offSpan = document.createElement('span');
    offSpan.className = 't-off';
    offSpan.textContent = '0x' + slot.offset.toString(16).toUpperCase().padStart(4, '0');
    const lenSpan = document.createElement('span');
    lenSpan.textContent = slot.byteLen + ' b';
    meta.appendChild(idxSpan);
    meta.appendChild(offSpan);
    meta.appendChild(lenSpan);

    const en = buildEnDisplay(slot.english);

    const uk = document.createElement('textarea');
    uk.className = 't-uk';
    uk.placeholder = 'Український переклад…';
    uk.value = slot.ukText;
    uk.spellcheck = false;
    uk.rows = Math.min(4, Math.max(1, Math.ceil(slot.english.length / 70)));
    updateUkWhitespaceWarn(uk, slot);

    row.appendChild(meta);
    row.appendChild(en);
    row.appendChild(uk);
    frag.appendChild(row);
  }
  tRows.appendChild(frag);
  applyFilter();
}

export function applyFilter() {
  const search = (tState.filter.search || '').toLowerCase();
  const mode = tState.filter.mode || 'all';
  const rowEls = tRows.querySelectorAll('.t-row');
  for (let i = 0; i < rowEls.length; i++) {
    const slot = tState.slots[i];
    if (!slot) continue;
    let hide = false;
    if (search && slot.english.toLowerCase().indexOf(search) === -1) hide = true;
    const real = isRealTranslation(slot);
    if (mode === 'untranslated' && real) hide = true;
    if (mode === 'translated' && !real) hide = true;
    rowEls[i].classList.toggle('hidden', hide);
  }
}

export function refreshProgress() {
  const total = tState.slots.length;
  const done = tState.slots.filter(isRealTranslation).length;
  const pct = total > 0 ? Math.round(100 * done / total) : 0;
  tProgress.textContent = total > 0
    ? done + ' / ' + total + ' (' + pct + '%)'
    : '—';

  const dirtyMark = tState.dirty ? window.i18n.t('tUnsaved') : '';
  tStatus.textContent = (tState.currentRel || '—') + dirtyMark;

  tSaveTsv.disabled = !tState.currentRel || !tState.settings.tsvDir;
  tCompose.disabled = !tState.currentRel || done === 0 || !tState.settings.outDir;
  tExportTxt.disabled = !tState.currentRel || tState.slots.length === 0;
  tImportTxt.disabled = !tState.currentRel || tState.slots.length === 0;
  if (tAutoWrapBtn) tAutoWrapBtn.disabled = !tState.currentRel || tState.slots.length === 0;
}

// edit handler — event delegation
tRows.addEventListener('input', (e) => {
  const ta = e.target;
  if (!(ta && ta.classList && ta.classList.contains('t-uk'))) return;
  const row = ta.closest('.t-row');
  if (!row) return;
  const off = parseInt(row.dataset.off, 10);
  const slot = slotByOffset(off);
  if (!slot) return;
  slot.ukText = ta.value;
  row.classList.toggle('translated', isRealTranslation(slot));
  row.classList.remove('error');
  // Token validation live update
  if (isRealTranslation(slot)) {
    const issue = tokenIssueText(slot.english, slot.ukText);
    row.classList.toggle('token-warn', !!issue);
    if (issue) row.title = issue; else row.removeAttribute('title');
  } else {
    row.classList.remove('token-warn');
    row.removeAttribute('title');
  }
  updateUkWhitespaceWarn(ta, slot);
  tState.dirty = true;
  refreshProgress();
  scheduleTsvAutoSave();
});

// ---- Save TSV progress ----
export function buildTsvContent() {
  // Не зберігаємо stub-и (ukText === english) — у TSV лишається тільки реальний переклад
  return tsvFormat.build(tState.slots, { ukOf: s => (isRealTranslation(s) ? s.ukText : '') });
}

export async function saveTsvProgress(silent) {
  if (!tState.currentRel) { if (!silent) toast(window.i18n.t('toastNoFile'), 'error'); return; }
  if (!tState.settings.tsvDir) {
    if (!silent) { toast(window.i18n.t('toastConfigTsv'), 'error'); openSettings(); }
    return;
  }

  const tsvPath = joinPath(tState.settings.tsvDir, tState.currentRel) + '.tsv';
  try {
    const r = await window.kh1.translate.saveTsv({ tsvPath, content: buildTsvContent() });
    if (r.error) {
      if (!silent) toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000);
      return;
    }
    tState.dirty = false;
    refreshProgress();
    if (!silent) toast(window.i18n.t('toastProgressSaved'), 'success');
  } catch (e) {
    if (!silent) toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

// ---- Compose .binl ----
export async function composeBinl() {
  if (!tState.currentRel) { toast(window.i18n.t('toastNoFile'), 'error'); return; }
  if (!tState.settings.outDir) { toast(window.i18n.t('toastNoOutDir'), 'error'); openSettings(); return; }

  // 1) Реальні UK з in-memory edits мають пріоритет
  // 2) Інакше — fallback на глосарій (раптом імпортовано після відкриття файлу)
  const replacements = [];
  for (const s of tState.slots) {
    let uk;
    if (isRealTranslation(s)) {
      uk = s.ukText;
    } else {
      const fromGloss = gState.translations[s.english];
      if (fromGloss && fromGloss !== s.english) uk = fromGloss;
    }
    if (!uk) continue;
    replacements.push({
      offset: s.offset,
      oldLen: s.byteLen,
      ukText: preserveStructure(s.english, uk)
    });
  }

  if (replacements.length === 0) { toast(window.i18n.t('toastNoTranslations'), 'error'); return; }

  // Гарантуємо що TSV збережено перед побудовою .binl
  await flushTsvAutoSave();

  const engPath = joinPath(tState.settings.engDir, tState.currentRel);
  // DONE у патч-розкладці (<archive>/original|remastered/…) — тека готова для KHPCPatchManager
  const outPath = joinPath(tState.settings.outDir, patchOutRel(getCurrentGameId(), tState.currentRel));

  // clear previous error highlights
  for (const row of tRows.querySelectorAll('.t-row.error')) {
    row.classList.remove('error');
    row.removeAttribute('title');
  }

  try {
    const r = await window.kh1.translate.compose({ engPath, replacements, outPath });
    if (r.error) { toast(window.i18n.t('toastComposeError', {msg: r.error}), 'error', 6000); return; }

    let msg = window.i18n.t('tComposed', { n: replacements.length, bytes: r.byteLength, path: outPath });
    if (r.errors && r.errors.length) {
      msg += window.i18n.t('tComposedErrors', { n: r.errors.length });
      const offToRow = new Map();
      for (const row of tRows.querySelectorAll('.t-row')) {
        offToRow.set(parseInt(row.dataset.off, 10), row);
      }
      for (const er of r.errors) {
        const row = offToRow.get(er.offset);
        if (row) { row.classList.add('error'); row.title = er.message; }
      }
      toast(msg, 'error', 7000);
    } else {
      toast(msg, 'success', 5000);
    }
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

// =====================================================================
// Per-file .txt export / import (зручно для перекладу поза програмою)
// =====================================================================
export function buildPerFileTxt(rel, slots) {
  const out = [];
  out.push('# KH1 Translation File');
  out.push('# File: ' + rel);
  out.push('# Slots: ' + slots.length + ' (показано лише translatable)');
  out.push('# ');
  out.push('# Інструкція:');
  out.push('#  • Редагуй ЛИШЕ блоки --- UK ---. EN — для контексту, не чіпати.');
  out.push('#  • Багаторядковий UK — пиши як є, реальні переноси будуть конвертовані у {lf}.');
  out.push('#  • Токени типу {0x04}, {VarItem}, {ColorRed} лишай як є.');
  out.push('#  • Не змінюй [#N] @0xHEX заголовки — за ними знаходимо слот.');
  out.push('#  • Порожній або такий самий як EN UK — слот пропускається.');
  out.push('# ============================================================');
  out.push('');
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const off = '0x' + s.offset.toString(16).toUpperCase().padStart(4, '0');
    out.push('[#' + (i + 1) + '] @' + off);
    out.push('--- EN ---');
    out.push((s.english || '').replace(/\{lf\}/g, '\n'));
    out.push('--- UK ---');
    out.push((s.ukText || '').replace(/\{lf\}/g, '\n'));
    out.push('=== END ===');
    out.push('');
  }
  return out.join('\n');
}

export function parsePerFileTxt(content) {
  // Повертає Map<offsetNumber, ukString> та список помилок
  const map = new Map();
  const errors = [];
  const lines = content.split(/\r?\n/);

  let i = 0;
  let blockHeader = null; // { idx, offset }
  let section = null;     // 'en' | 'uk' | null
  let ukLines = [];

  function commitBlock() {
    if (!blockHeader) return;
    let uk = ukLines.join('\n');
    // Trim trailing blank lines from UK section
    uk = uk.replace(/\s+$/, '');
    // Згорнути реальні переноси у {lf} (якщо користувач не використав {lf})
    if (uk && !uk.includes('{lf}') && uk.includes('\n')) {
      uk = uk.replace(/\r?\n/g, '{lf}');
    }
    map.set(blockHeader.offset, uk);
    blockHeader = null;
    section = null;
    ukLines = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    // Header [#N] @0xHEX
    const m = line.match(/^\[#(\d+)\]\s+@(0x[0-9A-Fa-f]+)\s*$/);
    if (m) {
      commitBlock();
      blockHeader = { idx: parseInt(m[1], 10), offset: parseInt(m[2], 16) };
      section = null;
      ukLines = [];
      i++;
      continue;
    }
    if (/^---\s*EN\s*---\s*$/.test(line)) { section = 'en'; i++; continue; }
    if (/^---\s*UK\s*---\s*$/.test(line)) { section = 'uk'; i++; continue; }
    if (/^===\s*END\s*===\s*$/.test(line)) { commitBlock(); i++; continue; }
    if (section === 'uk') ukLines.push(line);
    // EN-секція ігнорується (read-only context)
    i++;
  }
  commitBlock();
  return { map, errors };
}

export async function exportFileTxt() {
  if (!tState.currentRel) { toast(window.i18n.t('toastNoFile'), 'error'); return; }
  if (!tState.slots.length) { toast(window.i18n.t('toastNoRowsExport'), 'error'); return; }
  const content = buildPerFileTxt(tState.currentRel, tState.slots);
  const defaultName = tState.currentRel.replace(/[/\\]/g, '_') + '.txt';
  try {
    const r = await window.kh1.translate.exportFileTxt({ defaultName, content });
    if (r.canceled) return;
    if (r.error) { toast(window.i18n.t('toastExportError', {msg: r.error}), 'error', 6000); return; }
    toast(window.i18n.t('toastExportedTxt', {path: r.filePath, n: r.byteLength}), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

export async function importFileTxt() {
  if (!tState.currentRel) { toast(window.i18n.t('toastOpenTargetFirst'), 'error'); return; }
  if (!tState.slots.length) { toast(window.i18n.t('toastNoRowsImport'), 'error'); return; }
  try {
    const r = await window.kh1.translate.importFileTxt();
    if (r.canceled) return;
    if (r.error) { toast(window.i18n.t('toastImportError', {msg: r.error}), 'error', 6000); return; }
    const parsed = parsePerFileTxt(r.content);
    let applied = 0, skipped = 0, notFound = 0;
    for (const slot of tState.slots) {
      if (parsed.map.has(slot.offset)) {
        const uk = parsed.map.get(slot.offset);
        if (!uk || uk === slot.english) { skipped++; continue; }
        slot.ukText = uk;
        applied++;
      }
    }
    for (const off of parsed.map.keys()) {
      if (!tState.slots.find(s => s.offset === off)) notFound++;
    }
    if (applied) {
      tState.dirty = true;
      // Заодно оновити glossary з нових перекладів
      for (const slot of tState.slots) {
        if (slot.ukText && slot.ukText !== slot.english) {
          if (gState.translations[slot.english] !== slot.ukText) {
            gState.translations[slot.english] = slot.ukText;
            gState.dirty = true;
          }
        }
      }
      renderRows();
      refreshProgress();
      scheduleTsvAutoSave();
      scheduleGlossaryAutoSave();
    }
    let msg = window.i18n.t('tTxtImportSummary', { applied });
    if (skipped) msg += window.i18n.t('tTxtImportSkipped', { n: skipped });
    if (notFound) msg += window.i18n.t('tTxtImportNotFound', { n: notFound });
    toast(msg, applied ? 'success' : 'info', 6000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}

// =====================================================================
// Progress events from main
// =====================================================================
window.kh1.translate.onProgress((p) => {
  if (!p) return;
  const phase = p.phase === 'glossary-build' ? window.i18n.t('phaseScanning')
              : p.phase === 'compose-all' ? window.i18n.t('phaseComposing')
              : p.phase || '…';
  tProgress.textContent = phase + ': ' + p.done + ' / ' + p.total;
  if (p.currentFile) tStatus.textContent = phase + '… ' + p.currentFile;
});

// =====================================================================
// Wire up — translate
// =====================================================================
tFileSel.addEventListener('change', (e) => {
  const v = e.target.value;
  if (v) loadFile(v);
});
tReload.addEventListener('click', loadFileList);
tSearchInput.addEventListener('input', (e) => {
  tState.filter.search = e.target.value;
  applyFilter();
});
tFilterMode.addEventListener('change', (e) => {
  tState.filter.mode = e.target.value;
  applyFilter();
});
tSaveTsv.addEventListener('click', () => saveTsvProgress(false));
tCompose.addEventListener('click', composeBinl);
tExportTxt.addEventListener('click', exportFileTxt);
tImportTxt.addEventListener('click', importFileTxt);
if (tAutoWrapBtn) tAutoWrapBtn.addEventListener('click', autoWrapAllUkSlots);

export async function autoWrapAllUkSlots() {
  if (!tState.currentRel || !tState.slots.length) {
    toast(window.i18n.t('toastNoFile'), 'error'); return;
  }
  if (!kState.knjBuf) {
    toast(window.i18n.t('toastNeedKnj'), 'error', 6000); return;
  }
  const maxWidth = Math.max(100, Math.min(900, parseInt(tMaxWidthInput && tMaxWidthInput.value, 10) || 380));
  const slotIdxs = [];
  const texts = [];
  for (let i = 0; i < tState.slots.length; i++) {
    const s = tState.slots[i];
    if (!isRealTranslation(s)) continue;
    slotIdxs.push(i);
    texts.push(s.ukText);
  }
  if (!texts.length) { toast(window.i18n.t('toastNoTranslations'), 'info'); return; }
  const u8 = kState.knjBuf;
  const knjData = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  try {
    const r = await window.kh1.translate.autoWrap({ texts, maxWidth, knjData });
    if (r.error) { toast(window.i18n.t('toastError', {msg: r.error}), 'error', 6000); return; }
    let changed = 0, addedLfs = 0;
    for (let k = 0; k < slotIdxs.length; k++) {
      const i = slotIdxs[k];
      const before = tState.slots[i].ukText;
      const after = r.wrapped[k];
      if (after && after !== before) {
        tState.slots[i].ukText = after;
        changed++;
        const beforeLfs = (before.match(/\{lf\}/g) || []).length;
        const afterLfs = (after.match(/\{lf\}/g) || []).length;
        addedLfs += Math.max(0, afterLfs - beforeLfs);
      }
    }
    if (changed) {
      tState.dirty = true;
      renderRows();
      refreshProgress();
      scheduleTsvAutoSave();
    }
    toast(window.i18n.t('toastAutoWrapDone', { changed, lfs: addedLfs }), 'success', 5000);
  } catch (e) {
    toast(window.i18n.t('toastError', {msg: e.message}), 'error', 6000);
  }
}
tSettingsBtn.addEventListener('click', openSettings);

// Subtabs
tabFiles.addEventListener('click', () => setSubtab('files'));
tabGlossary.addEventListener('click', () => setSubtab('glossary'));

// Glossary controls
gBuild.addEventListener('click', buildGlossary);
gImport.addEventListener('click', importTranslations);
gSearch.addEventListener('input', (e) => {
  gState.filter.search = e.target.value;
  applyGlossaryFilter();
});
gFilterMode.addEventListener('change', (e) => {
  gState.filter.mode = e.target.value;
  applyGlossaryFilter();
});
if (gSortMode) {
  gSortMode.addEventListener('change', (e) => {
    gState.filter.sort = e.target.value;
    renderGlossaryRows(); // re-render у новому порядку
  });
}
gSave.addEventListener('click', () => saveGlossary(false));
gComposeAll.addEventListener('click', composeAllFiles);

