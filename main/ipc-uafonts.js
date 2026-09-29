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
const codec = require('../shared/codec');
const { nativeMapPathFor, sysFontMapPathFor } = require('./native-map');
const { kh1OutRel } = require('../shared/text-structure');
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
    args: (inp, out, o) => ['--arc', inp.arc, '--rem', inp.rem, '--comic', o.comic, '--menu', o.menu, '--out', path.join(out, 'bbs_first')],
    outputs: 'bbs_first/{original,remastered}/arc_en/system/FontEn.arc'
  },
  'kh-re-com': {
    hedOut: 'Recom.hed_out',
    script: path.join('recom', 'comfontua.py'),
    inputs: (hedOut) => ({
      bin: path.join(hedOut, 'remastered', 'SYS', '0001', 'SY0001.BIN'),
      vtm: path.join(hedOut, 'remastered', 'SYS', '0001', 'SY0001.VTM')
    }),
    args: (inp, out, o) => ['--bin', inp.bin, '--vtm', inp.vtm, '--comic', o.comic, '--menu', o.menu, '--out', path.join(out, 'Recom', 'remastered', 'SYS', '0001')],
    outputs: 'Recom/remastered/SYS/0001/{SY0001.BIN,SY0001.VTM}/UK_{sys,evt}font*'
  },
  'kh1-final-mix': {
    hedOut: 'kh1_first.hed_out',
    script: path.join('kh1', 'kh1font.py'),
    inputs: (hedOut) => ({
      knj: path.join(hedOut, 'original', 'exchange', 'UK_kanji.knj'),
      dds: path.join(hedOut, 'remastered', 'exchange', 'UK_kanji.knj', 'UK_kanji_knj0.dds')
    }),
    // opts.extraLetters — довільні символи (інші мови) у вільні комірки після
    // української абетки; генератор перевіряє, що вони є у TTF.
    args: (inp, out, opts) => ['--knj', inp.knj, '--dds', inp.dds, '--font', opts.comic, '--layout', 'game',
      '--out', path.join(out, 'kh1_first'), '--preview', path.join(out, '_reports', 'preview.png')]
      .concat(opts && opts.extraLetters ? ['--extra', opts.extraLetters] : [])
      .concat(opts && opts.fallbackFont ? ['--fallback-font', opts.fallbackFont] : []),
    outputs: 'kh1_first/original/exchange/UK_kanji.knj + remastered/exchange/UK_kanji.knj/UK_kanji_knj0.dds (нативна кирилиця, коди 19 NN)',
    // після генерації карта літера→код стає активною для кодека
    nativeMap: 'kh1-native-map.json',
    // У KH1 ДВА шрифти з різною адресацією, і обидва потрібні для повного
    // перекладу: діалоговий (вище, коди `19 NN`) і СИСТЕМНИЙ — меню, sysmsg,
    // підписи кнопок, сітка введення назви; там літера = один байт
    // (байт = номер запису + 0x20). Тому «Згенерувати» робить обидва.
    extra: [{
      id: 'sysfont',
      script: path.join('kh1', 'kh1sysfont.py'),
      inputs: (hedOut) => ({
        tbl: path.join(hedOut, 'original', 'exchange', 'US_font_data_tbl.bin'),
        sysdds: path.join(hedOut, 'remastered', 'menu', 'uk', 'sysfont.bin', 'UK_sysfont_bin0.dds')
      }),
      args: (inp, out, o) => ['--tbl', inp.tbl, '--dds', inp.sysdds, '--font', o.menu, '--layout', 'game',
        '--out', path.join(out, 'kh1_first'), '--preview', path.join(out, '_reports', 'sysfont-preview.png')],
      outputs: 'kh1_first/original/exchange/US_font_data_tbl.bin + remastered/menu/uk/sysfont.bin/UK_sysfont_bin0.dds (системний шрифт, 1 байт на літеру)',
      // карта «літера → байт» для кодека (sysmsg, btltbl)
      map: 'kh1-sysfont-map.json',
      report: 'ua_sysglyphs.json'
    }]
  },
  'kh-ddd': {
    hedOut: 'kh3d_first.hed_out',
    script: path.join('ddd', 'make_ua_font.py'),
    inputs: (hedOut) => ({
      orig: path.join(hedOut, 'original', 'font', 'en', 'bin'),
      rem: path.join(hedOut, 'remastered', 'font', 'en', 'bin')
    }),
    args: (inp, out, o) => ['--orig', inp.orig, '--rem', inp.rem, '--comic', o.comic, '--menu', o.menu, '--out', path.join(out, 'kh3d_first')],
    outputs: 'kh3d_first/{original,remastered}/font/en/bin/*.bcfnt'
  }
};

