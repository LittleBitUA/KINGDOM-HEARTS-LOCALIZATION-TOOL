'use strict';

// «Текстури» Re:CoM: написи інтерфейсу (FRIENDS, CARDS, LEVEL UP!, BONUS,
// підказки меню…) лежать у remastered/FORM/<n>/FOxxxx.RTM/UK_*.imz (контейнер
// IMGZ з IMGD-текстурами) та кількох готових UK_*.png. Тут: скан розпакованої
// гри (Recom.hed_out) → список текстур із мініатюрами; заміна конкретної
// текстури своїм PNG (той самий розмір) → PNG копіюється у PROGRESS/textures/,
// облік у PROGRESS/_textures.json, а перезібраний .imz одразу пишеться у
// DONE/Recom/<rel> — тобто потрапляє у «Зібрати патч» разом із текстами.
//   textures:scan({ tsvDir })                → { items: [{ rel, kind, entries }] }
//   textures:thumb({ rel, index, max, tsvDir }) → { dataUrl, w, h }
//   textures:pick() / textures:replace({ rel, index, pngPath, tsvDir, outDir })
//   textures:reset({ rel, index, tsvDir, outDir })
//   textures:export({ rel?, index?, tsvDir })  — усі (або одну) у PNG обраної теки
//   textures:importDir({ tsvDir, outDir })     — тека з PNG (<name>.imz.<i>.png) → заміни
//   textures:reveal({ rel, outDir })

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsP = require('fs/promises');
const win = require('./window');
const { writeFileAtomic } = require('../shared/safe-fs');
const { loadSettingsRaw } = require('./settings');
const { findDirNamed } = require('./ipc-uafonts');
const { parseImgz, imgdInfo, decodeImgd, replaceImgz } = require('../tools/lib/recom-imgz');
const { decodePng, encodePng } = require('../tools/lib/png');

const STATE_FILENAME = '_textures.json';
const ARCHIVE = 'Recom';                       // верхня тека розкладки патчу
const statePath = (tsvDir) => path.join(tsvDir, STATE_FILENAME);
const pngStoreDir = (tsvDir) => path.join(tsvDir, 'textures');

function hedOutDir() {
  try {
    const raw = loadSettingsRaw();
    const gameDir = raw.gameDirectories && raw.gameDirectories['kh-re-com'];
    if (gameDir) return findDirNamed(gameDir, 'Recom.hed_out', 4);
  } catch (_) {}
  return null;
}

function readState(tsvDir) {
  try { const s = JSON.parse(fs.readFileSync(statePath(tsvDir), 'utf8')); return s && s.files ? s : { version: 1, files: {} }; }
  catch (_) { return { version: 1, files: {} }; }
}
async function writeState(tsvDir, st) { await writeFileAtomic(statePath(tsvDir), JSON.stringify(st, null, 1)); }

// Список текстур: UK_*.imz і UK_*.png під remastered/ (мовні файли — саме в них написи).
function listTextureFiles(hedOut) {
  const out = [];
  const rec = (dir, base) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) rec(path.join(dir, e.name), rel);
      else if (/^UK_.*\.imz$/i.test(e.name)) out.push({ rel, kind: 'imz' });
      else if (/^UK_.*\.png$/i.test(e.name) && /^remastered\/FORM\//.test(rel)) out.push({ rel, kind: 'png' });
    }
  };
  rec(path.join(hedOut, 'remastered'), 'remastered');
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

ipcMain.handle('textures:scan', async (_e, payload) => {
  const p = payload || {};
  const hedOut = hedOutDir();
  if (!hedOut) return { ok: false, error: 'Recom.hed_out не знайдено — запусти Setup для Re:CoM (розпакування гри)' };
  const st = p.tsvDir ? readState(p.tsvDir) : { files: {} };
  const items = [];
  let textures = 0, replaced = 0;
  for (const f of listTextureFiles(hedOut)) {
    const abs = path.join(hedOut, f.rel);
    const rep = st.files[f.rel] || {};
    const entries = [];
    if (f.kind === 'imz') {
      let buf;
      try { buf = await fsP.readFile(abs); } catch (_) { continue; }
      let list;
      try { list = parseImgz(buf); } catch (e) { items.push({ rel: f.rel, kind: f.kind, error: e.message, entries: [] }); continue; }
      for (const en of list) {
        let inf;
        try { inf = imgdInfo(buf.subarray(en.off, en.off + en.size)); } catch (_) { continue; }
        entries.push({ index: en.index, w: inf.w, h: inf.h, bpp: inf.bpp, replaced: !!rep[en.index] });
      }
    } else {
      let w = 0, h = 0;
      try { const b = await fsP.readFile(abs); w = b.readUInt32BE(16); h = b.readUInt32BE(20); } catch (_) {}
      entries.push({ index: 0, w, h, bpp: 32, replaced: !!rep[0] });
    }
    textures += entries.length; replaced += entries.filter(x => x.replaced).length;
    items.push({ rel: f.rel, kind: f.kind, entries });
  }
  return { ok: true, hedOut, items, stats: { files: items.length, textures, replaced } };
});

