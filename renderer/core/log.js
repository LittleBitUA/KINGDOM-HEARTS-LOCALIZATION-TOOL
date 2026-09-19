import { toasts } from './dom.js';
import { ts } from './shared.js';

// =====================================================================
// Toasts + persistent Event Log
// =====================================================================
export const eventLog = {
  items: [],          // { ts, kind, msg }
  max: 200,
  drawer: null,
  list: null,
  badge: null,
  emptyEl: null,
  unread: 0
};

export function _logFmtTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function _logRender() {
  if (!eventLog.list) return;
  eventLog.list.innerHTML = '';
  for (let i = eventLog.items.length - 1; i >= 0; i--) {
    const it = eventLog.items[i];
    const li = document.createElement('li');
    li.className = 'event-log-item kind-' + it.kind;
    const t = document.createElement('span');
    t.className = 'ev-time';
    t.textContent = _logFmtTime(it.ts);
    const m = document.createElement('span');
    m.className = 'ev-msg';
    m.textContent = it.msg;
    li.appendChild(t); li.appendChild(m);
    eventLog.list.appendChild(li);
  }
  if (eventLog.drawer) eventLog.drawer.classList.toggle('has-events', eventLog.items.length > 0);
}

export function _logBadgeUpdate() {
  if (!eventLog.badge) return;
  if (eventLog.unread > 0) {
    eventLog.badge.textContent = eventLog.unread > 99 ? '99+' : String(eventLog.unread);
    eventLog.badge.hidden = false;
  } else {
    eventLog.badge.hidden = true;
  }
}

function _logItemEl(it) {
  const li = document.createElement('li');
  li.className = 'event-log-item kind-' + it.kind;
  const t = document.createElement('span');
  t.className = 'ev-time';
  t.textContent = _logFmtTime(it.ts);
  const m = document.createElement('span');
  m.className = 'ev-msg';
  m.textContent = it.msg;
  li.appendChild(t); li.appendChild(m);
  return li;
}

export function logEvent(message, kind) {
  if (!kind) kind = 'info';
  const item = { ts: Date.now(), kind, msg: String(message) };
  eventLog.items.push(item);
  if (eventLog.items.length > eventLog.max) {
    eventLog.items.splice(0, eventLog.items.length - eventLog.max);
  }
  // Додаємо один елемент зверху замість перебудови всього списку (composeAll
  // на сотні файлів = сотні toast'ів → раніше сотні повних ре-рендерів).
  if (eventLog.list) {
    eventLog.list.insertBefore(_logItemEl(item), eventLog.list.firstChild);
    while (eventLog.list.children.length > eventLog.max) eventLog.list.removeChild(eventLog.list.lastChild);
    if (eventLog.drawer) eventLog.drawer.classList.add('has-events');
  }
  if (eventLog.drawer && eventLog.drawer.classList.contains('hidden')) {
    eventLog.unread++;
    _logBadgeUpdate();
  }
}

export function toast(message, kind, timeout) {
  if (!kind) kind = 'info';
  if (typeof timeout !== 'number') timeout = 3500;
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  toasts.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('fade-out');
    window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
  }, timeout);
  // Mirror to persistent log
  logEvent(message, kind);
}

