import { toast } from '../core/log.js';
import { getCurrentGameId } from '../app-shell.js';

// Вкладка «Шрифти UA» (BBS / Re:CoM / DDD): статус Python, генерація кирилиці
// еталонними Python-інструментами (tools/py), встановлення у гру з бекапом.

const el = (id) => document.getElementById(id);
const t = (k, v) => (window.i18n ? window.i18n.t(k, v) : k);

const ufState = { py: null, gameDir: '', buildDir: '', backupDir: '', located: null, busy: false, generated: false, extraLetters: '', extraFont: '', defaultExtraFont: '' };
let _offProgress = null;

// KH1: українська абетка (66) займає комірки 224+; решта вільних — під
// довільні символи інших мов (336 комірок у шрифті, 224 однобайтові).
const KH1_UA_COUNT = 66;
const KH1_FREE_CELLS = 336 - 224;

function uniqueLetters(str) {
  return [...new Set([...String(str || '').replace(/\s+/g, '')])];
}

// Поле «Додаткові символи» лише для KH1; підказка рахує вільні комірки.
function refreshExtraLetters() {
  const row = el('uf-extra-row');
  if (!row) return;
  const isKh1 = getCurrentGameId() === 'kh1-final-mix';
  row.hidden = !isKh1;
  if (!isKh1) return;
  const input = el('uf-extra-letters');
  const letters = uniqueLetters(input.value);
  const left = KH1_FREE_CELLS - KH1_UA_COUNT - letters.length;
  const hint = el('uf-extra-hint');
  hint.textContent = left >= 0
    ? t('ufExtraHint', { n: letters.length, left })
    : t('ufExtraTooMany', { n: -left });
  hint.classList.toggle('bad', left < 0);
  ufState.extraLetters = letters.join('');
  ufState.extraTooMany = left < 0;
  // Рядок запасного шрифту — лише коли є додаткові символи.
  const fontRow = el('uf-extra-font-row');
  if (fontRow) {
    fontRow.hidden = !letters.length;
    const cur = ufState.extraFont || ufState.defaultExtraFont;
    el('uf-extra-font').textContent = cur || t('ufExtraFontNone');
    el('uf-extra-font-reset').hidden = !ufState.extraFont;
  }
}

function log(line, clear) {
  const pre = el('uf-log');
  if (!pre) return;
  if (clear) pre.textContent = '';
  pre.textContent += line;
  pre.scrollTop = pre.scrollHeight;
}

function refreshButtons() {
  const pyOk = !!(ufState.py && ufState.py.found && !ufState.py.missing.length);
  const canGen = pyOk && ufState.located && !ufState.located.error && !ufState.located.missing.length && !ufState.busy;
  el('uf-pip').disabled = !(ufState.py && ufState.py.found && ufState.py.missing.length) || ufState.busy;
  el('uf-generate').disabled = !canGen || !!ufState.extraTooMany;
  el('uf-install').disabled = !(ufState.generated || ufState.buildDirExists) || ufState.busy;
  el('uf-open-build').disabled = !ufState.buildDir;
}

async function refreshPython() {
  const st = el('uf-python');
  st.textContent = '…';
  st.className = 'uf-status';
  try { ufState.py = await window.kh1.uafonts.python(); } catch (_) { ufState.py = { found: false, missing: [] }; }
  if (!ufState.py.found) { st.textContent = t('ufPyNotFound'); st.classList.add('bad'); }
  else if (ufState.py.missing.length) { st.textContent = t('ufPyMissingDeps', { v: ufState.py.version, list: ufState.py.missing.join(', ') }); st.classList.add('bad'); }
  else { st.textContent = t('ufPyFound', { v: ufState.py.version }); st.classList.add('ok'); }
  refreshButtons();
}

async function refreshPaths() {
  const gameId = getCurrentGameId();
  let gameDir = '';
  try { const s = await window.kh1.setup.status(); gameDir = (s && s.gameDirectories && s.gameDirectories[gameId]) || ''; } catch (_) {}
  ufState.gameDir = gameDir;
  el('uf-game-dir').textContent = gameDir || t('ufNoGameDir');
  try {
    const d = await window.kh1.uafonts.defaults(gameId);
    ufState.buildDir = d.buildDir; ufState.backupDir = d.backupDir; ufState.defaultExtraFont = d.fallbackFont || '';
  } catch (_) {}
  el('uf-build-dir').textContent = ufState.buildDir;
  el('uf-backup-dir').textContent = ufState.backupDir;
  // Додаткові символи — з налаштувань гри (KH1).
  const extraInput = el('uf-extra-letters');
  if (extraInput) {
    let saved = '';
    try {
      const st = await window.kh1.translate.getSettings(gameId);
      saved = (st && st.extraLetters) || '';
      ufState.extraFont = (st && st.extraFont) || '';
    } catch (_) {}
    extraInput.value = saved;
    refreshExtraLetters();
  }
  ufState.located = gameDir ? await window.kh1.uafonts.locate({ gameId, gameDir }) : { error: t('ufNoGameDir') };
  const inp = el('uf-inputs');
  if (ufState.located.error) inp.textContent = '⚠ ' + ufState.located.error;
  else {
    inp.textContent = Object.values(ufState.located.inputs).join('\n') + (ufState.located.missing.length ? '\n⚠ ' + ufState.located.missing.join('\n⚠ ') : '');
  }
  refreshButtons();
}