// ---- читання текстури (оригінал або заміна) → RGBA ----
async function loadRgba(hedOut, tsvDir, rel, index, kind) {
  const st = tsvDir ? readState(tsvDir) : { files: {} };
  const rep = (st.files[rel] || {})[index];
  if (rep) {
    const abs = path.join(pngStoreDir(tsvDir), rep);
    try { const d = decodePng(await fsP.readFile(abs)); return Object.assign(d, { replaced: true, mtime: (await fsP.stat(abs)).mtimeMs }); } catch (_) {}
  }
  const abs = path.join(hedOut, rel);
  const buf = await fsP.readFile(abs);
  if (kind === 'png') return Object.assign(decodePng(buf), { replaced: false, mtime: 0 });
  const en = parseImgz(buf)[index];
  if (!en) throw new Error('немає текстури #' + index + ' у ' + rel);
  return Object.assign(decodeImgd(buf.subarray(en.off, en.off + en.size)), { replaced: false, mtime: 0 });
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
  const p = payload || {};
  const hedOut = hedOutDir();
  if (!hedOut) return { ok: false, error: 'Recom.hed_out не знайдено' };
  try {
    const img = await loadRgba(hedOut, p.tsvDir, p.rel, p.index | 0, p.kind);
    const max = p.max | 0;
    const key = [p.rel, p.index | 0, img.replaced ? img.mtime : 0, max].join('|');
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

// Перезбирає DONE/Recom/<rel> з оригіналу + усіх зареєстрованих PNG; без замін — видаляє.
async function rebuild(hedOut, tsvDir, outDir, rel, kind) {
  const st = readState(tsvDir);
  const rep = st.files[rel] || {};
  const dst = path.join(outDir, ARCHIVE, rel);
  if (!Object.keys(rep).length) { await fsP.rm(dst, { force: true }); return { removed: true }; }
  if (kind === 'png') {
    await fsP.mkdir(path.dirname(dst), { recursive: true });
    await fsP.copyFile(path.join(pngStoreDir(tsvDir), rep[0]), dst);
    return { written: dst };
  }
  const orig = await fsP.readFile(path.join(hedOut, rel));
  const repl = {};
  for (const [idx, file] of Object.entries(rep)) repl[idx] = decodePng(await fsP.readFile(path.join(pngStoreDir(tsvDir), file)));
  const out = replaceImgz(orig, repl);
  await fsP.mkdir(path.dirname(dst), { recursive: true });
  await writeFileAtomic(dst, out);
  return { written: dst };
}

async function registerPng(hedOut, tsvDir, outDir, rel, index, kind, pngPath) {
  const png = await fsP.readFile(pngPath);
  const img = decodePng(png);
  // перевірка розміру/формату проти оригіналу
  const orig = await fsP.readFile(path.join(hedOut, rel));
  if (kind === 'imz') {
    const en = parseImgz(orig)[index];
    if (!en) throw new Error('немає текстури #' + index);
    const inf = imgdInfo(orig.subarray(en.off, en.off + en.size));
    if (inf.w !== img.width || inf.h !== img.height) throw new Error('розмір PNG ' + img.width + '×' + img.height + ' ≠ ' + inf.w + '×' + inf.h + ' в оригіналі');
    if (inf.bpp !== 32) throw new Error('ця текстура 8bpp (з палітрою) — заміна не підтримується');
  } else {
    const ow = orig.readUInt32BE(16), oh = orig.readUInt32BE(20);
    if (ow !== img.width || oh !== img.height) throw new Error('розмір PNG ' + img.width + '×' + img.height + ' ≠ ' + ow + '×' + oh + ' в оригіналі');
  }
  const storeRel = kind === 'imz' ? rel + '.' + index + '.png' : rel;
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
  const p = payload || {};
  const hedOut = hedOutDir();
  if (!hedOut) return { ok: false, error: 'Recom.hed_out не знайдено' };
  if (!p.tsvDir || !p.outDir) return { ok: false, error: 'Не задано теки PROGRESS / DONE' };
  try {
    const img = await registerPng(hedOut, p.tsvDir, p.outDir, p.rel, p.index | 0, p.kind, p.pngPath);
    const r = await rebuild(hedOut, p.tsvDir, p.outDir, p.rel, p.kind);
    return { ok: true, w: img.width, h: img.height, written: r.written || '' };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

ipcMain.handle('textures:reset', async (_e, payload) => {
  const p = payload || {};
  const hedOut = hedOutDir();
  if (!hedOut) return { ok: false, error: 'Recom.hed_out не знайдено' };
  if (!p.tsvDir || !p.outDir) return { ok: false, error: 'Не задано теки PROGRESS / DONE' };
  try {
    const st = readState(p.tsvDir);
    const rep = st.files[p.rel] || {};
    const file = rep[p.index | 0];
    if (file) { delete rep[p.index | 0]; await fsP.rm(path.join(pngStoreDir(p.tsvDir), file), { force: true }); }
    if (!Object.keys(rep).length) delete st.files[p.rel];
    await writeState(p.tsvDir, st);
    const r = await rebuild(hedOut, p.tsvDir, p.outDir, p.rel, p.kind);
    return { ok: true, removed: !!r.removed };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

// ---- експорт у PNG (усі або одна) ----
ipcMain.handle('textures:export', async (_e, payload) => {
  const p = payload || {};
  const hedOut = hedOutDir();
  if (!hedOut) return { ok: false, error: 'Recom.hed_out не знайдено' };
  const r = await dialog.showOpenDialog(win.get(), { title: 'Тека для PNG (розкладка Recom/remastered/…)', properties: ['openDirectory', 'createDirectory'], defaultPath: p.defaultDir || undefined });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const dir = r.filePaths[0];
  const files = p.rel ? [{ rel: p.rel, kind: p.kind }] : listTextureFiles(hedOut);
  let count = 0;
  const errors = [];
  for (const f of files) {
    try {
      if (f.kind === 'png') {
        const dst = path.join(dir, f.rel); await fsP.mkdir(path.dirname(dst), { recursive: true });
        await fsP.copyFile(path.join(hedOut, f.rel), dst); count++; continue;
      }
      const buf = await fsP.readFile(path.join(hedOut, f.rel));
      const meta = [];
      for (const en of parseImgz(buf)) {
        if (p.rel && p.index != null && en.index !== (p.index | 0)) continue;
        const sub = buf.subarray(en.off, en.off + en.size);
        const img = decodeImgd(sub);
        const dst = path.join(dir, f.rel + '.' + en.index + '.png');
        await fsP.mkdir(path.dirname(dst), { recursive: true });
        await fsP.writeFile(dst, encodePng(img.width, img.height, img.rgba));
        meta.push({ index: en.index, png: path.basename(dst), width: img.width, height: img.height, bpp: img.bpp });
        count++;
      }
      if (p.index == null) await fsP.writeFile(path.join(dir, f.rel + '.json'), JSON.stringify({ source: f.rel, textures: meta }, null, 1));
    } catch (e) { errors.push(f.rel + ': ' + e.message); }
  }
  return { ok: true, dir, count, errors };
});

// ---- імпорт теки з PNG: <…>/remastered/…/<name>.imz.<i>.png та <name>.png ----
ipcMain.handle('textures:importDir', async (_e, payload) => {
  const p = payload || {};
  const hedOut = hedOutDir();
  if (!hedOut) return { ok: false, error: 'Recom.hed_out не знайдено' };
  if (!p.tsvDir || !p.outDir) return { ok: false, error: 'Не задано теки PROGRESS / DONE' };
  const r = await dialog.showOpenDialog(win.get(), { title: 'Тека з відредагованими PNG', properties: ['openDirectory'], defaultPath: p.defaultDir || undefined });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const dir = r.filePaths[0];
  const known = new Map(listTextureFiles(hedOut).map(f => [f.rel.toLowerCase(), f]));
  const found = [];
  const rec = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { rec(abs); continue; }
      if (!/\.png$/i.test(e.name)) continue;
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      const i = rel.toLowerCase().indexOf('remastered/');
      if (i < 0) continue;
      const sub = rel.slice(i);
      const m = /^(.*\.imz)\.(\d+)\.png$/i.exec(sub);
      if (m && known.has(m[1].toLowerCase())) found.push({ f: known.get(m[1].toLowerCase()), index: parseInt(m[2], 10), abs });
      else if (known.has(sub.toLowerCase())) found.push({ f: known.get(sub.toLowerCase()), index: 0, abs });
    }
  };
  rec(dir);
  let count = 0, unchanged = 0;
  const errors = [];
  const touched = new Set();
  for (const it of found) {
    try {
      // однакові з оригіналом PNG не реєструємо (експортовані, але не редаговані)
      const orig = await loadRgba(hedOut, null, it.f.rel, it.index, it.f.kind);
      const img = decodePng(await fsP.readFile(it.abs));
      if (img.width === orig.width && img.height === orig.height && img.rgba.equals(orig.rgba)) { unchanged++; continue; }
      await registerPng(hedOut, p.tsvDir, p.outDir, it.f.rel, it.index, it.f.kind, it.abs);
      touched.add(it.f.rel + '\u0001' + it.f.kind); count++;
    } catch (e) { errors.push(path.basename(it.abs) + ': ' + e.message); }
  }
  for (const k of touched) { const [rel, kind] = k.split('\u0001'); try { await rebuild(hedOut, p.tsvDir, p.outDir, rel, kind); } catch (e) { errors.push(rel + ': ' + e.message); } }
  return { ok: true, dir, found: found.length, count, unchanged, errors };
});

ipcMain.handle('textures:reveal', async (_e, payload) => {
  const p = payload || {};
  const done = p.outDir ? path.join(p.outDir, ARCHIVE, p.rel || '') : '';
  const hedOut = hedOutDir();
  const target = done && fs.existsSync(done) ? done : (hedOut ? path.join(hedOut, p.rel || '') : '');
  if (!target || !fs.existsSync(target)) return { ok: false, error: 'Файл не знайдено' };
  shell.showItemInFolder(target);
  return { ok: true, path: target };
});

module.exports = { listTextureFiles, hedOutDir };
