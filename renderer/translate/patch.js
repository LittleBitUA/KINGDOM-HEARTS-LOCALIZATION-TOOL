import { getCurrentGameId } from '../app-shell.js';
import { logEvent, toast } from '../core/log.js';
import { tState } from '../core/state.js';
import { openSettings } from '../settings-modal.js';
import { setOpProgress } from './files.js';

// =====================================================================
// Патч в один клік: «Зібрати патч» (DONE + шрифти UA → .pcpatch через
// KHPCPatchManager) і «Застосувати до гри» (партійний патч .pkg). Прогрес
// менеджера — у журнал подій; результат — toast.
// =====================================================================
const t = (k, v) => (window.i18n ? window.i18n.t(k, v) : k);
const el = (id) => document.getElementById(id);

let busy = false;

async function fontsBuildDir() {
  try { const d = await window.kh1.uafonts.defaults(getCurrentGameId()); return d && d.buildDir; } catch (_) { return ''; }
}

async function buildPatch() {
  if (busy) return;
  const gameId = getCurrentGameId();
  if (!tState.settings.outDir) { toast(t('patchNoDone'), 'error', 6000); openSettings(); return; }
  const includeFonts = !!(el('g-patch-fonts') && el('g-patch-fonts').checked);
  busy = true;
  el('g-patch-build').disabled = true;
  setOpProgress(t('patchBuilding'));
  try {
    const r = await window.kh1.patch.build({ gameId, doneDir: tState.settings.outDir, fontsBuildDir: includeFonts ? await fontsBuildDir() : '', includeFonts });
    if (!r.ok) { toast(r.error || 'patch:build failed', 'error', 9000); return; }
    const fileName = String(r.patchPath).split(/[\\/]/).pop();
    toast(t('toastPatchBuilt', { file: fileName, files: r.files, archives: r.archives.join(', ') }) + (r.fontsFiles ? t('toastPatchBuiltFonts') : ''), 'success', 9000);
    logEvent('Патч: ' + r.patchPath, 'success');
  } catch (e) {
    toast(t('toastError', { msg: e.message }), 'error', 8000);
  } finally {
    busy = false;
    el('g-patch-build').disabled = false;
    setOpProgress('');
  }
}

async function applyPatch() {
  if (busy) return;
  const gameId = getCurrentGameId();
  let st = null;
  try { st = await window.kh1.patch.status({ gameId }); } catch (_) {}
  if (!st || !st.staging || !st.staging.exists) { toast(t('toastPatchNoStaging'), 'info', 5000); return; }
  if (!window.confirm(t('patchApplyConfirm', { archives: st.patchName }))) return;
  busy = true;
  el('g-patch-apply').disabled = true;
  setOpProgress(t('patchApplying'));
  try {
    const r = await window.kh1.patch.apply({ gameId });
    if (!r.ok) { toast(r.error || 'patch:apply failed', 'error', 12000); return; }
    const list = r.applied.map(a => a.arc + ' (' + a.sec + ' с)').join(', ');
    toast(t('toastPatchApplied', { list, backup: r.backupDir || 'backup' }), 'success', 12000);
    logEvent('Патч застосовано: ' + list, 'success');
  } catch (e) {
    toast(t('toastError', { msg: e.message }), 'error', 8000);
  } finally {
    busy = false;
    el('g-patch-apply').disabled = false;
    setOpProgress('');
  }
}

async function openPatchDir() {
  try {
    const st = await window.kh1.patch.status({ gameId: getCurrentGameId() });
    const dir = st && st.stagingDir ? st.stagingDir.replace(/[\\/][^\\/]+$/, '') : '';
    if (!dir) return;
    const r = await window.kh1.uafonts.openDir(dir);
    if (!r || !r.ok) toast(dir, 'info', 6000);
  } catch (e) { toast(t('toastError', { msg: e.message }), 'error'); }
}

export function initPatch() {
  const b = el('g-patch-build'), a = el('g-patch-apply'), o = el('g-patch-open');
  if (!b) return;
  b.addEventListener('click', buildPatch);
  if (a) a.addEventListener('click', applyPatch);
  if (o) o.addEventListener('click', openPatchDir);
  if (window.kh1.patch && window.kh1.patch.onProgress) {
    window.kh1.patch.onProgress((p) => {
      if (!p || !p.line) return;
      const line = String(p.line).trim();
      if (line) logEvent((p.phase === 'apply' ? 'KHPCPatchManager: ' : '') + line, 'info');
    });
  }
}
