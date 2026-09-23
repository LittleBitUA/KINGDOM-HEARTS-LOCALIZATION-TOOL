'use strict';
// Тягне англійський скрипт роликів KH1 і кладе розібраним у work/gf.json.
// Файл лишається ЛОКАЛЬНИМ (work/ у .gitignore) і служить лише містком
// «англійська ↔ англійська»: репліка скрипта → рядок гри. У наші файли з нього
// не потрапляє нічого — тільки англійський текст із самої гри і твій переклад.

const fs = require('fs');
const path = require('path');
const https = require('https');
const WORK = path.join(__dirname, 'work');

const URL = 'https://gamefaqs.gamespot.com/ps3/684080-kingdom-hearts-hd-15-remix/faqs/68066?print=1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Сайт стоїть за захистом, який відкидає запит від Node (HTTP 403), але
// пропускає curl. Тому спершу curl, і лише якщо його немає — власний запит.
function viaCurl(url) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('curl', ['-sS', '-L', '--compressed', '-A', UA,
    '-H', 'Accept: text/html,application/xhtml+xml',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-H', 'Referer: https://gamefaqs.gamespot.com/', url],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout && r.stdout.length > 10000 ? r.stdout : null;
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html', Referer: 'https://gamefaqs.gamespot.com/' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const html = viaCurl(URL) || await get(URL);
  // Сторінка розбиває текст на кілька блоків <pre id="faqspan-N"> — склеюємо всі.
  let t = '', m;
  const re = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  while ((m = re.exec(html))) t += m[1];
  if (!t) throw new Error('не знайшов тексту скрипта — сторінка змінилась або її віддали з перевіркою браузера');
  t = t.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\r/g, '');

  // Абзац = або ремарка в дужках, або «Хто: репліка».
  const out = [];
  for (const p of t.split(/\n\s*\n/)) {
    const line = p.split('\n').map(x => x.trim()).filter(Boolean).join(' ').trim();
    if (!line) continue;
    if (/^\(/.test(line)) { out.push({ kind: 'stage', text: line }); continue; }
    const s = /^([A-Za-z?’. -]{1,30}?)(?:\s*\([^)]*\))?:\s*(.+)$/.exec(line);
    if (s) out.push({ kind: 'say', who: s[1].trim(), text: s[2].trim() });
    else out.push({ kind: 'other', text: line });
  }
  fs.writeFileSync(path.join(WORK, 'gf.json'), JSON.stringify(out), 'utf8');
  const n = (k) => out.filter(x => x.kind === k).length;
  console.log('збережено work/gf.json — реплік:', n('say'), '| ремарок:', n('stage'));
})().catch(e => { console.error('не вдалося:', e.message); process.exit(1); });