function locate(gameId, gameDir) {
  const prof = PROFILES[gameId];
  if (!prof) return { error: 'Для цієї гри генератор шрифтів не передбачений' };
  if (!gameDir || !fs.existsSync(gameDir)) return { error: 'Директорію гри не вказано або її нема' };
  const hedOut = findDirNamed(gameDir, prof.hedOut, 4);
  if (!hedOut) return { error: 'Не знайдено розпаковану теку ' + prof.hedOut + ' у ' + gameDir + ' — спершу розпакуй гру (Setup → KHPCPatchManager)' };
  const inputs = prof.inputs(hedOut);
  const outputs = [prof.outputs];
  for (const ex of prof.extra || []) {
    Object.assign(inputs, ex.inputs(hedOut));
    outputs.push(ex.outputs);
  }
  const missing = Object.entries(inputs).filter(([, p]) => !fs.existsSync(p)).map(([k, p]) => k + ': ' + p);
  return { hedOut, inputs, missing, outputs: outputs.join('\n'), script: prof.script };
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
  await fsP.mkdir(path.join(buildDir, '_reports'), { recursive: true });
  // Стара розкладка build/<archive>.hed_out/… → build/<archive>/… (патч-готова)
  await renameLegacyHedOut(buildDir);
  const extraLetters = String((payload && payload.extraLetters) || '').replace(/\s+/g, '');
  // Запасний шрифт для символів, яких нема у ComicHearts (лише коли є додаткові символи).
  let fallbackFont = String((payload && payload.fallbackFont) || '').trim() || defaultFallbackFont();
  if (fallbackFont && !fs.existsSync(fallbackFont)) fallbackFont = '';
  const fonts = pickFonts(payload);
  const args = py.pre.concat([script]).concat(prof.args(loc.inputs, buildDir,
    Object.assign({ extraLetters, fallbackFont: extraLetters ? fallbackFont : '' }, fonts)));
  sendProgress({ phase: 'generate', line: '> ' + [py.cmd].concat(args).map(a => (/\s/.test(a) ? '"' + a + '"' : a)).join(' ') + '\n' });
  const r = await run(py.cmd, args, { cwd: path.dirname(script), onLine: (l) => sendProgress({ phase: 'generate', line: l }) });
  // Звіти/карти/превʼю — у build/_reports: тека build має лишатися чистою для патча
  // (перетягується на KHPCPatchManager цілком).
  await moveReportsToReportsDir(buildDir);
  let report = null;
  try {
    const rp = findFileNamed(path.join(buildDir, '_reports'), 'ua_glyphs.json') || findFileNamed(buildDir, 'ua_glyphs.json');
    if (rp) report = JSON.parse(await fsP.readFile(rp, 'utf8'));
  } catch (_) {}
  if (r.code !== 0) return { ok: false, error: 'Генератор завершився з кодом ' + r.code, log: r.out + r.err };

  // Додаткові генератори тієї самої гри (KH1: системний шрифт). Кожен пише у
  // ту саму теку build — у свої файли гри, тому вони не заважають одне одному.
  let log = r.out;
  for (const ex of prof.extra || []) {
    const exScript = path.join(PY_DIR, ex.script);
    if (!fs.existsSync(exScript)) return { ok: false, error: 'Скрипт не знайдено: ' + exScript };
    const exArgs = py.pre.concat([exScript]).concat(ex.args(loc.inputs, buildDir, fonts));
    sendProgress({ phase: 'generate', line: '\n> ' + [py.cmd].concat(exArgs).map(a => (/\s/.test(a) ? '"' + a + '"' : a)).join(' ') + '\n' });
    const er = await run(py.cmd, exArgs, { cwd: path.dirname(exScript), onLine: (l) => sendProgress({ phase: 'generate', line: l }) });
    log += er.out;
    if (er.code !== 0) return { ok: false, error: 'Генератор «' + ex.id + '» завершився з кодом ' + er.code, log: er.out + er.err };
    // звіт додається до спільної таблиці вкладки
    try {
      const rp = findFileNamed(buildDir, ex.report);
      if (rp) Object.assign(report || (report = {}), JSON.parse(await fsP.readFile(rp, 'utf8')));
    } catch (_) {}
  }
  await moveReportsToReportsDir(buildDir);

  // KH1: карта літера→код 19 NN з цієї збірки стає активною (userData), щоб
  // компоновка кодувала додаткові символи саме так, як їх намальовано.
  let nativeMap = null;
  if (prof.nativeMap) {
    try {
      const src = findFileNamed(path.join(buildDir, '_reports'), prof.nativeMap) || findFileNamed(buildDir, prof.nativeMap);
      if (src) {
        const dst = nativeMapPathFor();
        await fsP.copyFile(src, dst);
        codec.setNativeMapPath(dst);
        nativeMap = { path: dst, letters: Object.keys((JSON.parse(await fsP.readFile(dst, 'utf8')) || {}).map || {}).length };
      }
    } catch (e) { sendProgress({ phase: 'generate', line: 'native map: ' + (e.message || e) + '\n' }); }
  }
  // Те саме для карти СИСТЕМНОГО шрифту: без неї кодек писав би меню
  // вбудованою картою, яка може не збігатися зі щойно намальованим атласом.
  let sysFontMap = null;
  for (const ex of prof.extra || []) {
    if (!ex.map) continue;
    try {
      const src = findFileNamed(path.join(buildDir, '_reports'), ex.map) || findFileNamed(buildDir, ex.map);
      if (!src) continue;
      const dst = sysFontMapPathFor();
      await fsP.copyFile(src, dst);
      codec.setSysFontMapPath(dst);
      sysFontMap = { path: dst, letters: Object.keys((JSON.parse(await fsP.readFile(dst, 'utf8')) || {}).map || {}).length };
    } catch (e) { sendProgress({ phase: 'generate', line: ex.map + ': ' + (e.message || e) + '\n' }); }
  }
  return { ok: true, buildDir, report, log, nativeMap, sysFontMap };
});

