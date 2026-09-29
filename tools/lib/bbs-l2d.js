'use strict';

// BBS .l2d (Layout 2D, 'L2D@0001') — розкладки меню з ВБУДОВАНИМ текстом (пауза
// Continue/Resume/Skip Scene, camp Command Decks/Items/…, вибір режиму гри тощо).
// Текст лежить у секції 'LY2@' (завжди остання у файлі):
//   LY2@ +0x28: n текстових елементів, +0x2c: зсув таблиці елементів (16 B кожен:
//   u32 зсув рядка у пулі, RGBA, прапорці), +0x34: зсув пулу рядків (NUL-terminated,
//   кодування гри — cp932 + кирилиця на 0x83xx, як у .ctd), +0x38: наступна секція
//   (імена розкладок), +0x3c: кінець даних LY2@ (далі — хвіст-вирівнювання).
//   Зовнішній заголовок: +0x28 зсув LY2@, +0x2c повна довжина файла.
// Змінені рядки дописуються в кінець пулу, секції після нього зсуваються на дельту
// (вирівняну до 16), правляться обидва заголовки; без змін файл лишається побайтово.

const MAGIC_L2D = Buffer.from('L2D@');
const MAGIC_LY2 = Buffer.from('LY2@');

function parseL2d(buf) {
  if (buf.length < 0x40 || !buf.subarray(0, 4).equals(MAGIC_L2D)) throw new Error('not an L2D@ file');
  const ly = buf.readUInt32LE(0x28);
  if (ly + 0x40 > buf.length || !buf.subarray(ly, ly + 4).equals(MAGIC_LY2)) throw new Error('LY2@ section not found');
  const h = (o) => buf.readUInt32LE(ly + o);
  const n = h(0x28), tab = h(0x2c), pool = h(0x34), next = h(0x38), end = h(0x3c);
  const poolBuf = buf.subarray(ly + pool, ly + next);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const off = buf.readUInt32LE(ly + tab + i * 16);
    let e = poolBuf.indexOf(0, off); if (e < 0) e = poolBuf.length;
    entries.push({ index: i, poolOffset: off, raw: poolBuf.subarray(off, e) });
  }
  return { ly, n, tab, pool, next, end, entries };
}

// rebuildL2d(buf, rawByIndex: Map<index, Buffer>) → новий буфер ТІЄЇ САМОЇ ДОВЖИНИ.
function rebuildL2d(buf, rawByIndex, report) {
  const p = parseL2d(buf);
  const changed = p.entries.filter((e) => rawByIndex.has(e.index) && !rawByIndex.get(e.index).equals(e.raw));
  if (!changed.length) return Buffer.from(buf);

  // Розкладку НІКОЛИ не збільшуємо: у контейнері .arc за нею йдуть текстури,
  // і будь-який зсув ламає їх у грі (титульний екран, смуги підказок).
  // Спершу пробуємо вкластися у наявний пул, зібравши його наново; якщо не
  // влазить — звільняємо японські залишки; якщо й тоді ні — лишаємо файл як є,
  // краще англійський напис, ніж зіпсована графіка.
  const tight = rebuildPoolInPlace(buf, p, rawByIndex, false);
  if (tight.out) {
    if (report) Object.assign(report, { fit: 'in-place', need: tight.need, poolLen: tight.poolLen });
    return tight.out;
  }
  const loose = rebuildPoolInPlace(buf, p, rawByIndex, true);
  if (loose.out) {
    if (report) Object.assign(report, { fit: 'reclaimed', need: loose.need, poolLen: loose.poolLen });
    return loose.out;
  }
  if (report) {
    Object.assign(report, { fit: 'skipped', need: loose.need, poolLen: loose.poolLen, entries: p.entries });
  }
  return Buffer.from(buf);
}

// Рядок «мертвий» для англійської збірки: жодної латинської літери й жодного
// токена {…} — тобто це японський залишок, який видно лише в JP-версії.
// Заглушки розмітника: рядок з однієї повтореної літери («aaaa», «AAAAAAA»,
// «WWWWWWWWWW») — це не текст гри, а «рибка», якою міряли блок у редакторі
// розкладок. Звільняємо її місце під переклад — але лише у другому заході,
// коли без цього текст не влазить.
function isDeadFiller(raw) {
  if (raw.length < 4) return false;
  const s = raw.toString('latin1');
  if (!/^[A-Za-z]+$/.test(s)) return false;
  const c = s[0].toLowerCase();
  return s.split('').every((x) => x.toLowerCase() === c);
}

function isDeadJp(raw) {
  const s = raw.toString('latin1');
  if (!raw.length) return false;
  if (/[A-Za-z]/.test(s)) return false;
  if (s.includes('{')) return false;
  return raw.some((b) => b >= 0x80);
}

// Зібрати пул рядків наново, НЕ змінюючи довжини файла: лише ті рядки, на які
// посилається таблиця, дублікати — один раз, решта місця — нулі. Повертає новий
// буфер тієї самої довжини або null, якщо переклад не влазить.
function rebuildPoolInPlace(buf, p, rawByIndex, dropDead) {
  const ly = p.ly;
  const poolLen = p.next - p.pool;
  const parts = [];
  const offOf = new Map();
  const offsets = new Map();
  const EMPTY = Buffer.alloc(0);
  let size = 0;
  for (const e of p.entries) {
    let raw = rawByIndex.has(e.index) ? rawByIndex.get(e.index) : e.raw;
    // Другий захід: японські залишки (в англійській збірці їх не видно) кладемо
    // на один спільний порожній рядок — це звільняє місце під переклад.
    if (dropDead && !rawByIndex.has(e.index) && (isDeadJp(e.raw) || isDeadFiller(e.raw))) raw = EMPTY;
    const key = raw.toString('hex');
    if (!offOf.has(key)) {
      offOf.set(key, size);
      parts.push(raw, Buffer.alloc(1));
      size += raw.length + 1;
    }
    offsets.set(e.index, offOf.get(key));
  }
  if (size > poolLen) return { need: size, poolLen };   // не влазить — рахуємо скільки бракує
  const out = Buffer.from(buf);
  out.fill(0, ly + p.pool, ly + p.next);
  Buffer.concat(parts).copy(out, ly + p.pool);
  for (const [i, off] of offsets) out.writeUInt32LE(off, ly + p.tab + i * 16);
  return { out, need: size, poolLen };
}

module.exports = { parseL2d, rebuildL2d };
