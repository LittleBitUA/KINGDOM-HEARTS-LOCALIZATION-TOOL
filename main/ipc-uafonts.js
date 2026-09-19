'use strict';

// Українські шрифти для BBS / Re:CoM / Dream Drop Distance.
//
// Растеризація кирилиці у ігрові атласи (Pillow/numpy/fonttools/scipy) — це
// еталонні Python-інструменти з tools/py/{bbs,recom,ddd}; ми їх не переписуємо,
// а запускаємо з UI, стрімлячи вивід у renderer ('uafonts:progress').
//
//   uafonts:python     → { found, cmd, version, deps: {pillow,numpy,fonttools,scipy}, missing[] }
//   uafonts:pipInstall → встановити відсутні пакети (python -m pip install --user …)
//   uafonts:generate   → { gameId, gameDir, buildDir } → запустити генератор для гри
//   uafonts:install    → { gameId, buildDir, gameDir, backupDir } → скопіювати build у гру з бекапом
//   uafonts:locate     → { gameId, gameDir } → знайдені шляхи (для показу в UI)

const { ipcMain, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsP = require('fs/promises');
const { spawn } = require('child_process');
const win = require('./window');

const ROOT = path.join(__dirname, '..');
// У запакованому застосунку app.asar не можна виконувати як теку — Python
// має читати справжні файли. electron-builder розпаковує asarUnpack-шляхи у
// resources/app.asar.unpacked/.
function unpackedPath(rel) {
  const p = path.join(ROOT, rel);
  return p.replace(/\bapp\.asar\b/, 'app.asar.unpacked');
}
const PY_DIR = unpackedPath('tools/py');
const FONT_COMIC = unpackedPath(path.join('assets', 'fonts', 'ComicHearts-Regular.otf'));
const FONT_MENU = unpackedPath(path.join('assets', 'fonts', 'KHMenu-Regular.otf'));

const DEPS = { pillow: 'PIL', numpy: 'numpy', fonttools: 'fontTools', scipy: 'scipy' };

function sendProgress(payload) { win.send('uafonts:progress', payload); }

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, Object.assign({ windowsHide: true, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }) }, opts || {}));
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e.message || e) });
    }
    child.on('error', (e) => resolve({ code: -1, out, err: err + String(e.message || e) }));
    child.stdout && child.stdout.on('data', (b) => { out += b.toString('utf8'); if (opts && opts.onLine) opts.onLine(b.toString('utf8')); });
    child.stderr && child.stderr.on('data', (b) => { err += b.toString('utf8'); if (opts && opts.onLine) opts.onLine(b.toString('utf8')); });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

// Знайти Python 3: `py -3`, `python`, `python3`.
async function detectPython() {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    const r = await run(cmd, pre.concat(['--version']));
    const m = (r.out + r.err).match(/Python (3\.\d+\.\d+)/);
    if (r.code === 0 && m) return { cmd, pre, version: m[1] };
  }
  return null;
}

async function checkDeps(py) {
  const code = Object.entries(DEPS).map(([pkg, mod]) => `
try:
    import ${mod}
    print("${pkg} ok")
except Exception as e:
    print("${pkg} missing")`).join('\n');
  const r = await run(py.cmd, py.pre.concat(['-c', code]));
  const deps = {};
  for (const [pkg] of Object.entries(DEPS)) deps[pkg] = new RegExp('^' + pkg + ' ok$', 'm').test(r.out);
  return deps;
}

ipcMain.handle('uafonts:python', async () => {
  const py = await detectPython();
  if (!py) return { found: false, missing: Object.keys(DEPS) };
  const deps = await checkDeps(py);
  return { found: true, cmd: [py.cmd].concat(py.pre).join(' '), version: py.version, deps, missing: Object.keys(deps).filter(k => !deps[k]) };
});

ipcMain.handle('uafonts:pipInstall', async () => {
  const py = await detectPython();
  if (!py) return { ok: false, error: 'Python 3 не знайдено' };
  const deps = await checkDeps(py);
  const missing = Object.keys(deps).filter(k => !deps[k]);
  if (!missing.length) return { ok: true, installed: [] };
  sendProgress({ phase: 'pip', line: '> pip install ' + missing.join(' ') + '\n' });
  const r = await run(py.cmd, py.pre.concat(['-m', 'pip', 'install', '--user'].concat(missing)), { onLine: (l) => sendProgress({ phase: 'pip', line: l }) });
  const after = await checkDeps(py);
  const still = Object.keys(after).filter(k => !after[k]);
  return { ok: r.code === 0 && !still.length, installed: missing.filter(m => after[m]), missing: still, log: r.out + r.err };
});

