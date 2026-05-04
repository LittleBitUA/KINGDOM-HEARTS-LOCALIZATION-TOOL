'use strict';

// Setup-tools: завантаження зовнішніх інструментів (OpenKH, KHPCPatchManager)
// з GitHub Releases. Без сторонніх npm-залежностей — використовуємо вбудований
// `https`. Підтримуємо redirect-ланцюжки (GitHub releases → S3) і progress.
//
// Експорти:
//   fetchLatestRelease(owner, repo) → Promise<{tag, assets: [{name, url, size}]}>
//   downloadFile(url, destPath, onProgress?) → Promise<{bytes, alreadyExisted}>
//   pickAsset(assets, predicate) → asset або null
//
// onProgress отримує { phase, downloaded, total, percent }.

const https = require('https');
const http = require('http');
const fs = require('fs');
const fsP = require('fs/promises');
const path = require('path');

const USER_AGENT = 'KH1-Localization-Tool/setup';

// ---- HTTP helpers ------------------------------------------------------

function _get(url, opts) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const reqOpts = {
      method: 'GET',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers: Object.assign({
        'User-Agent': USER_AGENT,
        'Accept': '*/*'
      }, (opts && opts.headers) || {})
    };
    const req = lib.request(reqOpts, (res) => resolve(res));
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('HTTP timeout after 30s: ' + url));
    });
    req.end();
  });
}

// Робить GET з automatic redirect handling (max 5).
async function getFollow(url, opts) {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await _get(cur, opts);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      // Споживаємо response, щоб звільнити сокет
      res.resume();
      const next = new URL(res.headers.location, cur).toString();
      cur = next;
      continue;
    }
    return { res, finalUrl: cur };
  }
  throw new Error('Too many redirects starting at ' + url);
}

// ---- Public API --------------------------------------------------------

// Latest release з GitHub API.
async function fetchLatestRelease(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const { res } = await getFollow(url, {
    headers: { 'Accept': 'application/vnd.github+json' }
  });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`GitHub API ${owner}/${repo}: HTTP ${res.statusCode}`);
  }
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  let json;
  try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (e) { throw new Error('GitHub API: invalid JSON for ' + owner + '/' + repo); }
  const assets = (json.assets || []).map(a => ({
    name: a.name,
    url: a.browser_download_url,
    size: a.size,
    contentType: a.content_type
  }));
  return {
    tag: json.tag_name,
    name: json.name,
    publishedAt: json.published_at,
    htmlUrl: json.html_url,
    assets
  };
}

// Знайти 1 asset за predicate (function або regex).
function pickAsset(assets, predicate) {
  if (!assets || !assets.length) return null;
  if (predicate instanceof RegExp) {
    return assets.find(a => predicate.test(a.name)) || null;
  }
  if (typeof predicate === 'function') {
    return assets.find(predicate) || null;
  }
  return null;
}

// Завантажити файл з прогресом. Якщо destPath вже існує і має non-zero
// розмір та `skipIfExists`=true (дефолт) — пропускаємо без перезавантаження.
async function downloadFile(url, destPath, onProgress, options) {
  const opts = options || {};
  const skipIfExists = opts.skipIfExists !== false;

  if (skipIfExists) {
    try {
      const st = await fsP.stat(destPath);
      if (st.size > 0) {
        return { bytes: st.size, alreadyExisted: true, destPath };
      }
    } catch (_) { /* немає файлу — завантажуємо */ }
  }

  await fsP.mkdir(path.dirname(destPath), { recursive: true });

  const tmpPath = destPath + '.part';
  // Очищаємо .part-залишок від попереднього невдалого завантаження.
  try { await fsP.unlink(tmpPath); } catch (_) {}

  const { res } = await getFollow(url);
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`Download failed (HTTP ${res.statusCode}) for ${url}`);
  }

  const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
  let downloaded = 0;
  let lastEmit = 0;

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    let aborted = false;
    const fail = (err) => {
      if (aborted) return;
      aborted = true;
      out.destroy();
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      reject(err);
    };
    res.on('data', (chunk) => {
      downloaded += chunk.length;
      if (typeof onProgress === 'function') {
        const now = Date.now();
        if (now - lastEmit >= 100 || (total && downloaded === total)) {
          lastEmit = now;
          const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
          try { onProgress({ downloaded, total, percent }); } catch (_) {}
        }
      }
    });
    res.on('error', fail);
    out.on('error', fail);
    res.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      out.close((err) => err ? fail(err) : resolve());
    });
  });

  // Atomic rename
  await fsP.rename(tmpPath, destPath);
  return { bytes: downloaded, alreadyExisted: false, destPath };
}

// ---- ZIP extraction ----------------------------------------------------
//
// Використовуємо вбудований у Windows PowerShell `Expand-Archive` —
// нульові npm-залежності, працює без attachments. Якщо у майбутньому
// захочемо крос-платформенність — заміна через `adm-zip` чи `yauzl`.

const { spawn } = require('child_process');

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // -Force перезаписує існуючі файли (якщо тут уже лежить попередня версія).
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    ];
    const ps = spawn('powershell.exe', args, { windowsHide: true });
    let stderr = '';
    ps.stderr.on('data', (b) => { stderr += b.toString(); });
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0) resolve({ destDir });
      else reject(new Error('Expand-Archive exit ' + code + ': ' + stderr.trim()));
    });
  });
}

// Якщо у `dir` після розпакування єдиний дочірній каталог (типова ситуація
// коли zip має кореневу папку), переносимо його вміст на рівень вище і
// видаляємо порожню обгортку. Унеможливлює `tools/openkh/openkh/...`.
async function flattenIfSingleSubdir(dir) {
  const fsP = require('fs/promises');
  const path = require('path');
  let items;
  try { items = await fsP.readdir(dir, { withFileTypes: true }); }
  catch (_) { return; }
  if (items.length !== 1 || !items[0].isDirectory()) return;
  const inner = path.join(dir, items[0].name);
  // Якщо назва підпапки збігається з назвою dir (наприклад обидві `openkh`),
  // спочатку переносимо її у тимчасовий шлях, щоб не було конфлікту імен
  // при rename.
  const tmp = path.join(dir, '__flatten_tmp__');
  await fsP.rename(inner, tmp);
  const innerItems = await fsP.readdir(tmp);
  for (const name of innerItems) {
    await fsP.rename(path.join(tmp, name), path.join(dir, name));
  }
  await fsP.rmdir(tmp);
}

module.exports = {
  fetchLatestRelease,
  pickAsset,
  downloadFile,
  extractZip,
  flattenIfSingleSubdir
};
