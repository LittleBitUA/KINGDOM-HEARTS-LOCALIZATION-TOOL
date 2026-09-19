'use strict';

// Атомарний запис файлів: пишемо у `<path>.tmp-<pid>-<rand>` і rename'имо
// поверх цільового. Так краш/вимкнення живлення посеред запису ніколи не
// лишає 0-байтний або обрізаний TSV/глосарій/settings — на диску або стара
// повна версія, або нова повна.
//
// Опційно тримаємо ротацію бекапів `<path>.bak.1 … .bak.N` (N = opts.backups):
// перед rename старий файл зсувається у .bak.1, .bak.1 → .bak.2 і т.д.

const fs = require('fs');
const fsP = require('fs/promises');
const path = require('path');

function tmpNameFor(target) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return target + '.tmp-' + process.pid + '-' + rnd;
}

function rotateBackupsSync(target, backups) {
  if (!backups || backups <= 0) return;
  if (!fs.existsSync(target)) return;
  // Зсуваємо з кінця, щоб не перезаписати ще не зсунутий файл.
  for (let i = backups - 1; i >= 1; i--) {
    const from = target + '.bak.' + i;
    const to = target + '.bak.' + (i + 1);
    try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch (_) {}
  }
  try { fs.copyFileSync(target, target + '.bak.1'); } catch (_) {}
}

async function rotateBackups(target, backups) {
  if (!backups || backups <= 0) return;
  try { await fsP.access(target); } catch (_) { return; }
  for (let i = backups - 1; i >= 1; i--) {
    const from = target + '.bak.' + i;
    const to = target + '.bak.' + (i + 1);
    try { await fsP.rename(from, to); } catch (_) {}
  }
  try { await fsP.copyFile(target, target + '.bak.1'); } catch (_) {}
}

// writeFileAtomicSync(path, data, { encoding?, backups? })
function writeFileAtomicSync(target, data, opts) {
  const o = opts || {};
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = tmpNameFor(target);
  try {
    fs.writeFileSync(tmp, data, o.encoding ? { encoding: o.encoding } : undefined);
    rotateBackupsSync(target, o.backups);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

// writeFileAtomic(path, data, { encoding?, backups? }) → Promise
async function writeFileAtomic(target, data, opts) {
  const o = opts || {};
  await fsP.mkdir(path.dirname(target), { recursive: true });
  const tmp = tmpNameFor(target);
  try {
    await fsP.writeFile(tmp, data, o.encoding ? { encoding: o.encoding } : undefined);
    await rotateBackups(target, o.backups);
    await fsP.rename(tmp, target);
  } catch (e) {
    try { await fsP.unlink(tmp); } catch (_) {}
    throw e;
  }
}

module.exports = { writeFileAtomic, writeFileAtomicSync };
