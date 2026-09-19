'use strict';

// Формат обміну `text_all.txt` (спільний для Python-наборів DDD/BBS/CoM):
//
//   ### bbs_fourth.hed_out\original\message\en\event\rg\CTrg100.ctd
//   #12
//   Гей! Так ти цього хотів?
//   #13
//   Два рядки
//   виглядають так
//
//   ### — шлях до файлу гри; #N — індекс запису у файлі (DDD також @0xID);
//   текст — усі рядки до наступного маркера; порожній рядок одразу після
//   маркера = порожній текст; рівно один порожній рядок перед наступним ###
//   є роздільником і в текст не входить. BOM і CRLF допускаються.
//
// Семантика parse/build звірена з khtext.py / bbstext.py / comtext.py.

const HDR = '### ';
const NUM_RE = /^#(\d+)$/;
const ID_RE = /^@0x([0-9a-fA-F]+)$/;

// parse(content) → [{ file, items: [{ id: number | string('0x%08X'), text }] }]
function parse(content) {
  let src = String(content || '');
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);   // BOM від Windows-редакторів
  const lines = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const sections = [];
  const byFile = new Map();
  let cur = null;
  let ident = null;
  let buf = [];

  const flush = (boundary) => {
    if (ident === null) return;
    if (boundary && buf.length && buf[buf.length - 1] === '') buf.pop();
    cur.items.push({ id: ident, text: buf.join('\n') });
  };

  lines.forEach((ln, i) => {
    if (ln.startsWith(HDR)) {
      flush(true); ident = null; buf = [];
      const file = ln.slice(HDR.length).trim().replace(/\//g, '\\');
      cur = byFile.get(file);
      if (!cur) { cur = { file, items: [] }; byFile.set(file, cur); sections.push(cur); }
      return;
    }
    let m = NUM_RE.exec(ln);
    if (m && cur) { flush(false); buf = []; ident = parseInt(m[1], 10); return; }
    m = ID_RE.exec(ln);
    if (m && cur) { flush(false); buf = []; ident = '0x' + parseInt(m[1], 16).toString(16).toUpperCase().padStart(8, '0'); return; }
    if (cur === null || ident === null) {
      if (ln.trim()) {
        const err = new Error('рядок ' + (i + 1) + ': текст без маркера "#N": ' + ln.slice(0, 60));
        err.line = i + 1;
        throw err;
      }
      return;
    }
    buf.push(ln);
  });
  flush(true);
  return sections;
}

// build(sections) → string. sections: [{ file, items: [{ id, text }] }]
function build(sections) {
  const out = [];
  sections.forEach((sec, si) => {
    if (si) out.push('');
    out.push(HDR + String(sec.file).replace(/\//g, '\\'));
    for (const it of sec.items) {
      out.push(typeof it.id === 'number' ? '#' + it.id : '@' + it.id);
      out.push(String(it.text == null ? '' : it.text));
    }
  });
  return out.join('\n') + '\n';
}

// Чи є що перекладати: хоч одна літера поза {вставками} (як translatable() у .py).
function translatable(text) {
  if (!text) return false;
  const bare = String(text).replace(/\{[^}]*\}/g, '').trim();
  return !!bare && /\p{L}/u.test(bare);
}

// Зіставити шлях із text_all (Windows-стиль, відносно кореня гри) зі списком
// rel-шляхів застосунку (відносно engDir, '/'). Беремо найдовший спільний
// суфікс; якщо кандидат один — він. Повертає rel або null.
function matchRel(txtPath, rels) {
  const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();
  const target = norm(txtPath);
  const tParts = target.split('/');
  let best = null;
  let bestLen = 0;
  let ties = 0;
  for (const rel of rels) {
    const rParts = norm(rel).split('/');
    let k = 0;
    while (k < tParts.length && k < rParts.length && tParts[tParts.length - 1 - k] === rParts[rParts.length - 1 - k]) k++;
    if (k === 0) continue;
    // Повний збіг rel усередині txt-шляху — найкраще.
    const full = k === rParts.length;
    const score = k * 2 + (full ? 1 : 0);
    if (score > bestLen) { bestLen = score; best = rel; ties = 0; }
    else if (score === bestLen) ties++;
  }
  return (best && ties === 0) ? best : null;
}

// pair(enSections, ukSections) → [{ file, id, en, uk }] — з'єднати два text_all
// (напр. text_uniq.txt + text_ua.txt Re:CoM) за (file, id).
function pair(enSections, ukSections) {
  const ukMap = new Map();
  for (const s of ukSections) for (const it of s.items) ukMap.set(s.file.toLowerCase() + '\u0000' + it.id, it.text);
  const out = [];
  for (const s of enSections) {
    for (const it of s.items) {
      const uk = ukMap.get(s.file.toLowerCase() + '\u0000' + it.id);
      if (uk === undefined) continue;
      out.push({ file: s.file, id: it.id, en: it.text, uk });
    }
  }
  return out;
}

module.exports = { parse, build, translatable, matchRel, pair, HDR };
