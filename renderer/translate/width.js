import { getCurrentGameId } from '../app-shell.js';
import { _kCharToGlyphIdx, kEnsureCharMap } from '../kerning/kerning.js';

// =====================================================================
// Ширина рядка у пікселях за метриками шрифту діалогів KH1 (.knj): для кожного
// рядка глосарію показуємо «UK / EN px» і підсвічуємо, коли переклад ширший за
// оригінал (той самий принцип, що в адаптивному auto-wrap: EN — межа рамки).
// Таблиця ширин (336 гліфів × 1 байт) приходить з main (translate:knjWidths):
// спершу зі збірки шрифтів UA (там є ширини нативних літер 224+), інакше з гри.
// Інші ігри (BBS/Re:CoM/DDD) — інші шрифти, поки без вимірювання.
// =====================================================================
const SPACE_PX = 10;
let widths = null;      // Uint8Array(336) | null
let source = '';
let gameOfTable = '';

export async function initWidths() {
  const gameId = getCurrentGameId();
  if (gameOfTable === gameId && widths) return true;
  widths = null; source = ''; gameOfTable = gameId;
  if (gameId !== 'kh1-final-mix') return false;
  try {
    await kEnsureCharMap();
    const r = await window.kh1.translate.knjWidths({ gameId });
    if (r && r.ok && Array.isArray(r.widths) && r.widths.length) { widths = Uint8Array.from(r.widths); source = r.source || ''; }
  } catch (_) { widths = null; }
  return !!widths;
}

export function widthsAvailable() { return !!widths; }
export function widthsSource() { return source; }

// Ширина одного рядка (без {lf}): токени `{…}` не рахуємо (гліфи-іконки
// невідомої ширини), пробіл — 10 px, літера — ширина гліфа × 2 (як у auto-wrap).
function lineWidth(line) {
  let w = 0;
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === '{') {
      const close = line.indexOf('}', i);
      if (close > i) { i = close + 1; continue; }
    }
    i++;
    if (ch === ' ') { w += SPACE_PX; continue; }
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const idx = _kCharToGlyphIdx(ch);
    if (idx >= 0 && idx < widths.length) w += widths[idx] * 2;
  }
  return w;
}

// measure(text) → максимальна ширина рядка (px) або null, якщо метрик нема.
export function measure(text) {
  if (!widths || text == null) return null;
  let mx = 0;
  for (const ln of String(text).split(/\{lf\}|\{eol\}|\n/)) {
    const w = lineWidth(ln);
    if (w > mx) mx = w;
  }
  return mx;
}

// Стеля ширини рядка діалогу. Виміряно по всіх офіційних локалізаціях
// (UK/US/FR/GR/IT/SP, ~250 тис. рядків кожна): p99.9 ≈ 570–600 одиниць таблиці
// .knj, вище — лише debug-рядки. У наших px (ширина × 2) це ≈ 1200.
// Хмаринку гра підганяє під виміряний текст сама (docs/formats/kh1-exe-map.md),
// тож «ширше за оригінал» — ще не проблема; проблема — вище цієї стелі.
export const SAFE_LINE_PX = 1200;

// Заповнити бейдж ширини у рядку глосарію: «UK / EN» px.
//   over  — рядок ширший за стелю гри (справжня проблема, червоне);
//   wider — просто ширший за оригінал (інформативно).
export function updateWidthBadge(badge, en, uk) {
  if (!badge) return;
  if (!widths) { badge.hidden = true; return; }
  const enW = measure(en);
  const ukW = uk ? measure(uk) : null;
  badge.hidden = false;
  badge.textContent = (ukW == null ? '–' : ukW) + '/' + enW;
  const limit = Math.max(SAFE_LINE_PX, enW);
  badge.classList.toggle('over', ukW != null && ukW > limit);
  badge.classList.toggle('wider', ukW != null && enW > 0 && ukW > enW && ukW <= limit);
  badge.title = (window.i18n ? window.i18n.t('widthBadgeTitle', { uk: ukW == null ? '—' : ukW, en: enW, max: limit }) : ukW + ' / ' + enW + ' px') + (source ? '\n' + source : '');
}
