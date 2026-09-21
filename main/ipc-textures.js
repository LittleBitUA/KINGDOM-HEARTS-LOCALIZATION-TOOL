'use strict';

// «Текстури» — написи інтерфейсу, що є картинками, а не текстом.
//   Re:CoM: remastered/FORM/<n>/FOxxxx.RTM/UK_*.imz (контейнер IMGZ з IMGD-текстурами)
//           та кілька готових UK_*.png у Recom.hed_out.
//   BBS:    remastered/arc_en/<група>/<name>.arc/US_<name>_arcN.dds|png — HD-заміни
//           текстур із SD-архівів (.dds — нестиснені A8R8G8B8, один mip) у bbs_*.hed_out.
// Спільна механіка: скан розпакованої гри → список текстур із мініатюрами; заміна
// конкретної текстури своїм PNG (той самий розмір) → PNG копіюється у
// PROGRESS/textures/, облік у PROGRESS/_textures.json, а перезібраний файл одразу
// пишеться у DONE/<archive>/<rel> — тобто потрапляє у «Зібрати патч» разом із текстами.
// Усі виклики приймають gameId (типово kh-re-com — сумісність):
//   textures:scan({ gameId, tsvDir })                  → { items: [{ rel, kind, folder, entries }] }
//   textures:thumb({ gameId, rel, index, kind, max, tsvDir }) → { dataUrl, w, h }
//   textures:pick() / textures:replace({ gameId, rel, index, kind, pngPath, tsvDir, outDir })
//   textures:reset({ gameId, rel, index, kind, tsvDir, outDir })
//   textures:export({ gameId, rel?, index?, kind?, tsvDir }) — усі (або одну) у PNG обраної теки
//   textures:importDir({ gameId, tsvDir, outDir })     — тека з PNG → заміни
//   textures:reveal({ gameId, rel, outDir })

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsP = require('fs/promises');
const win = require('./window');
const { writeFileAtomic } = require('../shared/safe-fs');
const { loadSettingsRaw } = require('./settings');
const { findDirNamed } = require('./ipc-uafonts');
const { parseImgz, imgdInfo, decodeImgd, replaceImgz } = require('../tools/lib/recom-imgz');
const { ddsInfo, decodeDds, encodeDds } = require('../tools/lib/dds');
const { decodePng, encodePng } = require('../tools/lib/png');

const STATE_FILENAME = '_textures.json';
const statePath = (tsvDir) => path.join(tsvDir, STATE_FILENAME);
const pngStoreDir = (tsvDir) => path.join(tsvDir, 'textures');

function gameDirFor(gameId) {
  try { const raw = loadSettingsRaw(); return (raw.gameDirectories && raw.gameDirectories[gameId]) || ''; } catch (_) { return ''; }
}
function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

