import { getCurrentGameId } from '../app-shell.js';
import { gRows } from '../core/dom.js';
import { toast } from '../core/log.js';
import { gState } from '../core/state.js';
import { describeFile } from './files.js';

// =====================================================================
// Inspector («Інформація») праворуч від таблиці перекладу.
// Показує контекст вибраного рядка глосарію: файл (+світ/кімната KH1), ID, входження,
// статус, токени; дії «Копіювати оригінал» / «Скинути переклад» працюють
// через textarea рядка + подію input, тож існуючі обробники редагування
// (state, dirty, автозбереження) відпрацьовують як при ручному вводі.
// Примітки — локальні (localStorage per game), у дані глосарію не пишуться.
// =====================================================================

const el = (id) => document.getElementById(id);
const t = (k, fb) => (window.i18n && window.i18n.t ? window.i18n.t(k) : fb) || fb;

const insp = {
  root: el('t-inspector'),
  file: el('insp-file'), id: el('insp-id'), count: el('insp-count'), status: el('insp-status'),
  tokens: el('insp-tokens'), copyEn: el('insp-copy-en'), reset: el('insp-reset'),
  copyTokens: el('insp-copy-tokens'), note: el('insp-note'), collapse: el('insp-collapse')
};
let selected = null;   // { row, en }

function baseName(rel) { return String(rel || '').split(/[\\/]/).pop(); }

// Рядок глосарію (data-gidx) → що показати в панелі.
function describe(row) {
  if (!row || row.dataset.gidx === undefined) return null;
  const e = gState.entries[parseInt(row.dataset.gidx, 10)];
  if (!e) return null;
  const occ = (e.occurrences && e.occurrences[0]) || null;
  const rel = e.file || (occ && occ.rel) || '';
  const index = e.index != null ? e.index : (occ ? occ.index : null);
  const files = e.fileCount > 1 ? ' +' + (e.fileCount - 1) : '';
  // Світ/кімната KH1 (.ard) — щоб розуміти, де звучить репліка.
  const info = rel ? describeFile(rel) : null;
  const where = info ? info.world + (info.room ? ' / ' + info.room : '') : '';
  return {
    en: e.english,
    file: rel ? baseName(rel) + files : '—',
    fileTitle: rel + (where ? '\n' + where : ''),
    id: index != null ? '#' + index : '—',
    count: String(e.count || 1)
  };
}

function statusOf(row) {
  if (row.classList.contains('token-warn')) return { cls: 'red', text: t('inspStatusIssue', 'Помилка токенів') };
  if (row.classList.contains('translated')) return { cls: 'green', text: t('inspStatusTranslated', 'Перекладено') };
  return { cls: 'gray', text: t('inspStatusUntranslated', 'Не перекладено') };
}

function tokensText(en) {
  const ts = window.KH && window.KH.textStructure;
  if (!ts || !ts.tokensOf) return '—';
  const m = ts.tokensOf(en);
  const list = m instanceof Map ? [...m.keys()] : Object.keys(m || {});
  return list.length ? list.join('\n') : '—';
}

// ---- примітки (localStorage per game) ----
function notesKey() { return 'kh.notes.' + (getCurrentGameId() || 'game'); }
function loadNotes() { try { return JSON.parse(localStorage.getItem(notesKey()) || '{}') || {}; } catch (_) { return {}; } }
function saveNote(en, text) {
  try {
    const all = loadNotes();
    if (text && text.trim()) all[en] = text; else delete all[en];
    localStorage.setItem(notesKey(), JSON.stringify(all));
  } catch (_) {}
}
let noteTimer = null;

function clear() {
  selected = null;
  for (const k of ['file', 'id', 'count', 'status', 'tokens']) if (insp[k]) insp[k].textContent = '—';
  if (insp.status) insp.status.className = 't-insp-status';
  if (insp.copyEn) insp.copyEn.disabled = true;
  if (insp.reset) insp.reset.disabled = true;
  if (insp.note) { insp.note.value = ''; insp.note.disabled = true; }
}

function refreshStatus() {
  if (!selected || !insp.status) return;
  const st = statusOf(selected.row);
  insp.status.className = 't-insp-status ' + st.cls;
  insp.status.textContent = st.text;
  const ta = selected.row.querySelector('textarea');
  if (insp.reset) insp.reset.disabled = !(ta && ta.value);
}

export function selectRow(row) {
  if (!insp.root || !row) return;
  const d = describe(row);
  if (!d) return;
  if (selected && selected.row !== row) selected.row.classList.remove('selected');
  row.classList.add('selected');
  selected = { row, en: d.en };
  insp.file.textContent = d.file;
  insp.file.title = d.fileTitle || d.file;
  insp.id.textContent = d.id;
  insp.count.textContent = d.count;
  insp.tokens.textContent = tokensText(d.en);
  insp.copyEn.disabled = false;
  insp.note.disabled = false;
  insp.note.value = loadNotes()[d.en] || '';
  refreshStatus();
}

function setUk(text) {
  if (!selected) return;
  const ta = selected.row.querySelector('textarea');
  if (!ta) return;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus({ preventScroll: true });
  refreshStatus();
}

export function initInspector() {
  if (!insp.root) return;
  clear();
  for (const box of [gRows]) {
    if (!box) continue;
    // Вибір рядка: клік або фокус у textarea (Tab по рядках теж працює).
    box.addEventListener('click', (e) => {
      const row = e.target instanceof Element ? e.target.closest('.t-row') : null;
      if (row && row !== (selected && selected.row)) selectRow(row);
    });
    box.addEventListener('focusin', (e) => {
      const row = e.target instanceof Element ? e.target.closest('.t-row') : null;
      if (row && row !== (selected && selected.row)) selectRow(row);
    });
    box.addEventListener('input', (e) => {
      if (selected && e.target instanceof Element && e.target.closest('.t-row') === selected.row) refreshStatus();
    });
    // Перерендер списку (побудова, фільтр, сортування) — вибраного рядка вже нема.
    new MutationObserver(() => {
      if (selected && !box.contains(selected.row)) clear();
    }).observe(box, { childList: true });
  }
  insp.copyEn.addEventListener('click', () => { if (selected) setUk(selected.en); });
  insp.reset.addEventListener('click', () => setUk(''));
  insp.copyTokens.addEventListener('click', async () => {
    const txt = insp.tokens.textContent;
    if (!txt || txt === '—') return;
    try { await navigator.clipboard.writeText(txt.replace(/\n/g, ' ')); toast(t('inspTokensCopied', 'Токени скопійовано'), 'success', 1800); } catch (_) {}
  });
  insp.note.addEventListener('input', () => {
    if (!selected) return;
    const en = selected.en, v = insp.note.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => saveNote(en, v), 300);
  });
  // Згорнути/розгорнути панель (запам'ятовується).
  const body = insp.root.parentElement;
  const apply = (collapsed) => {
    if (body) body.classList.toggle('insp-collapsed', collapsed);
    insp.collapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem('kh.insp.collapsed') === '1'; } catch (_) {}
  apply(collapsed);
  insp.collapse.addEventListener('click', () => {
    collapsed = !collapsed;
    apply(collapsed);
    try { localStorage.setItem('kh.insp.collapsed', collapsed ? '1' : '0'); } catch (_) {}
  });
}
