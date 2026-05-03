'use strict';

const fs = require('fs');

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

/**
 * Парсить HTML-таблицю (типово Google Sheets export) → масив рядків,
 * де кожен — масив cell-strings.
 */
function htmlRows(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(html))) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let c;
    const cells = [];
    while ((c = tdRe.exec(m[1]))) cells.push(stripHtml(c[1]));
    rows.push(cells);
  }
  return rows;
}

function tsvRows(content) {
  return content.split(/\r?\n/).map(line => line.split('\t'));
}

function csvRows(content) {
  // мінімальний CSV: підтримка лапок та коми всередині лапок
  const rows = [];
  const len = content.length;
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < len) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++;
    } else {
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
      field += ch; i++;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Перетворює рядки у пари { en, uk }.
 * За замовчуванням: колонка 0 = English, колонка 1 = Ukrainian.
 * Перші headerRows рядків пропускаються.
 */
/**
 * Нормалізує текст комірки до того формату, який використовує наш екстрактор:
 *   ¶  → {lf}  (paragraph mark = in-message line break, byte 0x02)
 *   \n → {lf}  (cell-internal newline / <br>)
 *   \r видаляється
 */
function normalizeCellText(s, lineBreakToken) {
  if (!s) return '';
  let t = String(s);
  t = t.replace(/\r/g, '');
  // lineBreakToken !== null означає замінити newline на цей токен.
  // KH1 використовує '{lf}'; BBS — null (зберігаємо нативний \n у CTD).
  if (lineBreakToken !== null) {
    const tok = lineBreakToken || '{lf}';
    t = t.replace(/¶/g, tok);
    t = t.replace(/\n/g, tok);
  } else {
    // BBS: тільки нормалізація ¶ → \n, бо ¶ це paragraph mark з Word/Sheets.
    t = t.replace(/¶/g, '\n');
  }
  // Нормалізація OpenKh-style escape'ів {:unk XX} → нашого {0xXX},
  // щоб HTML-glossary (підготовлений через OpenKh CTD Editor) збігався
  // з ключами, які генерує наш decoder.
  t = t.replace(/\{:unk\s+([0-9a-fA-F]{1,2})\}/g, (_, hex) =>
    `{0x${hex.toUpperCase().padStart(2, '0')}}`);
  return t.trim();
}

function rowsToPairs(rows, opts) {
  const enCol = opts && opts.enCol != null ? opts.enCol : 0;
  const ukCol = opts && opts.ukCol != null ? opts.ukCol : 1;
  const headerRows = opts && opts.headerRows != null ? opts.headerRows : 0;
  // lineBreakToken: рядок (наприклад '{lf}'), або null (зберегти \n як є).
  // Default — '{lf}' для KH1-зворотньої сумісності.
  const lineBreakToken = opts && opts.lineBreakToken !== undefined
    ? opts.lineBreakToken
    : '{lf}';
  const pairs = [];
  for (let i = headerRows; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const en = normalizeCellText(r[enCol], lineBreakToken);
    const uk = normalizeCellText(r[ukCol], lineBreakToken);
    if (en && uk) pairs.push({ en, uk });
  }
  return pairs;
}

/**
 * Авто-визначає header rows: пропускає рядки до того як знайде непустий
 * та "не-заголовоковий" рядок. Заголовковими вважаються ті, де перша
 * непуста клітинка містить слова "Original", "English", "Source", "Текст"
 * або взагалі порожня (пусті обрамлюючі рядки експорту).
 */
function detectHeaderRows(rows, enCol, ukCol) {
  // \b в JS — ASCII-only, не працює для кирилиці. Використовуємо явний
  // словник заголовків (case-insensitive, full-cell match).
  const HEADER_TERMS = new Set([
    'original', 'english', 'source', 'en', 'text', 'name', 'path', 'file',
    'джерело', 'оригінал', 'текст', 'переклад', 'назва', 'шлях', 'файл'
  ]);
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const en = (r[enCol] || '').trim().toLowerCase();
    if (!en) continue;
    if (HEADER_TERMS.has(en)) return i + 1;
    return i;
  }
  return 0;
}

/**
 * Універсальний імпорт з файлу. Розпізнає за розширенням, або за вмістом.
 * Повертає { pairs, format, totalRows, headerRows }.
 */
function importFile(filePath, opts) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lower = filePath.toLowerCase();
  let format, rows;
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    format = 'html'; rows = htmlRows(content);
  } else if (lower.endsWith('.tsv')) {
    format = 'tsv'; rows = tsvRows(content);
  } else if (lower.endsWith('.csv')) {
    format = 'csv'; rows = csvRows(content);
  } else if (content.indexOf('<tr') >= 0) {
    format = 'html'; rows = htmlRows(content);
  } else if (content.indexOf('\t') >= 0) {
    format = 'tsv'; rows = tsvRows(content);
  } else {
    format = 'csv'; rows = csvRows(content);
  }

  const enCol = opts && opts.enCol != null ? opts.enCol : 0;
  const ukCol = opts && opts.ukCol != null ? opts.ukCol : 1;
  const headerRows = opts && opts.headerRows != null
    ? opts.headerRows
    : detectHeaderRows(rows, enCol, ukCol);
  const lineBreakToken = opts && opts.lineBreakToken !== undefined
    ? opts.lineBreakToken
    : '{lf}';

  const pairs = rowsToPairs(rows, { enCol, ukCol, headerRows, lineBreakToken });
  return { pairs, format, totalRows: rows.length, headerRows, enCol, ukCol };
}

module.exports = { importFile, htmlRows, tsvRows, csvRows, rowsToPairs };