// =====================================================================
// Провайдери: як знайти розпаковану гру, які файли є текстурами, як їх
// читати/писати. rel — шлях відносно кореня провайдера (root); DONE-шлях —
// doneRel(rel) (у розкладці патчу: <archive>/(original|remastered)/…).
// =====================================================================
const PROVIDERS = {
  'kh-re-com': {
    notFound: 'Recom.hed_out не знайдено — запусти Setup для Re:CoM (розпакування гри)',
    root() { const g = gameDirFor('kh-re-com'); return g ? findDirNamed(g, 'Recom.hed_out', 4) : null; },
    // UK_*.imz і UK_*.png під remastered/ (мовні файли — саме в них написи)
    list(root) {
      const out = [];
      const rec = (dir, base) => {
        let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const e of entries) {
          const rel = base + '/' + e.name;
          if (e.isDirectory()) rec(path.join(dir, e.name), rel);
          else if (/^UK_.*\.imz$/i.test(e.name)) out.push({ rel, kind: 'imz' });
          else if (/^UK_.*\.png$/i.test(e.name) && /^remastered\/FORM\//.test(rel)) out.push({ rel, kind: 'png' });
        }
      };
      rec(path.join(root, 'remastered'), 'remastered');
      return out;
    },
    folder: (rel) => rel.replace(/^remastered\//, '').split('/').slice(0, 2).join('/'),   // FORM/0002
    abs: (root, rel) => path.join(root, rel),
    doneRel: (rel) => 'Recom/' + rel,
    // експорт: <rel>.<i>.png для imz, <rel> для png; імпорт — зворотне
    exportName: (rel, kind, index) => (kind === 'imz' ? rel + '.' + index + '.png' : rel),
    parseExportPath(sub, known) {
      const i = sub.toLowerCase().indexOf('remastered/');
      if (i < 0) return null;
      sub = sub.slice(i);
      const m = /^(.*\.imz)\.(\d+)\.png$/i.exec(sub);
      if (m && known.has(m[1].toLowerCase())) return { f: known.get(m[1].toLowerCase()), index: parseInt(m[2], 10) };
      if (known.has(sub.toLowerCase())) return { f: known.get(sub.toLowerCase()), index: 0 };
      return null;
    }
  },
  'kh-bbs-final-mix': {
    notFound: 'bbs_first.hed_out не знайдено — запусти Setup для BBS (розпакування гри)',
    // root = тека з bbs_*.hed_out (Image/dt); rel = '<archive>/remastered/arc_en/…'
    root() { const g = gameDirFor('kh-bbs-final-mix'); const h = g ? findDirNamed(g, 'bbs_first.hed_out', 4) : null; return h ? path.dirname(h) : null; },
    list(root) {
      const out = [];
      let tops; try { tops = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return out; }
      for (const t of tops) {
        if (!t.isDirectory() || !/^bbs_.*\.hed_out$/i.test(t.name)) continue;
        const archive = t.name.replace(/\.hed_out$/i, '');
        const base = path.join(root, t.name, 'remastered');
        let langs; try { langs = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
        for (const l of langs) {
          if (!l.isDirectory() || !/^arc_en$/i.test(l.name)) continue;   // англійські HD-текстури (US_*) — у них написи
          const rec = (dir, rel) => {
            let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
            for (const e of entries) {
              const r = rel + '/' + e.name;
              if (e.isDirectory()) rec(path.join(dir, e.name), r);
              else if (/\.dds$/i.test(e.name)) out.push({ rel: r, kind: 'dds' });
              else if (/\.png$/i.test(e.name)) out.push({ rel: r, kind: 'png' });
            }
          };
          rec(path.join(base, l.name), archive + '/remastered/' + l.name);
        }
      }
      return out;
    },
    folder: (rel) => rel.split('/').slice(3, 5).join('/'),   // menu/camp.arc
    abs: (root, rel) => { const i = rel.indexOf('/'); return path.join(root, rel.slice(0, i) + '.hed_out', rel.slice(i + 1)); },
    doneRel: (rel) => rel,
    // експорт: <rel>.png для dds (US_x_arc0.dds.png), <rel> для png
    exportName: (rel, kind) => (kind === 'dds' ? rel + '.png' : rel),
    parseExportPath(sub, known) {
      const m0 = /(^|\/)(bbs_[a-z]+)\/remastered\//i.exec(sub);
      if (!m0) return null;
      sub = sub.slice(m0.index + (m0[1] ? 1 : 0));
      const m = /^(.*\.dds)\.png$/i.exec(sub);
      if (m && known.has(m[1].toLowerCase())) return { f: known.get(m[1].toLowerCase()), index: 0 };
      if (known.has(sub.toLowerCase())) return { f: known.get(sub.toLowerCase()), index: 0 };
      return null;
    }
  }
};
function provider(gameId) { return PROVIDERS[gameId] || PROVIDERS['kh-re-com']; }
function ctx(payload) {
  const p = payload || {};
  const gameId = String(p.gameId || 'kh-re-com');
  const prov = provider(gameId);
  const root = prov.root();
  return { p, gameId, prov, root };
}

function readState(tsvDir) {
  try { const s = JSON.parse(fs.readFileSync(statePath(tsvDir), 'utf8')); return s && s.files ? s : { version: 1, files: {} }; }
  catch (_) { return { version: 1, files: {} }; }
}
async function writeState(tsvDir, st) { await writeFileAtomic(statePath(tsvDir), JSON.stringify(st, null, 1)); }

// Записи текстур у файлі (imz — кілька, dds/png — один) з розмірами.
function entriesOf(buf, kind) {
  if (kind === 'imz') {
    const entries = [];
    for (const en of parseImgz(buf)) {
      let inf; try { inf = imgdInfo(buf.subarray(en.off, en.off + en.size)); } catch (_) { continue; }
      entries.push({ index: en.index, w: inf.w, h: inf.h, bpp: inf.bpp, format: 'IMGZ · IMGD ' + inf.bpp + 'bpp', replaceable: inf.bpp === 32 });
    }
    return entries;
  }
  if (kind === 'dds') {
    const inf = ddsInfo(buf);
    const fmt = inf.compressed ? 'DDS ' + inf.fourcc : 'DDS ' + inf.bpp + '-bit' + (inf.masks.a ? ' ARGB' : ' RGB');
    return [{ index: 0, w: inf.w, h: inf.h, bpp: inf.bpp, format: fmt, replaceable: !inf.compressed && (inf.bpp === 32 || inf.bpp === 24) }];
  }
  const { w, h } = pngSize(buf);
  return [{ index: 0, w, h, bpp: 32, format: 'PNG', replaceable: true }];
}

ipcMain.handle('textures:scan', async (_e, payload) => {
  const { p, prov, root } = ctx(payload);
  if (!root) return { ok: false, error: prov.notFound };
  const st = p.tsvDir ? readState(p.tsvDir) : { files: {} };
  const items = [];
  let textures = 0, replaced = 0;
  for (const f of prov.list(root)) {
    const rep = st.files[f.rel] || {};
    let buf;
    try { buf = await fsP.readFile(prov.abs(root, f.rel)); } catch (_) { continue; }
    let entries;
    try { entries = entriesOf(buf, f.kind); } catch (e) { items.push({ rel: f.rel, kind: f.kind, folder: prov.folder(f.rel), error: e.message, entries: [] }); continue; }
    for (const en of entries) en.replaced = !!rep[en.index];
    textures += entries.length; replaced += entries.filter(x => x.replaced).length;
    items.push({ rel: f.rel, kind: f.kind, folder: prov.folder(f.rel), entries });
  }
  return { ok: true, root, items, stats: { files: items.length, textures, replaced } };
});

// ---- читання текстури (оригінал або заміна) → RGBA ----
function decodeEntry(buf, kind, index) {
  if (kind === 'png') return decodePng(buf);
  if (kind === 'dds') return decodeDds(buf);
  const en = parseImgz(buf)[index];
  if (!en) throw new Error('немає текстури #' + index);
  return decodeImgd(buf.subarray(en.off, en.off + en.size));
}
async function loadRgba(prov, root, tsvDir, rel, index, kind) {
  const st = tsvDir ? readState(tsvDir) : { files: {} };
  const rep = (st.files[rel] || {})[index];
  if (rep) {
    const abs = path.join(pngStoreDir(tsvDir), rep);
    try { const d = decodePng(await fsP.readFile(abs)); return Object.assign(d, { replaced: true, mtime: (await fsP.stat(abs)).mtimeMs }); } catch (_) {}
  }
  const buf = await fsP.readFile(prov.abs(root, rel));
  return Object.assign(decodeEntry(buf, kind, index), { replaced: false, mtime: 0 });
}

// зменшення box-фільтром до max по більшій стороні (мініатюри)
function downscale(img, max) {
  const k = Math.ceil(Math.max(img.width, img.height) / max);
  if (k <= 1) return img;
  const w = Math.ceil(img.width / k), h = Math.ceil(img.height / k);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y * k; yy < Math.min(img.height, (y + 1) * k); yy++) for (let xx = x * k; xx < Math.min(img.width, (x + 1) * k); xx++) {
      const o = (yy * img.width + xx) * 4; const al = img.rgba[o + 3];
      r += img.rgba[o] * al; g += img.rgba[o + 1] * al; b += img.rgba[o + 2] * al; a += al; n++;
    }
    const o = (y * w + x) * 4;
    out[o] = a ? Math.round(r / a) : 0; out[o + 1] = a ? Math.round(g / a) : 0; out[o + 2] = a ? Math.round(b / a) : 0; out[o + 3] = Math.round(a / n);
  }
  return { width: w, height: h, rgba: out };
}

