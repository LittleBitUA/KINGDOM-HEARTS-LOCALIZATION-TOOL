'use strict';

// Класифікація файлів гри за іменем/розширенням/magic-байтами.
//
//  - 'binl'    — структурований .binl з EvMsg-заголовком (header=11, footer=5)
//  - 'binl-v361' — .binl «Message v361» (sysmsg: таблиця u16-зсувів + текст)
//  - 'rawbin'  — сирий .bin із KH1-кодованим текстом, без заголовка
//                (наприклад btltbl.bin/UK_AbilityName.bin тощо)
//  - 'mesofs'  — парний формат *_mes_ofs.bin + *_mes_data.bin (і *_offset.bin + *_data.bin)
//  - 'mesdata' — друга половина пари (не перекладається напряму)
//  - 'ev'      — .ev/.evdl event-script container з текст-блоком
//  - 'ctd'     — BBS dialogue/menu container ('@CTD' версія 1)
//  - 'ctd-ddd' — KH3D Dream Drop Distance ('@CTD' версія 0x1F7, UTF-16LE)
//  - 'ctdl'    — Re:CoM CTDL (той самий magic '@CTD', інший layout; за розширенням)
//  - 'unknown' — байткод/контейнер/інше — не чіпати
//
// Результат кешується за (path, size, mtimeMs): walkDir → extract → compose →
// composeAll раніше відкривали кожен файл по 3-4 рази.

const fs = require('fs');
const path = require('path');
const { isMesOfsName, pairedDataName, pairedOfsName, pairedDataDirs, pairDialect } = require('../mes-ofs');
const { isEvName } = require('../ev-format');
const { MAGIC: CTD_MAGIC } = require('../ctd-format');
const { MAGIC: CTDL_MAGIC } = require('../recom-ctdl-format');
const { VERSION: DDD_VERSION } = require('../ddd-ctd');
const { MAGIC: MSG_V361_MAGIC } = require('../msg-v361');

// .binl магічна сигнатура: ASCII "EvMsg" перші 5 байт
const BINL_MAGIC = Buffer.from([0x45, 0x76, 0x4D, 0x73, 0x67]);
// .ard магічна сигнатура (KGR + NUL) — контейнер, не редагується напряму
const ARD_MAGIC = Buffer.from([0x4B, 0x47, 0x52, 0x00]);
// 'TTUI' — бінарні UI-layout'и (exchange/UK_uibin_*.bin, UK_get_w.bin, UK_mg_*.bin,
// UK_com_battle.bin, UK_danger.bin): не текст, хоч і проходять евристику raw .bin.
const TTUI_MAGIC = Buffer.from([0x54, 0x54, 0x55, 0x49]);

const cache = new Map();   // absPath → { size, mtimeMs, result }
const CACHE_MAX = 20000;