// ---- Пошук ігрових тек за іменем <base>.hed_out під gameDir (глибина ≤ 4) ----
function findDirNamed(rootDir, name, maxDepth) {
  const stack = [{ dir: rootDir, depth: 0 }];
  const lname = name.toLowerCase();
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase() === lname) return full;
      if (depth < (maxDepth || 4) && !/^(\.git|node_modules|\$RECYCLE\.BIN)$/i.test(e.name)) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

// Профіль генератора на гру: скрипт, аргументи, де лежать вхідні файли, куди пише.
const PROFILES = {
  'kh-bbs-final-mix': {
    hedOut: 'bbs_first.hed_out',
    script: path.join('bbs', 'bbsfont.py'),
    inputs: (hedOut) => ({
      arc: path.join(hedOut, 'original', 'arc_en', 'system', 'FontEn.arc'),
      rem: path.join(hedOut, 'remastered', 'arc_en', 'system', 'FontEn.arc')
    }),
    args: (inp, out) => ['--arc', inp.arc, '--rem', inp.rem, '--comic', FONT_COMIC, '--menu', FONT_MENU, '--out', path.join(out, 'bbs_first.hed_out')],
    outputs: 'bbs_first.hed_out/{original,remastered}/arc_en/system/FontEn.arc'
  },
  'kh-re-com': {
    hedOut: 'Recom.hed_out',
    script: path.join('recom', 'comfontua.py'),
    inputs: (hedOut) => ({
      bin: path.join(hedOut, 'remastered', 'SYS', '0001', 'SY0001.BIN'),
      vtm: path.join(hedOut, 'remastered', 'SYS', '0001', 'SY0001.VTM')
    }),
    args: (inp, out) => ['--bin', inp.bin, '--vtm', inp.vtm, '--comic', FONT_COMIC, '--menu', FONT_MENU, '--out', path.join(out, 'Recom.hed_out', 'remastered', 'SYS', '0001')],
    outputs: 'Recom.hed_out/remastered/SYS/0001/{SY0001.BIN,SY0001.VTM}/UK_{sys,evt}font*'
  },
  'kh-ddd': {
    hedOut: 'kh3d_first.hed_out',
    script: path.join('ddd', 'make_ua_font.py'),
    inputs: (hedOut) => ({
      orig: path.join(hedOut, 'original', 'font', 'en', 'bin'),
      rem: path.join(hedOut, 'remastered', 'font', 'en', 'bin')
    }),
    args: (inp, out) => ['--orig', inp.orig, '--rem', inp.rem, '--comic', FONT_COMIC, '--menu', FONT_MENU, '--out', path.join(out, 'kh3d_first.hed_out')],
    outputs: 'kh3d_first.hed_out/{original,remastered}/font/en/bin/*.bcfnt'
  }
};

function locate(gameId, gameDir) {
  const prof = PROFILES[gameId];
  if (!prof) return { error: 'Для цієї гри генератор шрифтів не передбачений' };
  if (!gameDir || !fs.existsSync(gameDir)) return { error: 'Директорію гри не вказано або її нема' };
  const hedOut = findDirNamed(gameDir, prof.hedOut, 4);
  if (!hedOut) return { error: 'Не знайдено розпаковану теку ' + prof.hedOut + ' у ' + gameDir + ' — спершу розпакуй гру (Setup → KHPCPatchManager)' };
  const inputs = prof.inputs(hedOut);
  const missing = Object.entries(inputs).filter(([, p]) => !fs.existsSync(p)).map(([k, p]) => k + ': ' + p);
  return { hedOut, inputs, missing, outputs: prof.outputs, script: prof.script };
}

ipcMain.handle('uafonts:locate', async (_e, payload) => locate(payload && payload.gameId, payload && payload.gameDir));

