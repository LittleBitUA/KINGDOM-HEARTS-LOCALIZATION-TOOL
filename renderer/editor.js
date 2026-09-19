import { aboutBody, aboutOverlay, btnFind, btnOpen, btnSave, byteInfo, cursorInfo, editor, fileStatus, findCase, findInput, findMessage, findOverlay } from './core/dom.js';
import { toast } from './core/log.js';
import { state } from './core/state.js';

// =====================================================================
// Editor mode (existing)
// =====================================================================
export function refreshStatus() {
  if (state.loadedFileName) {
    fileStatus.textContent = window.i18n.t('edLoaded', { file: state.loadedFileName });
    byteInfo.textContent = window.i18n.t('edBytes', { n: state.byteLength.toLocaleString(window.i18n.getLang() === 'en' ? 'en-US' : 'uk-UA') });
  } else {
    fileStatus.textContent = window.i18n.t('fileNotLoaded');
    byteInfo.textContent = '';
  }
}

export function updateCursor() {
  const pos = editor.selectionStart;
  const before = editor.value.substring(0, pos);
  let lineNum = 1;
  let lastNl = -1;
  for (let i = 0; i < before.length; i++) {
    if (before.charCodeAt(i) === 10) { lineNum++; lastNl = i; }
  }
  const colNum = pos - (lastNl + 1) + 1;
  cursorInfo.textContent = window.i18n.t('edCursor', { line: lineNum, col: colNum });
}

editor.addEventListener('keyup', updateCursor);
editor.addEventListener('click', updateCursor);
editor.addEventListener('input', updateCursor);
editor.addEventListener('select', updateCursor);

export async function doOpen() {
  if (state.busy) return;
  state.busy = true;
  btnOpen.disabled = true;
  try {
    const modeSel = document.getElementById('editor-decode-mode');
    const decodeMode = (modeSel && modeSel.value) || 'smart';
    const result = await window.kh1.openFile({ decodeMode });
    if (result.canceled) return;
    if (result.error) {
      toast(window.i18n.t('toastImportError', {msg: result.error}), 'error', 6000);
      return;
    }
    editor.value = result.text;
    state.loadedFileName = result.fileName;
    state.byteLength = result.byteLength;
    btnSave.disabled = false;
    btnFind.disabled = false;
    refreshStatus();
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    updateCursor();
    toast(window.i18n.t('toastImported', {file: result.fileName}), 'success');
  } catch (e) {
    toast(window.i18n.t('toastImportError', {msg: (e && e.message) || String(e)}), 'error', 6000);
  } finally {
    btnOpen.disabled = false;
    state.busy = false;
  }
}

export async function doSave() {
  if (state.busy) return;
  if (!state.loadedFileName) {
    toast(window.i18n.t('toastImportFirst'), 'error');
    return;
  }
  state.busy = true;
  btnSave.disabled = true;
  try {
    const result = await window.kh1.saveFile(editor.value, state.loadedFileName);
    if (result.canceled) return;
    if (result.error) {
      toast(window.i18n.t('toastExportError', {msg: result.error}), 'error', 6000);
      return;
    }
    state.byteLength = result.byteLength;
    state.loadedFileName = result.fileName;
    refreshStatus();
    toast(window.i18n.t('toastExported', {file: result.fileName}), 'success');
  } catch (e) {
    toast(window.i18n.t('toastExportError', {msg: (e && e.message) || String(e)}), 'error', 6000);
  } finally {
    btnSave.disabled = !state.loadedFileName;
    state.busy = false;
  }
}

// === Find ===
export function showFind() {
  findInput.value = state.lastSearch;
  findCase.checked = state.lastSearchCase;
  findMessage.textContent = '';
  findMessage.className = 'find-message';
  findOverlay.classList.remove('hidden');
  findOverlay.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => { findInput.focus(); findInput.select(); }, 0);
}

export function hideFind() {
  findOverlay.classList.add('hidden');
  findOverlay.setAttribute('aria-hidden', 'true');
  editor.focus();
}

export function performFind(wrap) {
  if (typeof wrap !== 'boolean') wrap = true;
  const query = findInput.value;
  if (!query) {
    findMessage.textContent = window.i18n.t('findEnterText');
    findMessage.className = 'find-message error';
    return;
  }
  state.lastSearch = query;
  state.lastSearchCase = findCase.checked;

  const haystack = state.lastSearchCase ? editor.value : editor.value.toLowerCase();
  const needle = state.lastSearchCase ? query : query.toLowerCase();
  const startFrom = editor.selectionStart + editor.selectionLength;

  let idx = haystack.indexOf(needle, startFrom);
  if (idx < 0 && wrap) idx = haystack.indexOf(needle, 0);

  if (idx < 0) {
    findMessage.textContent = window.i18n.t('findNotFound');
    findMessage.className = 'find-message error';
    return;
  }
  editor.focus();
  editor.setSelectionRange(idx, idx + query.length);
  scrollEditorTo(idx);
  findMessage.textContent = window.i18n.t('findFound');
  findMessage.className = 'find-message success';
  updateCursor();
}

export function scrollEditorTo(index) {
  const before = editor.value.substring(0, index);
  let lineCount = 1;
  for (let i = 0; i < before.length; i++) {
    if (before.charCodeAt(i) === 10) lineCount++;
  }
  const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight) || 21;
  const target = (lineCount - 1) * lineHeight;
  const visible = editor.clientHeight;
  if (target < editor.scrollTop || target > editor.scrollTop + visible - lineHeight * 2) {
    editor.scrollTop = Math.max(0, target - visible / 2);
  }
}

export function findNextFromShortcut() {
  if (!state.lastSearch) { showFind(); return; }
  performFind(true);
}

// === About ===
export async function showAbout() {
  let info;
  try { info = await window.kh1.about(); }
  catch (_) { toast(window.i18n.t('toastAboutLoadFail'), 'error'); return; }

  while (aboutBody.firstChild) aboutBody.removeChild(aboutBody.firstChild);

  const p1 = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = info.name;
  p1.appendChild(strong);
  aboutBody.appendChild(p1);

  const p2 = document.createElement('p');
  const lines = ['Версія: ' + info.version, 'Electron: ' + info.electron, 'Chromium: ' + info.chrome, 'Node.js: ' + info.node];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) p2.appendChild(document.createElement('br'));
    p2.appendChild(document.createTextNode(lines[i]));
  }
  aboutBody.appendChild(p2);

  const p3 = document.createElement('p');
  p3.className = 'about-desc';
  p3.textContent =
    'Двохрежимний редактор: 1) ручне редагування .bin/.binl/.ard з українським оверлеєм; ' +
    '2) Режим перекладу — diff проти російської локалізації, інлайн-переклад, збирання нових файлів.';
  aboutBody.appendChild(p3);

  aboutOverlay.classList.remove('hidden');
  aboutOverlay.setAttribute('aria-hidden', 'false');
}

export function hideAbout() {
  aboutOverlay.classList.add('hidden');
  aboutOverlay.setAttribute('aria-hidden', 'true');
}

