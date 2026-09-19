import { gState } from '../core/state.js';
import { toast } from '../core/log.js';

// Undo для масових операцій над глосарієм (Find/Replace, Auto-wrap, Авто-фікс,
// Pad з EN, Очистка поламаних, Імпорт). Перед кожною такою операцією викликаємо
// snapshotGlossary(label) — робиться shallow-копія translations (рядки
// immutable, тому цього достатньо). undoLastBulk() відновлює останній знімок.
// Глибина — 10 знімків; для глосарію на 20k записів це ~кілька МБ.

const MAX_DEPTH = 10;
const stack = [];   // [{ label, ts, translations }]
let _onChange = null;

export function snapshotGlossary(label) {
  stack.push({ label: label || '', ts: Date.now(), translations: Object.assign(Object.create(null), gState.translations) });
  if (stack.length > MAX_DEPTH) stack.shift();
  if (_onChange) _onChange();
}

export function canUndoBulk() { return stack.length > 0; }
export function lastBulkLabel() { return stack.length ? stack[stack.length - 1].label : ''; }

// undoLastBulk(afterRestore) → true якщо було що відновлювати.
export function undoLastBulk(afterRestore) {
  const snap = stack.pop();
  if (!snap) return false;
  gState.translations = snap.translations;
  gState.dirty = true;
  if (_onChange) _onChange();
  if (typeof afterRestore === 'function') afterRestore();
  toast((window.i18n && window.i18n.t('toastBulkUndone', { label: snap.label })) || ('Скасовано: ' + snap.label), 'success', 4000);
  return true;
}

export function onHistoryChange(cb) { _onChange = cb; if (cb) cb(); }

export function clearBulkHistory() { stack.length = 0; if (_onChange) _onChange(); }
