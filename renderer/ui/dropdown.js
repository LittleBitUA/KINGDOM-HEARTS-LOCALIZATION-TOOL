// Dropdown-меню тулбарів: `.kh-dd > .kh-dd-btn + .kh-menu`. Пункти всередині —
// звичайні кнопки зі своїми ID й обробниками (вони не змінюються); меню лише
// показує/ховає їх. Закривається після кліку по пункту, поза меню або Esc.

function closeAll(except) {
  for (const dd of document.querySelectorAll('.kh-dd.open')) {
    if (dd === except) continue;
    dd.classList.remove('open');
    const btn = dd.querySelector(':scope > .kh-dd-btn');
    const menu = dd.querySelector(':scope > .kh-menu');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  }
}

function open(dd) {
  const btn = dd.querySelector(':scope > .kh-dd-btn');
  const menu = dd.querySelector(':scope > .kh-menu');
  if (!btn || !menu) return;
  closeAll(dd);
  dd.classList.add('open');
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // Якщо меню вилазить за правий край вікна — вирівняти по правому краю кнопки.
  const r = menu.getBoundingClientRect();
  dd.classList.toggle('align-right', r.right > window.innerWidth - 8);
  const first = menu.querySelector('.kh-menu-item:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
}

export function initDropdowns() {
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const btn = t.closest('.kh-dd-btn');
    if (btn && btn.parentElement && btn.parentElement.classList.contains('kh-dd')) {
      const dd = btn.parentElement;
      if (dd.classList.contains('open')) closeAll(); else open(dd);
      return;
    }
    // Клік по пункту — його власний обробник уже спрацював (target phase); закриваємо.
    if (t.closest('.kh-menu-item')) { closeAll(); return; }
    // Поля всередині меню (min-px) не закривають його.
    if (t.closest('.kh-menu')) return;
    closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('.kh-dd.open')) {
      const dd = document.querySelector('.kh-dd.open');
      const btn = dd && dd.querySelector(':scope > .kh-dd-btn');
      closeAll();
      if (btn) btn.focus();
    }
  });
  window.addEventListener('blur', () => closeAll());
}