const thumbCache = new Map();
ipcMain.handle('textures:thumb', async (_e, payload) => {
  const { p, gameId, prov, root } = ctx(payload);
  if (!root) return { ok: false, error: prov.notFound };
  try {
    const img = await loadRgba(prov, root, p.tsvDir, p.rel, p.index | 0, p.kind);
    const max = p.max | 0;
    const key = [gameId, p.rel, p.index | 0, img.replaced ? img.mtime : 0, max].join('|');
    if (thumbCache.has(key)) return thumbCache.get(key);
    const small = max ? downscale(img, max) : img;
    const r = { ok: true, w: img.width, h: img.height, replaced: img.replaced, dataUrl: 'data:image/png;base64,' + encodePng(small.width, small.height, small.rgba).toString('base64') };
    if (thumbCache.size > 400) thumbCache.clear();
    thumbCache.set(key, r);
    return r;
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

// ---- заміна ----
ipcMain.handle('textures:pick', async () => {
  const r = await dialog.showOpenDialog(win.get(), { title: 'PNG для заміни текстури', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  return { ok: true, pngPath: r.filePaths[0] };
});

// Перезбирає DONE/<doneRel> з оригіналу + усіх зареєстрованих PNG; без замін — видаляє.
async function rebuild(prov, root, tsvDir, outDir, rel, kind) {
  const st = readState(tsvDir);
  const rep = st.files[rel] || {};
  const dst = path.join(outDir, prov.doneRel(rel));
  if (!Object.keys(rep).length) { await fsP.rm(dst, { force: true }); return { removed: true }; }
  await fsP.mkdir(path.dirname(dst), { recursive: true });
  if (kind === 'png') { await fsP.copyFile(path.join(pngStoreDir(tsvDir), rep[0]), dst); return { written: dst }; }
  const orig = await fsP.readFile(prov.abs(root, rel));
  let out;
  if (kind === 'dds') {
    const img = decodePng(await fsP.readFile(path.join(pngStoreDir(tsvDir), rep[0])));
    out = encodeDds(orig, img.width, img.height, img.rgba);
  } else {
    const repl = {};
    for (const [idx, file] of Object.entries(rep)) repl[idx] = decodePng(await fsP.readFile(path.join(pngStoreDir(tsvDir), file)));
    out = replaceImgz(orig, repl);
  }
  await writeFileAtomic(dst, out);
  return { written: dst };
}

async function registerPng(prov, root, tsvDir, rel, index, kind, pngPath) {
  const png = await fsP.readFile(pngPath);
  const img = decodePng(png);
  // перевірка розміру/формату проти оригіналу
  const orig = await fsP.readFile(prov.abs(root, rel));
  const en = entriesOf(orig, kind).find(x => x.index === index);
  if (!en) throw new Error('немає текстури #' + index);
  if (en.w !== img.width || en.h !== img.height) throw new Error('розмір PNG ' + img.width + '×' + img.height + ' ≠ ' + en.w + '×' + en.h + ' в оригіналі');
  if (!en.replaceable) throw new Error(en.format + ' — заміна не підтримується');
  const storeRel = kind === 'imz' ? rel + '.' + index + '.png' : (kind === 'dds' ? rel + '.png' : rel);
  const storeAbs = path.join(pngStoreDir(tsvDir), storeRel);
  await fsP.mkdir(path.dirname(storeAbs), { recursive: true });
  if (path.resolve(storeAbs) !== path.resolve(pngPath)) await fsP.copyFile(pngPath, storeAbs);
  const st = readState(tsvDir);
  if (!st.files[rel]) st.files[rel] = {};
  st.files[rel][index] = storeRel;
  await writeState(tsvDir, st);
  return img;
}

ipcMain.handle('textures:replace', async (_e, payload) => {
  const { p, prov, root } = ctx(payload);
  if (!root) return { ok: false, error: prov.notFound };
  if (!p.tsvDir || !p.outDir) return { ok: false, error: 'Не задано теки PROGRESS / DONE' };
  try {
    const img = await registerPng(prov, root, p.tsvDir, p.rel, p.index | 0, p.kind, p.pngPath);
    const r = await rebuild(prov, root, p.tsvDir, p.outDir, p.rel, p.kind);
    return { ok: true, w: img.width, h: img.height, written: r.written || '' };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

ipcMain.handle('textures:reset', async (_e, payload) => {
  const { p, prov, root } = ctx(payload);
  if (!root) return { ok: false, error: prov.notFound };
  if (!p.tsvDir || !p.outDir) return { ok: false, error: 'Не задано теки PROGRESS / DONE' };
  try {
    const st = readState(p.tsvDir);
    const rep = st.files[p.rel] || {};
    const file = rep[p.index | 0];
    if (file) { delete rep[p.index | 0]; await fsP.rm(path.join(pngStoreDir(p.tsvDir), file), { force: true }); }
    if (!Object.keys(rep).length) delete st.files[p.rel];
    await writeState(p.tsvDir, st);
    const r = await rebuild(prov, root, p.tsvDir, p.outDir, p.rel, p.kind);
    return { ok: true, removed: !!r.removed };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

// ---- експорт у PNG (усі або одна) ----
ipcMain.handle('textures:export', async (_e, payload) => {
  const { p, prov, root } = ctx(payload);
  if (!root) return { ok: false, error: prov.notFound };
  const r = await dialog.showOpenDialog(win.get(), { title: 'Тека для PNG (розкладка <archive>/remastered/…)', properties: ['openDirectory', 'createDirectory'], defaultPath: p.defaultDir || undefined });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const dir = r.filePaths[0];
  const files = p.rel ? [{ rel: p.rel, kind: p.kind }] : prov.list(root);
  let count = 0;
  const errors = [];
  for (const f of files) {
    try {
      const abs = prov.abs(root, f.rel);
      const doneRel = prov.doneRel(f.rel);
      if (f.kind === 'png') {
        const dst = path.join(dir, doneRel); await fsP.mkdir(path.dirname(dst), { recursive: true });
        await fsP.copyFile(abs, dst); count++; continue;
      }
      const buf = await fsP.readFile(abs);
      const meta = [];
      for (const en of entriesOf(buf, f.kind)) {
        if (p.rel && p.index != null && en.index !== (p.index | 0)) continue;
        const img = decodeEntry(buf, f.kind, en.index);
        const dst = path.join(dir, prov.doneRel(prov.exportName(f.rel, f.kind, en.index)));
        await fsP.mkdir(path.dirname(dst), { recursive: true });
        await fsP.writeFile(dst, encodePng(img.width, img.height, img.rgba));
        meta.push({ index: en.index, png: path.basename(dst), width: img.width, height: img.height, format: en.format });
        count++;
      }
      if (p.index == null && f.kind === 'imz') await fsP.writeFile(path.join(dir, doneRel + '.json'), JSON.stringify({ source: f.rel, textures: meta }, null, 1));
    } catch (e) { errors.push(f.rel + ': ' + e.message); }
  }
  return { ok: true, dir, count, errors };
});

// ---- імпорт теки з PNG: розкладка експорту (<archive>/remastered/…) ----
ipcMain.handle('textures:importDir', async (_e, payload) => {
  const { p, prov, root } = ctx(payload);
  if (!root) return { ok: false, error: prov.notFound };
  if (!p.tsvDir || !p.outDir) return { ok: false, error: 'Не задано теки PROGRESS / DONE' };
  const r = await dialog.showOpenDialog(win.get(), { title: 'Тека з відредагованими PNG', properties: ['openDirectory'], defaultPath: p.defaultDir || undefined });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const dir = r.filePaths[0];
  const known = new Map(prov.list(root).map(f => [f.rel.toLowerCase(), f]));
  const found = [];
  const rec = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { rec(abs); continue; }
      if (!/\.png$/i.test(e.name)) continue;
      const sub = path.relative(dir, abs).split(path.sep).join('/');
      const hit = prov.parseExportPath(sub, known);
      if (hit) found.push({ f: hit.f, index: hit.index, abs });
    }
  };
  rec(dir);
  let count = 0, unchanged = 0;
  const errors = [];
  const touched = new Set();
  for (const it of found) {
    try {
      // однакові з оригіналом PNG не реєструємо (експортовані, але не редаговані)
      const orig = await loadRgba(prov, root, null, it.f.rel, it.index, it.f.kind);
      const img = decodePng(await fsP.readFile(it.abs));
      if (img.width === orig.width && img.height === orig.height && img.rgba.equals(orig.rgba)) { unchanged++; continue; }
      await registerPng(prov, root, p.tsvDir, it.f.rel, it.index, it.f.kind, it.abs);
      touched.add(it.f.rel + '\u0001' + it.f.kind); count++;
    } catch (e) { errors.push(path.basename(it.abs) + ': ' + e.message); }
  }
  for (const k of touched) { const [rel, kind] = k.split('\u0001'); try { await rebuild(prov, root, p.tsvDir, p.outDir, rel, kind); } catch (e) { errors.push(rel + ': ' + e.message); } }
  return { ok: true, dir, found: found.length, count, unchanged, errors };
});

ipcMain.handle('textures:reveal', async (_e, payload) => {
  const { p, prov, root } = ctx(payload);
  const done = p.outDir && p.rel ? path.join(p.outDir, prov.doneRel(p.rel)) : '';
  const target = done && fs.existsSync(done) ? done : (root && p.rel ? prov.abs(root, p.rel) : '');
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'Файл не знайдено' };
  shell.showItemInFolder(target);
  return { ok: true, path: target };
});

// Сумісність: список текстур Re:CoM і тека Recom.hed_out (використовує ipc-patch/smoke).
function hedOutDir() { return PROVIDERS['kh-re-com'].root(); }
function listTextureFiles(hedOut) { return PROVIDERS['kh-re-com'].list(hedOut); }

module.exports = { listTextureFiles, hedOutDir, PROVIDERS };
