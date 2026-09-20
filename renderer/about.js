import { aboutBody, aboutOverlay } from './core/dom.js';
import { toast } from './core/log.js';

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
  p3.textContent = window.i18n.t('aboutDesc');
  aboutBody.appendChild(p3);

  aboutOverlay.classList.remove('hidden');
  aboutOverlay.setAttribute('aria-hidden', 'false');
}

export function hideAbout() {
  aboutOverlay.classList.add('hidden');
  aboutOverlay.setAttribute('aria-hidden', 'true');
}

