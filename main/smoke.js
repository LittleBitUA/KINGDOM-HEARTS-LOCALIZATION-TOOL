'use strict';

// Headless end-to-end smoke test: KH_SMOKE=1 npx electron .
// Запускає справжній main + renderer, а тоді через executeJavaScript викликає
// window.kh1.* (preload → IPC → handlers) на синтетичних файлах у temp-теці.
// Друкує SMOKE OK / SMOKE FAIL і завершує процес з відповідним кодом.
// Мета — ловити зламане wiring (переіменований канал, відсутній handler,
// зміна форми відповіді), чого unit-тести translate-ops не бачать.

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

async function runSmoke(win) {
  let synth;
  try { synth = require(path.join(ROOT, 'test', 'helpers', 'synth')); }
  catch (_) {
    console.log('SMOKE SKIP: test/helpers/synth.js is not shipped in packaged builds — run against the source tree (npm run test:smoke).');
    app.exit(2);
    return;
  }
  const codec = require(path.join(ROOT, 'shared', 'codec'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kh1-smoke-'));
  const engDir = path.join(root, 'ENG'), rusDir = path.join(root, 'RUS');
  const outDir = path.join(root, 'DONE'), tsvDir = path.join(root, 'PROGRESS');
  for (const d of [engDir, rusDir, outDir, tsvDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(engDir, 'a.binl'), synth.buildBinl(['Potion', 'Attack']));
  fs.writeFileSync(path.join(rusDir, 'a.binl'), synth.buildBinl(['Potion']));
  fs.writeFileSync(path.join(engDir, 'b.ctd'), synth.buildCtd([{ id: 1, text: 'Yes' }], 1));
  fs.writeFileSync(path.join(rusDir, 'b.ctd'), Buffer.alloc(1));
  fs.writeFileSync(path.join(engDir, 'UK_sysmsg.binl'), synth.buildMsgV361(['Load this game?', 'Form your party.']));
  fs.writeFileSync(path.join(rusDir, 'UK_sysmsg.binl'), Buffer.alloc(1));

  const wc = win.webContents;
  const call = (js) => wc.executeJavaScript(js, true);
  const J = JSON.stringify;
  const failures = [];
  const check = (name, cond, info) => {
    if (!cond) failures.push(name + (info !== undefined ? ': ' + J(info) : ''));
    console.log((cond ? '  ok   ' : '  FAIL ') + name);
  };

  try {
    const about = await call('window.kh1.about()');
    check('about.version', typeof about.version === 'string' && about.version.length > 0, about);

    const list = await call(`window.kh1.translate.listFiles(${J(engDir)})`);
    check('listFiles kinds', list.files.map(f => f.kind).sort().join(',') === 'binl,binl-v361,ctd', list.files);

    // Message v361 (sysmsg): extract + compose через IPC.
    const v3 = await call(`window.kh1.translate.extract(${J({ engPath: path.join(engDir, 'UK_sysmsg.binl'), rusPath: path.join(rusDir, 'UK_sysmsg.binl') })})`);
    check('extract v361 slots', v3.slots && v3.slots.length === 2 && v3.slots[0].english === 'Load this game?', v3);
    const v3c = await call(`window.kh1.translate.compose(${J({ engPath: path.join(engDir, 'UK_sysmsg.binl'), outPath: path.join(outDir, 'UK_sysmsg.binl'), replacements: [{ offset: v3.slots[0].offset, ukText: 'Завантажити гру?' }] })})`);
    check('compose v361 applied', v3c.ok === true && v3c.applied === 1, v3c);
    const v3out = fs.readFileSync(path.join(outDir, 'UK_sysmsg.binl'));
    // sysmsg збирається гібридно: а/у — латинські 1-байтові гліфи, решта — нативні 19 NN.
    check('compose v361 bytes', v3out.subarray(0, 12).toString('ascii') === 'Message v361' && codec.decode(v3out.subarray(v3out.readUInt32LE(0x14)), { cmd: 'sysmsg' }).includes('Зaвaнтaжити гpy?'));


    const ex = await call(`window.kh1.translate.extract(${J({ engPath: path.join(engDir, 'a.binl'), rusPath: path.join(rusDir, 'a.binl') })})`);
    check('extract binl slots', ex.slots && ex.slots.length === 1 && ex.slots[0].english === 'Attack', ex);

    const ctdEx = await call(`window.kh1.translate.extract(${J({ engPath: path.join(engDir, 'b.ctd'), rusPath: path.join(rusDir, 'b.ctd') })})`);
    check('extract ctd slots', ctdEx.slots && ctdEx.slots.length === 1 && ctdEx.stats.ctd === true, ctdEx);

    const outPath = path.join(outDir, 'a.binl');
    const cmp = await call(`window.kh1.translate.compose(${J({ engPath: path.join(engDir, 'a.binl'), outPath, replacements: [{ offset: ex.slots[0].offset, ukText: 'Атака' }] })})`);
    check('compose binl applied', cmp.ok === true && cmp.applied === 1, cmp);
    const outBuf = fs.readFileSync(outPath);
    check('compose binl bytes', codec.decode(outBuf.subarray(11, outBuf.length - 5)).includes('Атака'));

    const tsvPath = path.join(tsvDir, 'a.binl.tsv');
    const sv = await call(`window.kh1.translate.saveTsv(${J({ tsvPath, content: 'index\toffset\tbytes\tenglish\tukrainian\n0\t0x0012\t6\tAttack\tУдар\n' })})`);
    check('saveTsv', sv.ok === true, sv);
    const rd = await call(`window.kh1.translate.readTsv(${J(tsvPath)})`);
    check('readTsv', rd.ok === true && rd.content.includes('Удар'), rd);

    const gs = await call(`window.kh1.translate.saveGlossary(${J({ tsvDir, entries: { Attack: 'Атака', Yes: 'Так' } })})`);
    check('saveGlossary', gs.ok === true && gs.count === 2, gs);
    const gr = await call(`window.kh1.translate.readGlossary(${J(tsvDir)})`);
    check('readGlossary', gr.ok === true && gr.entries.Attack === 'Атака', gr);

    const bg = await call(`window.kh1.translate.buildGlossary(${J({ engDir, rusDir, files: ['a.binl', 'b.ctd'], safeMode: true })})`);
    check('buildGlossary', bg.ok === true && bg.entries.some(e => e.english === 'Attack') && bg.entries.some(e => e.english === 'Yes'), bg);

    const ca = await call(`window.kh1.translate.composeAll(${J({ engDir, rusDir, outDir, tsvDir, files: ['a.binl', 'b.ctd'], glossary: { Attack: 'Атака', Yes: 'Так' }, safeMode: true })})`);
    check('composeAll written', ca.ok === true && ca.written === 2, ca);

    const st = await call('window.kh1.translate.getSettings("kh1-final-mix")');
    check('getSettings has dirs', st && typeof st.engDir === 'string', st);

    const cm = await call('window.kh1.app.getCharMap()');
    check('getCharMap', cm.ok === true && Object.keys(cm.map).length > 100);

    const wm = await call('window.kh1.translate.getWorldsMap()');
    check('getWorldsMap', wm.ok === true && typeof wm.map === 'object');

    const enc = await call('window.kh1.kerning.encodeText("Hi")');
    check('kerning.encodeText', enc.ok === true && enc.bytes.length === 2, enc);

    const setup = await call('window.kh1.setup.status()');
    check('setup.status', setup && typeof setup.completed === 'boolean', setup);

    // text_all: експорт синтетичних файлів і зворотний імпорт через IPC
    const ta = await call(`window.kh1.translate.exportTextAll(${J({ engDir, rusDir, files: ['a.binl', 'b.ctd'], glossary: { Yes: 'Так' }, safeMode: true })})`);
    check('exportTextAll', ta.ok === true && /### b\.ctd\n#0\nТак\n/.test(ta.content), ta);
    const ti = await call(`window.kh1.translate.importTextAll(${J({ engDir, rusDir, tsvDir, files: ['a.binl', 'b.ctd'], content: '### b.ctd\n#0\nНі\n', safeMode: true })})`);
    check('importTextAll', ti.ok === true && ti.applied === 1 && ti.tsvWritten === 1 && ti.glossary.Yes === 'Ні', ti);

    // UA fonts: детекція Python (не вимагаємо наявності) і locate без гри
    const py = await call('window.kh1.uafonts.python()');
    check('uafonts.python responds', py && typeof py.found === 'boolean', py);
    const loc = await call(`window.kh1.uafonts.locate(${J({ gameId: 'kh-bbs-final-mix', gameDir: root })})`);
    check('uafonts.locate reports missing hed_out', loc && /bbs_first\.hed_out/.test(loc.error || ''), loc);
    const loc1 = await call(`window.kh1.uafonts.locate(${J({ gameId: 'kh1-final-mix', gameDir: root })})`);
    check('uafonts.locate kh1 reports missing hed_out', loc1 && /kh1_first\.hed_out/.test(loc1.error || ''), loc1);
    const dfl = await call('window.kh1.uafonts.defaults("kh-ddd")');
    check('uafonts.defaults', dfl && /FONTS/.test(dfl.buildDir), dfl);

    // Глосарій → «Дописати відсутні у .txt»: наявні блоки не чіпаються, нові нумеруються далі.
    const app = await call(`(async () => {
      const m = await import('./translate/glossary.js');
      const existing = ['# KH1 Glossary Export', '', '[#1]', '--- EN ---', 'Potion', '--- UK ---', 'Зілля', '=== END ===', ''].join(String.fromCharCode(10));
      const r = m.buildGlossaryTxtAppend(existing, ['Potion', 'Load this game?', 'Two{lf}lines'], { 'Two{lf}lines': 'Два{lf}рядки' });
      const back = m.parseGlossaryTxt(r.content).pairs;
      return { added: r.added, translated: r.translated, startsSame: r.content.startsWith(existing), hasN3: r.content.includes('[#3]'), back };
    })()`);
    check('glossary append-txt', app.added === 2 && app.translated === 1 && app.startsSame && app.hasN3 && app.back.length === 2 && app.back[1].uk === 'Два{lf}рядки', app);

    // Міграція старих ключів у renderer: пари токенів і переписування UK.
    const leg = await call(`(async () => {
      const m = await import('./translate/glossary.js');
      const e = { english: 'A{0x06,0x2C,0x01}b{0x07,0x0C,0x02}c', legacyKey: 'A{0x06,0x2C} b{0x07,0x0C}{lf}c' };
      return { pairs: m.legacyTokenPairs(e.english, e.legacyKey), uk: m.upgradeLegacyUk(e, 'Я{0x06,0x2C} б{0x07,0x0C}{lf}в') };
    })()`);
    check('glossary legacy token upgrade', leg.pairs.length === 2 && leg.uk === 'Я{0x06,0x2C,0x01}б{0x07,0x0C,0x02}в', leg);

    // Імпорт .txt: EN-ключі з кириличними «двійниками» латиниці (старий overlay-експорт) → справжній ключ.
    const rk = await call(`(async () => {
      const m = await import('./translate/glossary.js');
      const look = new Map([['Obtained Potion{eol}', { english: 'Obtained Potion{eol}' }], ['Obtained Potion', { english: 'Obtained Potion{eol}' }]]);
      const hit = m.resolveImportedKey('Оbtаined Роtiоn', new Map(), look);
      const ws = new Map([[' Lets go!{0x06,0x28}{eol}', { english: ' Lets go!{0x06,0x28}{eol}' }], ['Lets go!{0x06,0x28}', { english: ' Lets go!{0x06,0x28}{eol}' }]]);
      const w = m.resolveImportedKey('Lets go!{0x06,0x28}', new Map(), ws);
      return { hit: hit && hit.english, miss: m.resolveImportedKey('Nothing', new Map(), look), w: w && w.english, uk: w && m.alignEol(w.english, 'Рушаймо!{0x06,0x28}') };
    })()`);
    check('glossary import resolves look-alike keys', rk.hit === 'Obtained Potion{eol}' && rk.miss === null && rk.w === ' Lets go!{0x06,0x28}{eol}' && rk.uk === 'Рушаймо!{0x06,0x28}{eol}', rk);

    const khGlobal = await call('typeof window.KH.tsv.build === "function" && typeof window.KH.textStructure.validateTokens === "function"');
    check('shared UMD modules loaded in renderer', khGlobal === true);

    // Renderer bootstrap (ESM main.js): home-картки відрендерені, версія у титлбарі.
    const cards = await call('document.querySelectorAll("#home-grid .game-card").length');
    check('renderer: home cards rendered', cards === 4, cards);
    const ver = await call('document.getElementById("tb-version").textContent');
    check('renderer: title-bar version filled', /^v\d+\.\d+/.test(ver), ver);
    // Hub toolbar: пошук фільтрує картки, лічильник відображає стан.
    const search = await call(`(() => {
      const i = document.getElementById('home-search');
      i.value = 'drop'; i.dispatchEvent(new Event('input'));
      const visible = [...document.querySelectorAll('#home-grid .game-card:not(.hidden)')].map(c => c.dataset.gameId);
      const count = document.getElementById('home-count').textContent;
      i.value = ''; i.dispatchEvent(new Event('input'));
      const restored = document.querySelectorAll('#home-grid .game-card:not(.hidden)').length;
      return { visible, count, restored, sidebar: !!document.getElementById('hub-nav-settings') };
    })()`);
    check('renderer: hub search filters cards', search.visible.length === 1 && search.visible[0] === 'kh-ddd' && /1/.test(search.count) && search.restored === 4 && search.sidebar, search);
    // Картка «Потрібен setup» (без теки гри) відкриває Setup для цієї гри; «Назад» повертає на hub.
    const setupOk = await call(`(async () => {
      const home = document.getElementById('home-screen');
      const setup = document.getElementById('setup-screen');
      const card = document.querySelector('#home-grid .game-card.needs-setup');
      if (!card) return { noCard: true };
      card.click();
      // автопошук Steam + перевірка тек — асинхронні; чекаємо до 6 с, поки Setup з'явиться
      for (let i = 0; i < 60 && setup.classList.contains('hidden'); i++) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 300));
      const active = setup.querySelector('.setup-game.active');
      const res = {
        gameId: card.dataset.gameId,
        setupShown: !setup.classList.contains('hidden'),
        homeHidden: home.classList.contains('hidden'),
        activeGame: active && active.dataset.gameId,
        rows: setup.querySelectorAll('.setup-game').length,
        detectBtn: !!document.getElementById('setup-detect'),
        backShown: !document.getElementById('setup-back').hidden
      };
      document.getElementById('setup-back').click();
      res.homeBack = !home.classList.contains('hidden') && setup.classList.contains('hidden');
      return res;
    })()`);
    check('renderer: needs-setup card opens Setup for that game and Back returns',
      setupOk.setupShown && setupOk.homeHidden && setupOk.activeGame === setupOk.gameId && setupOk.rows === 4 && setupOk.detectBtn && setupOk.backShown && setupOk.homeBack, setupOk);
    const detect = await call('window.kh1.setup.detectGames()');
    check('setup.detectGames returns collections', detect && Array.isArray(detect.collections) && detect.games && typeof detect.games === 'object', detect);
    const chk = await call(`window.kh1.setup.checkGameDir(${J({ gameId: 'kh-ddd', dir: engDir })})`);
    check('setup.checkGameDir rejects a folder without the game archive', chk && chk.ok === false && /kh3d_first/.test(chk.expected) && /2\.8/.test(chk.collection), chk);
    const noErrors = await call('window.__khRendererErrors || []');
    check('renderer: no uncaught errors', Array.isArray(noErrors) && noErrors.length === 0, noErrors);
  } catch (e) {
    failures.push('exception: ' + (e && e.stack || e));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }

  if (failures.length) {
    console.log('SMOKE FAIL\n' + failures.map(f => ' - ' + f).join('\n'));
    app.exit(1);
  } else {
    console.log('SMOKE OK');
    app.exit(0);
  }
}

function install(win) {
  win.webContents.once('did-finish-load', () => {
    // Дати renderer'у виконати bootstrap (i18n, home).
    setTimeout(() => runSmoke(win).catch((e) => { console.log('SMOKE FAIL (crash): ' + e); app.exit(1); }), 800);
  });
}

module.exports = { install };
