'use strict';

// Воркер формату: розбір/збірка одного файла будь-якого формату (binl через
// вбудований кодек у цьому ж потоці, ev/mesofs/ctd/ctdl/kmb — напряму) і обхід
// теки для списку файлів. Main лише оркеструє (mapLimited) і шле прогрес, тому
// вікно не «висне» на 35 МБ .ev під час «Зібрати ВСІ» та індексації.
//   { op: 'setGlossary', glossary, layouts? } — глосарій (+ хмаринки Re:CoM) для compose (раз на прогін, у кожен воркер)
//   { op: 'index', rel, env }               → indexFileSlots
//   { op: 'compose', rel, env }             → composeOneFile (пише файли сам)
//   { op: 'listFiles', dir }                → [{ rel, size, mtimeMs, ext, kind, magic, isTranslatable }]

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { setNativeMapPath } = require('../shared/codec');
const ops = require('../tools/lib/translate-ops');
const { classifyFile } = require('../tools/lib/formats');

if (workerData && workerData.nativeMapPath) setNativeMapPath(workerData.nativeMapPath);
let glossary = {};
let layouts = null;   // хмаринки Re:CoM: { rel: { msgId: {x,y,w,h} } }

function walkDir(root) {
  const out = [];
  const rec = (dir, base) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const rel = base ? path.join(base, e.name) : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { rec(abs, rel); continue; }
      if (!e.isFile()) continue;
      let size = 0, mtimeMs = 0;
      try { const st = fs.statSync(abs); size = st.size; mtimeMs = st.mtimeMs; } catch (_) {}
      const ext = path.extname(e.name).toLowerCase();
      const cls = classifyFile(abs, ext);
      // *_mes_data.bin та інші data-половини пар пишуться разом із таблицею зсувів.
      if (cls.kind === 'mesdata') continue;
      out.push({ rel: rel.split(path.sep).join('/'), size, mtimeMs, ext, kind: cls.kind, magic: cls.magic, isTranslatable: cls.isTranslatable });
    }
  };
  rec(root, '');
  return out;
}

parentPort.on('message', async (msg) => {
  const id = msg && msg.id;
  try {
    switch (msg && msg.op) {
      case 'setGlossary':
        glossary = msg.glossary || {};
        layouts = msg.layouts || null;
        parentPort.postMessage({ id, ok: true });
        return;
      case 'index':
        parentPort.postMessage({ id, ok: true, result: await ops.indexFileSlots(msg.rel, msg.env || {}) });
        return;
      case 'compose':
        parentPort.postMessage({ id, ok: true, result: await ops.composeOneFile(msg.rel, Object.assign({}, msg.env || {}, { glossary, layouts })) });
        return;
      case 'listFiles':
        parentPort.postMessage({ id, ok: true, result: walkDir(msg.dir) });
        return;
      default:
        parentPort.postMessage({ id, ok: false, error: 'Невідома операція: ' + String(msg && msg.op) });
    }
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: (e && e.message) || String(e) });
  }
});