ipcMain.handle('uafonts:generate', async (_e, payload) => {
  const gameId = payload && payload.gameId;
  const gameDir = payload && payload.gameDir;
  const buildDir = payload && payload.buildDir;
  if (!buildDir) return { ok: false, error: 'Не вказано теку build' };
  const loc = locate(gameId, gameDir);
  if (loc.error) return { ok: false, error: loc.error };
  if (loc.missing.length) return { ok: false, error: 'Немає вхідних файлів: ' + loc.missing.join('; ') };
  const py = await detectPython();
  if (!py) return { ok: false, error: 'Python 3 не знайдено (py -3 / python / python3)' };
  const prof = PROFILES[gameId];
  const script = path.join(PY_DIR, prof.script);
  if (!fs.existsSync(script)) return { ok: false, error: 'Скрипт не знайдено: ' + script };
  await fsP.mkdir(buildDir, { recursive: true });
  const args = py.pre.concat([script]).concat(prof.args(loc.inputs, buildDir));
  sendProgress({ phase: 'generate', line: '> ' + [py.cmd].concat(args).map(a => (/\s/.test(a) ? '"' + a + '"' : a)).join(' ') + '\n' });
  const r = await run(py.cmd, args, { cwd: path.dirname(script), onLine: (l) => sendProgress({ phase: 'generate', line: l }) });
  let report = null;
  try {
    const rp = findFileNamed(buildDir, 'ua_glyphs.json');
    if (rp) report = JSON.parse(await fsP.readFile(rp, 'utf8'));
  } catch (_) {}
  if (r.code !== 0) return { ok: false, error: 'Генератор завершився з кодом ' + r.code, log: r.out + r.err };
  return { ok: true, buildDir, report, log: r.out };
});

function findFileNamed(rootDir, name) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === name) return full;
    }
  }
  return null;
}

// Скопіювати build у гру. buildDir містить <base>.hed_out/…; у грі шукаємо
// теку з тим самим іменем. Перед перезаписом кожен існуючий файл копіюється
// у backupDir (лише перший раз — оригінал не перетирається бекапом патчу).
ipcMain.handle('uafonts:install', async (_e, payload) => {
  const buildDir = payload && payload.buildDir;
  const gameDir = payload && payload.gameDir;
  const backupDir = payload && payload.backupDir;
  if (!buildDir || !gameDir || !backupDir) return { ok: false, error: 'Не вказано теки' };
  if (!fs.existsSync(buildDir)) return { ok: false, error: 'Теки build нема: ' + buildDir };
  let tops;
  try { tops = (await fsP.readdir(buildDir, { withFileTypes: true })).filter(d => d.isDirectory() && /\.hed_out$/i.test(d.name)); }
  catch (e) { return { ok: false, error: e.message }; }
  if (!tops.length) return { ok: false, error: 'У build нема тек *.hed_out' };
  const stats = { copied: 0, backedUp: 0, errors: [], targets: [] };
  for (const top of tops) {
    const target = findDirNamed(gameDir, top.name, 4);
    if (!target) { stats.errors.push('У грі не знайдено ' + top.name); continue; }
    stats.targets.push(target);
    const srcRoot = path.join(buildDir, top.name);
    const stack = [''];
    while (stack.length) {
      const rel = stack.pop();
      const abs = path.join(srcRoot, rel);
      let entries;
      try { entries = await fsP.readdir(abs, { withFileTypes: true }); } catch (_) { continue; }
      for (const e of entries) {
        const childRel = rel ? path.join(rel, e.name) : e.name;
        if (e.isDirectory()) { stack.push(childRel); continue; }
        if (!e.isFile() || e.name === 'ua_glyphs.json') continue;
        const src = path.join(srcRoot, childRel);
        const dst = path.join(target, childRel);
        const bak = path.join(backupDir, top.name, childRel);
        try {
          if (fs.existsSync(dst) && !fs.existsSync(bak)) {
            await fsP.mkdir(path.dirname(bak), { recursive: true });
            await fsP.copyFile(dst, bak);
            stats.backedUp++;
          }
          await fsP.mkdir(path.dirname(dst), { recursive: true });
          await fsP.copyFile(src, dst);
          stats.copied++;
          sendProgress({ phase: 'install', line: childRel + '\n' });
        } catch (err) {
          stats.errors.push(childRel + ': ' + (err.message || err));
        }
      }
    }
  }
  return Object.assign({ ok: stats.errors.length === 0 }, stats);
});

ipcMain.handle('uafonts:openDir', async (_e, dir) => {
  if (!dir || !fs.existsSync(dir)) return { ok: false };
  try { await shell.openPath(dir); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('uafonts:defaults', async (_e, gameId) => ({
  buildDir: path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', String(gameId || 'game'), 'build'),
  backupDir: path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', String(gameId || 'game'), 'backup')
}));

module.exports = { detectPython, checkDeps, locate, PROFILES };