// Свої TTF/OTF замість вбудованих. Порожнє чи неіснуюче значення — вбудований:
// ComicHearts для реплік і субтитрів, KHMenu для інтерфейсу. Так перекладач
// іншою мовою може взяти власний шрифт, не правлячи застосунок.
function pickFonts(payload) {
  const one = (v, fallback) => {
    const p = String((payload && v) || '').trim();
    return p && fs.existsSync(p) ? p : fallback;
  };
  return {
    comic: one(payload && payload.dialogFont, FONT_COMIC),
    menu: one(payload && payload.menuFont, FONT_MENU)
  };
}

// Типовий запасний шрифт для додаткових символів: Comic Sans MS (є у Windows,
// стилістично близький до ComicHearts і покриває кирилицю/латиницю розширену).
function defaultFallbackFont() {
  const winFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  for (const name of ['comic.ttf', 'segoeui.ttf', 'arial.ttf']) {
    const p = path.join(winFonts, name);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

ipcMain.handle('uafonts:pickFont', async (_e, title) => {
  const { dialog } = require('electron');
  const r = await dialog.showOpenDialog(win.get(), {
    title: String(title || 'TTF/OTF для додаткових символів'),
    defaultPath: path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
    properties: ['openFile'],
    filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'ttc'] }]
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

// Службові файли генераторів, яким не місце у патчі.
const REPORT_FILES = /^(ua_glyphs\.json|ua_sysglyphs\.json|kh1-native-map\.json|kh1-sysfont-map\.json|preview\.png|sysfont-preview\.png|ua_preview\.png)$/i;
async function moveReportsToReportsDir(buildDir) {
  const reports = path.join(buildDir, '_reports');
  await fsP.mkdir(reports, { recursive: true });
  const stack = [buildDir];
  while (stack.length) {
    const dir = stack.pop();
    if (dir === reports) continue;
    let entries;
    try { entries = await fsP.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (full !== reports) stack.push(full); continue; }
      if (REPORT_FILES.test(e.name)) {
        try { await fsP.rename(full, path.join(reports, e.name)); } catch (_) {}
      }
    }
  }
}
// build/<archive>.hed_out → build/<archive> (старі збірки)
async function renameLegacyHedOut(buildDir) {
  let entries;
  try { entries = await fsP.readdir(buildDir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (!e.isDirectory() || !/\.hed_out$/i.test(e.name)) continue;
    const dst = path.join(buildDir, e.name.replace(/\.hed_out$/i, ''));
    if (fs.existsSync(dst)) continue;
    try { await fsP.rename(path.join(buildDir, e.name), dst); } catch (_) {}
  }
}

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
  try { tops = (await fsP.readdir(buildDir, { withFileTypes: true })).filter(d => d.isDirectory() && !/^_/.test(d.name)); }
  catch (e) { return { ok: false, error: e.message }; }
  if (!tops.length) return { ok: false, error: 'У build нема тек архівів (<archive>/…)' };
  const stats = { copied: 0, backedUp: 0, errors: [], targets: [] };
  for (const top of tops) {
    // build/<archive> (патч-розкладка) або старе build/<archive>.hed_out → <archive>.hed_out у грі
    const hedOutName = /\.hed_out$/i.test(top.name) ? top.name : top.name + '.hed_out';
    const target = findDirNamed(gameDir, hedOutName, 4);
    if (!target) { stats.errors.push('У грі не знайдено ' + hedOutName); continue; }
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

// Розкласти зібрані KH1-файли з DONE у розпаковану гру (kh1_first.hed_out):
// exchange/* → original/exchange/, решта → remastered/. Оригінали бекапляться
// один раз у backupDir. Далі користувач пакує .hed_out як звик (KHPCPatchManager).
ipcMain.handle('translate:installDone', async (_e, payload) => {
  const doneDir = payload && payload.doneDir;
  const gameDir = payload && payload.gameDir;
  const backupDir = payload && payload.backupDir;
  if (!doneDir || !gameDir || !backupDir) return { ok: false, error: 'Не вказано теки' };
  if (!fs.existsSync(doneDir)) return { ok: false, error: 'Теки DONE нема: ' + doneDir };
  // DONE/<archive>/(remastered|original)/… → <archive>.hed_out у грі; старі
  // розкладки (remastered/… чи плоскі шляхи) — це kh1_first.
  const hedOuts = {};
  const hedOutFor = (arc) => {
    if (!(arc in hedOuts)) hedOuts[arc] = findDirNamed(gameDir, arc + '.hed_out', 4);
    return hedOuts[arc];
  };
  if (!hedOutFor('kh1_first')) return { ok: false, error: 'У грі не знайдено kh1_first.hed_out — спершу розпакуй (Setup)' };
  const stats = { copied: 0, backedUp: 0, skipped: 0, errors: [], target: path.dirname(hedOutFor('kh1_first')) };
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = await fsP.readdir(path.join(doneDir, rel), { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) { stack.push(childRel); continue; }
      if (!e.isFile() || /\.(tsv|json|bak\.\d+)$/i.test(e.name)) continue;
      const posix = childRel.split(path.sep).join('/');
      const gameRel = kh1OutRel(posix);                  // kh1_second/remastered/al01.ard/…
      const arc = gameRel.split('/')[0];
      const inner = gameRel.slice(arc.length + 1);
      const hedOut = hedOutFor(arc);
      if (!hedOut) { stats.skipped++; stats.errors.push('нема розпакованого ' + arc + '.hed_out: ' + gameRel); continue; }
      const src = path.join(doneDir, childRel);
      const dst = path.join(hedOut, inner);
      // Кладемо лише туди, де такий файл існує в грі (захист від сміття/чужих шляхів).
      if (!fs.existsSync(dst)) { stats.skipped++; stats.errors.push('нема в грі: ' + gameRel); continue; }
      const bak = path.join(backupDir, arc + '.hed_out', inner);
      try {
        if (!fs.existsSync(bak)) {
          await fsP.mkdir(path.dirname(bak), { recursive: true });
          await fsP.copyFile(dst, bak);
          stats.backedUp++;
        }
        await fsP.copyFile(src, dst);
        stats.copied++;
        sendProgress({ phase: 'install-done', line: gameRel + '\n' });
      } catch (err) {
        stats.errors.push(posix + ': ' + (err.message || err));
      }
    }
  }
  return Object.assign({ ok: stats.copied > 0 && stats.errors.every(x => x.startsWith('нема ')) }, stats);
});

ipcMain.handle('uafonts:openDir', async (_e, dir) => {
  if (!dir || !fs.existsSync(dir)) return { ok: false };
  try { await shell.openPath(dir); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('uafonts:defaults', async (_e, gameId) => ({
  buildDir: path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', String(gameId || 'game'), 'build'),
  backupDir: path.join(app.getPath('documents'), 'KH-Localization', 'FONTS', String(gameId || 'game'), 'backup'),
  // KH1: запасний шрифт для додаткових символів (типово Comic Sans MS)
  fallbackFont: defaultFallbackFont(),
  // вбудовані шрифти — показуємо їхні імена, коли свій не вибрано
  dialogFontDefault: path.basename(FONT_COMIC),
  menuFontDefault: path.basename(FONT_MENU)
}));

module.exports = { detectPython, checkDeps, locate, findDirNamed, PROFILES };
