import { toast } from '../core/log.js';
import { gState, tState } from '../core/state.js';
import { getCurrentGame } from '../app-shell.js';
import { renderGlossaryRows, refreshGlossaryProgress } from './glossary.js';
import { scheduleGlossaryAutoSave } from './files.js';
import { snapshotGlossary } from './history.js';

// Кнопки text_all у тулбарі глосарія: експорт / імпорт / пара EN+UA.

const t = (k, v) => (window.i18n ? window.i18n.t(k, v) : k);

function needDirs() {
  const game = getCurrentGame();
  if (!tState.settings.engDir) { toast(t('toastConfigEng'), 'error'); return null; }
  if (!tState.files || !tState.files.length) { toast(t('toastEmptyFilesReload'), 'error'); return null; }
  return {
    engDir: tState.settings.engDir,
    refDir: (game && game.dirs.includes('refDir')) ? (tState.settings.refDir || null) : null,
    tsvDir: tState.settings.tsvDir || null,
    files: tState.files.map(f => f.rel),
    safeMode: tState.safeMode
  };
}

function mergeGlossary(entries, label) {
  const keys = Object.keys(entries || {});
  if (!keys.length) return 0;
  snapshotGlossary(label);
  let n = 0;
  for (const k of keys) { if (gState.translations[k] !== entries[k]) { gState.translations[k] = entries[k]; n++; } }
  if (n) { gState.dirty = true; renderGlossaryRows(); refreshGlossaryProgress(); scheduleGlossaryAutoSave(); }
  return n;
}

async function exportTextAll() {
  const env = needDirs();
  if (!env) return;
  const r = await window.kh1.translate.exportTextAll(Object.assign({ glossary: gState.translations }, env));
  if (r.error) { toast(t('toastError', { msg: r.error }), 'error', 7000); return; }
  const game = getCurrentGame();
  const sv = await window.kh1.translate.saveTextFile({ content: r.content, defaultName: 'text_all_' + ((game && game.id) || 'game') + '.txt' });
  if (sv.canceled) return;
  if (sv.error) { toast(t('toastError', { msg: sv.error }), 'error', 7000); return; }
  toast(t('toastTextAllExported', { files: r.files, lines: r.lines, path: sv.filePath }), 'success', 7000);
}

async function importTextAll() {
  const env = needDirs();
  if (!env) return;
  const f = await window.kh1.translate.pickTextFile({ title: t('pickTextAll') });
  if (f.canceled) return;
  if (f.error) { toast(t('toastError', { msg: f.error }), 'error', 7000); return; }
  const r = await window.kh1.translate.importTextAll(Object.assign({ content: f.content, toGlossary: true }, env));
  if (r.error) { toast(t('toastError', { msg: r.error }), 'error', 9000); return; }
  const g = mergeGlossary(r.glossary, 'text_all');
  toast(t('toastTextAllImported', { applied: r.applied, files: r.matchedFiles, tsv: r.tsvWritten, g, unmatched: r.unmatchedFiles.length, same: r.sameAsEn }), r.unmatchedFiles.length ? 'info' : 'success', 9000);
  if (r.unmatchedFiles.length) console.warn('text_all: unmatched files', r.unmatchedFiles);
}

async function importPair() {
  const en = await window.kh1.translate.pickTextFile({ title: t('pickTextAllEn') });
  if (en.canceled) return;
  if (en.error) { toast(t('toastError', { msg: en.error }), 'error', 7000); return; }
  const uk = await window.kh1.translate.pickTextFile({ title: t('pickTextAllUk') });
  if (uk.canceled) return;
  if (uk.error) { toast(t('toastError', { msg: uk.error }), 'error', 7000); return; }
  const r = await window.kh1.translate.importTextAllPair({ enContent: en.content, ukContent: uk.content });
  if (r.error) { toast(t('toastError', { msg: r.error }), 'error', 9000); return; }
  const n = mergeGlossary(r.glossary, 'EN+UA');
  toast(t('toastTextAllPair', { pairs: r.pairs, n }), 'success', 7000);
}

const bExport = document.getElementById('g-textall-export');
const bImport = document.getElementById('g-textall-import');
const bPair = document.getElementById('g-textall-pair');
if (bExport) bExport.addEventListener('click', () => exportTextAll().catch(e => toast(t('toastError', { msg: e.message }), 'error')));
if (bImport) bImport.addEventListener('click', () => importTextAll().catch(e => toast(t('toastError', { msg: e.message }), 'error')));
if (bPair) bPair.addEventListener('click', () => importPair().catch(e => toast(t('toastError', { msg: e.message }), 'error')));

export { exportTextAll, importTextAll, importPair };
