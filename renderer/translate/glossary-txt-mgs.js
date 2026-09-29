// Текстовий формат перекладу «як у MGS1» (mgs1-ua-toolkit/translation/MGS1.txt):
//
//   # коментарі
//   ### N  — <файл>[ +M] [· xK] · ОРИГІНАЛ (⏎ = перенос рядка)
//   переклад (реальні переноси зберігаються; неперекладений = текст оригіналу)
//   <порожній рядок>
//
// Використовується для BBS / Re:CoM / DDD (KH1 лишається на [#N] --- EN --- /
// --- UK ---). Ключ запису — ОРИГІНАЛ у заголовку (N — лише для орієнтації).

const LB = '⏎';   // ⏎

function fileLabel(entry) {
  const rel = entry.file || (entry.occurrences && entry.occurrences[0] && entry.occurrences[0].rel) || '';
  const base = rel ? String(rel).split(/[\\/]/).pop() : '';
  return base + (entry.fileCount > 1 ? ' +' + (entry.fileCount - 1) : '');
}

// Оригінал у заголовку — в один рядок: '\n' і {lf} → ⏎.
function headerOriginal(en) {
  return String(en).replace(/\{lf\}/g, LB).replace(/\r?\n/g, LB);
}

// Переклад у файлі — реальні переноси; у ключі гри перенос — '\n' або {lf}.
function toFileText(text, en) {
  const usesLf = /\{lf\}/.test(en);
  return usesLf ? String(text).replace(/\{lf\}/g, '\n') : String(text);
}
function fromFileText(text, en) {
  const usesLf = /\{lf\}/.test(en);
  return usesLf ? text.replace(/\r?\n/g, '{lf}') : text.replace(/\r\n/g, '\n');
}

function headerLine(n, entry) {
  const parts = ['### ' + n + '  — ' + fileLabel(entry)];
  if (entry.count > 1) parts.push('x' + entry.count);
  parts.push(headerOriginal(entry.english));
  return parts.join(' · ');
}

function fileHeader(gameName, total, translated) {
  return [
    '# ' + gameName + ' — Ukrainian translation',
    '# Format: blocks separated by a blank line; \'### N\' = entry index (don\'t change!).',
    '# Header: file [+M more files] [· xK occurrences] · ORIGINAL (' + LB + ' = line break).',
    '# Below the header: the translation. An untranslated entry keeps the original text there.',
    '# Real line breaks inside the translation are preserved. {…} = game tokens — keep them.',
    '# Total: ' + total + ' entries, translated: ' + translated,
    ''
  ].join('\n');
}

// Усі записи індексу (у порядку списку) + переклади; неперекладені — з оригіналом.
export function buildGlossaryTxtMgs(entries, translations, gameName) {
  const seen = new Set();
  const list = [];
  for (const e of entries || []) {
    if (seen.has(e.english)) continue;
    seen.add(e.english);
    list.push(e);
  }
  const translated = list.filter(e => translations[e.english] && String(translations[e.english]).trim()).length;
  const out = [fileHeader(gameName, list.length, translated)];
  list.forEach((e, i) => {
    const uk = translations[e.english];
    out.push(headerLine(i + 1, e));
    out.push(toFileText(uk && String(uk).trim() ? uk : e.english, e.english));
    out.push('');
  });
  return out.join('\n');
}

// Розбір: { pairs: [{en, uk}], total } — uk === en (неперекладене) не повертається.
export function parseGlossaryTxtMgs(content, opts) {
  const keepSame = !!(opts && opts.keepSame);
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  const pairs = [];
  let total = 0;
  let cur = null;   // { en, body: [] }
  const flush = () => {
    if (!cur) return;
    total++;
    // Хвостові порожні рядки: останній — роздільник блоків, але якщо сам
    // ОРИГІНАЛ закінчується переносом, стільки ж належить перекладу. Без цього
    // кінцевий перенос не переживав експорт→імпорт (у BBS він зсуває текст
    // у вікні по вертикалі).
    const tailBreaks = (/\n+$/.exec(cur.en) || [''])[0].length;
    let blanks = 0;
    while (blanks < cur.body.length && cur.body[cur.body.length - 1 - blanks] === '') blanks++;
    const keep = Math.min(tailBreaks, Math.max(0, blanks - 1));
    for (let k = 0; k < blanks - keep; k++) cur.body.pop();
    const uk = fromFileText(cur.body.join('\n'), cur.en);
    if (uk && (keepSame || uk !== cur.en)) pairs.push({ en: cur.en, uk });
    cur = null;
  };
  for (const ln of lines) {
    const m = /^###\s+\d+\s+—\s(.*)$/.exec(ln);
    if (m) {
      flush();
      // '<файл> [· xK] · ОРИГІНАЛ' — файл і xK наші, решта (може містити « · ») — оригінал
      const parts = m[1].split(' · ');
      let i = 1;
      if (i < parts.length && /^x\d+$/.test(parts[i])) i++;
      const en = parts.slice(i).join(' · ').replace(new RegExp(LB, 'g'), '\n');
      cur = { en: en, body: [] };
      continue;
    }
    if (!cur) continue;            // коментарі/шапка поза блоками
    cur.body.push(ln);
  }
  flush();
  // Ключі з {lf}: у заголовку ⏎ стояв замість {lf} — відновлюємо за наявністю {lf} у файлі неможливо,
  // тому пари для таких ігор звіряються викликачем через alignLf(entryKeys).
  return { pairs, total };
}

// Дописати в кінець наявного файла записи, яких у ньому ще нема.
export function buildGlossaryTxtMgsAppend(existing, entries, translations) {
  const have = new Set(parseGlossaryTxtMgs(existing, { keepSame: true }).pairs.map(p => p.en));
  let maxN = 0;
  for (const m of String(existing).matchAll(/^###\s+(\d+)\s/gm)) maxN = Math.max(maxN, Number(m[1]));
  const out = [];
  let added = 0, translated = 0;
  const seen = new Set();
  for (const e of entries || []) {
    if (!e.english || seen.has(e.english) || have.has(e.english)) continue;
    seen.add(e.english);
    const uk = translations[e.english];
    out.push(headerLine(++maxN, e));
    out.push(toFileText(uk && String(uk).trim() ? uk : e.english, e.english));
    out.push('');
    added++;
    if (uk && String(uk).trim()) translated++;
  }
  if (!added) return { content: existing, added: 0, translated: 0 };
  const base = String(existing).replace(/\r\n/g, '\n');
  const sep = base.endsWith('\n\n') ? '' : (base.endsWith('\n') ? '\n' : '\n\n');
  return { content: base + sep + out.join('\n'), added, translated };
}

// Чи це файл MGS-формату (### N — …), а не [#N] --- EN ---.
export function looksLikeMgsTxt(content) {
  return /^###\s+\d+\s+—\s/m.test(String(content));
}