function readHead(absPath, n) {
  let fd = null;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(n);
    const got = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } catch (_) {
    return Buffer.alloc(0);
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

// Таблиця зсувів для data-файла: та сама тека або (SASAMSG у gumi/SASAMSG.BIN/)
// `../../exchange/` чи `../../../original/exchange/`.
function hasOfsNearby(absPath, ofsName) {
  const dir = path.dirname(absPath);
  for (const rel of ['', '../../exchange', '../../../original/exchange']) {
    if (fs.existsSync(path.join(dir, rel, ofsName))) return true;
  }
  return false;
}

function classifyUncached(absPath, ext) {
  const baseName = path.basename(absPath);

  // Парний формат за іменем — найдешевша перевірка. Data-половина може лежати
  // в іншій теці (SASAOMSG у exchange/, SASAMSG — у gumi/SASAMSG.BIN/).
  if (isMesOfsName(baseName)) {
    const dataName = pairedDataName(baseName);
    for (const rel of pairedDataDirs(baseName)) {
      const dataPath = path.join(path.dirname(absPath), rel, dataName);
      if (fs.existsSync(dataPath)) {
        return { kind: 'mesofs', magic: 'mes_ofs', extractOpts: { dataPath, cmd: pairDialect(baseName) }, isTranslatable: true };
      }
    }
  }
  // Друга половина пари (`_mes_data.bin`, `_data.bin` поруч із `_offset.bin`, `*MSG.BIN`
  // з `*OMSG.BIN`, ChallengeMsg з ChallengeOfs) — редагується через таблицю зсувів,
  // не як raw .bin (інакше зсуви «поїдуть»).
  const ofsName = pairedOfsName(baseName);
  if (ofsName && (/_mes_data\.bin$/i.test(baseName) || hasOfsNearby(absPath, ofsName))) {
    return { kind: 'mesdata', magic: 'mes_data', extractOpts: null, isTranslatable: false };
  }
  // menu/md_*.kmb — `u32 count` + рядки меню (словник, гімн, Jiminy, синопсис).
  if (/\.kmb$/i.test(baseName)) {
    return { kind: 'kmb', magic: 'kmb', extractOpts: null, isTranslatable: true };
  }
  // .ev/.evdl: footer/bytecode позиційно-незалежний (підтверджено byte-by-byte
  // порівнянням ENG vs RUS), оновлюється лише header pointer table.
  if (isEvName(baseName)) {
    return { kind: 'ev', magic: 'ev_evdl', extractOpts: null, isTranslatable: true };
  }

  const buf = readHead(absPath, 256);
  const n = buf.length;
  // BBS .ctd і Re:CoM .ctdl ділять magic '@CTD'. Розрізняємо за розширенням;
  // .ctdl перевіряємо першим, щоб BBS-парсер його не зачепив.
  if (n >= 4 && ext === '.ctdl' && buf.readUInt32LE(0) === CTDL_MAGIC) {
    return { kind: 'ctdl', magic: '@CTD', extractOpts: null, isTranslatable: true };
  }
  if (n >= 8 && buf.readUInt32LE(0) === CTD_MAGIC) {
    // Версія розрізняє BBS (1) та Dream Drop Distance (0x1F7, UTF-16LE).
    const ver = buf.readUInt32LE(4);
    if (ver === DDD_VERSION) return { kind: 'ctd-ddd', magic: '@CTD', extractOpts: null, isTranslatable: true };
    return { kind: 'ctd', magic: '@CTD', extractOpts: null, isTranslatable: true };
  }

  let kind = 'unknown';
  let magic = '';
  let extractOpts = null;
  if (n >= 5) {
    magic = buf.subarray(0, 5).toString('ascii');
    const head4 = buf.subarray(0, 4);
    if (ext === '.binl' && buf.subarray(0, 5).equals(BINL_MAGIC)) {
      kind = 'binl';
      extractOpts = { header: 11, footer: 5 };
    } else if (ext === '.binl' && n >= MSG_V361_MAGIC.length && buf.subarray(0, MSG_V361_MAGIC.length).equals(MSG_V361_MAGIC)) {
      kind = 'binl-v361';
      magic = 'Message v361';
    } else if (ext === '.bin' && !head4.equals(ARD_MAGIC) && !head4.equals(TTUI_MAGIC) && !buf.subarray(0, 5).equals(BINL_MAGIC)) {
      // Heuristic для raw text .bin: переважно KH1-printable байти + 0x00-термінатори.
      // 0x00 (sentinel), 0x01-0x0F (control), 0x21-0x79 (ASCII KH1), 0x80-0xFF (extended).
      let printable = 0;
      let zeros = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[i];
        if (b === 0x00) zeros++;
        if (b <= 0x0F || (b >= 0x21 && b <= 0x79) || b >= 0x80) printable++;
      }
      if (n >= 8 && printable / n >= 0.85 && zeros >= 2) {
        kind = 'rawbin';
        extractOpts = { header: 0, footer: 0 };
      }
    }
  }
  return { kind, magic, extractOpts, isTranslatable: kind !== 'unknown' };
}

// classifyFile(absPath, ext?) → { kind, magic, extractOpts, isTranslatable }
function classifyFile(absPath, ext) {
  ext = ext || path.extname(absPath).toLowerCase();
  let st = null;
  try { st = fs.statSync(absPath); } catch (_) { /* нема файлу — без кешу */ }
  if (st) {
    const hit = cache.get(absPath);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.result;
  }
  const result = classifyUncached(absPath, ext);
  if (st) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(absPath, { size: st.size, mtimeMs: st.mtimeMs, result });
  }
  return result;
}

function clearCache() { cache.clear(); }

module.exports = { classifyFile, clearCache, BINL_MAGIC, ARD_MAGIC };