export async function initUaFonts() {
  if (!el('view-ua-fonts')) return;
  if (!_offProgress) {
    _offProgress = window.kh1.uafonts.onProgress((p) => { if (p && p.line) log(p.line); });
    el('uf-pip').addEventListener('click', async () => {
      ufState.busy = true; refreshButtons(); log('', true);
      try {
        const r = await window.kh1.uafonts.pipInstall();
        if (!r.ok) toast((r.error || ('pip: ' + (r.missing || []).join(', '))), 'error', 7000);
        else toast('pip: ' + (r.installed.join(', ') || 'OK'), 'success');
      } finally { ufState.busy = false; await refreshPython(); }
    });
    const extraInput = el('uf-extra-letters');
    if (extraInput) {
      extraInput.addEventListener('input', () => { refreshExtraLetters(); refreshButtons(); });
      extraInput.addEventListener('change', () => {
        // Запам'ятати для гри, щоб наступна генерація/компоновка була з тим самим набором.
        try { window.kh1.translate.saveSettings({ extraLetters: ufState.extraLetters }, getCurrentGameId()); } catch (_) {}
      });
    }
    const fontPick = el('uf-extra-font-pick');
    if (fontPick) {
      fontPick.addEventListener('click', async () => {
        const f = await window.kh1.uafonts.pickFont();
        if (!f) return;
        ufState.extraFont = f;
        try { await window.kh1.translate.saveSettings({ extraFont: f }, getCurrentGameId()); } catch (_) {}
        refreshExtraLetters();
      });
      el('uf-extra-font-reset').addEventListener('click', async () => {
        ufState.extraFont = '';
        try { await window.kh1.translate.saveSettings({ extraFont: '' }, getCurrentGameId()); } catch (_) {}
        refreshExtraLetters();
      });
    }
    el('uf-generate').addEventListener('click', async () => {
      const gameId = getCurrentGameId();
      ufState.busy = true; refreshButtons(); log('', true); el('uf-report').classList.add('hidden');
      try {
        if (gameId === 'kh1-final-mix') {
          refreshExtraLetters();
          try { await window.kh1.translate.saveSettings({ extraLetters: ufState.extraLetters }, gameId); } catch (_) {}
        }
        const r = await window.kh1.uafonts.generate({ gameId, gameDir: ufState.gameDir, buildDir: ufState.buildDir, extraLetters: ufState.extraLetters, fallbackFont: ufState.extraFont || ufState.defaultExtraFont });
        if (!r.ok) { toast(t('ufGenFail', { msg: r.error }), 'error', 9000); if (r.log) log(r.log); }
        else {
          ufState.generated = true;
          toast(t('ufGenDone', { dir: r.buildDir }), 'success', 7000);
          if (r.nativeMap) toast(t('ufNativeMapActive', { n: r.nativeMap.letters }), 'info', 6000);
          renderReport(r.report);
        }
      } finally { ufState.busy = false; refreshButtons(); }
    });
    el('uf-install').addEventListener('click', async () => {
      if (!window.confirm(t('ufInstallConfirm'))) return;
      ufState.busy = true; refreshButtons(); log('', true);
      try {
        const r = await window.kh1.uafonts.install({ gameId: getCurrentGameId(), buildDir: ufState.buildDir, gameDir: ufState.gameDir, backupDir: ufState.backupDir });
        if (!r.ok) toast((r.error || (r.errors || []).slice(0, 3).join('; ')), 'error', 9000);
        else toast(t('ufInstallDone', { n: r.copied, b: ufState.backupDir }), 'success', 8000);
      } finally { ufState.busy = false; refreshButtons(); }
    });
    el('uf-open-build').addEventListener('click', () => window.kh1.uafonts.openDir(ufState.buildDir));
  }
  await refreshPaths();
  await refreshPython();
  refreshExtraLetters();
  refreshButtons();
}

function renderReport(report) {
  const box = el('uf-report');
  if (!box || !report) return;
  box.innerHTML = '';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const h of ['font', 'glyphs', 'atlas', 'squeezed']) { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); }
  table.appendChild(head);
  for (const [name, r] of Object.entries(report)) {
    const tr = document.createElement('tr');
    const cells = [
      name,
      (r.glyphsBefore != null ? r.glyphsBefore + ' → ' + r.glyphsAfter : (r.before != null ? r.before + ' → ' + r.after : (r.count != null ? String(r.count) : ''))),
      Array.isArray(r.png) ? r.png.join('×') : '',
      Array.isArray(r.squeezed) ? r.squeezed.join(' ') : ''
    ];
    for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
    table.appendChild(tr);
  }
  box.appendChild(table);
  box.classList.remove('hidden');
}
