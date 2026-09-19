'use strict';

// Збираємо uncaught-помилки renderer'а до масиву — smoke-тест (main/smoke.js)
// читає window.__khRendererErrors, щоб зловити поломку ESM-модулів на завантаженні.
// Окремий класичний скрипт, бо CSP забороняє inline.
window.__khRendererErrors = [];
window.addEventListener('error', (e) => {
  window.__khRendererErrors.push(String((e && e.message) || e));
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  window.__khRendererErrors.push('unhandledrejection: ' + String((r && r.message) || r));
});
