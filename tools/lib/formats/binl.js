'use strict';

// KH1 .binl (EvMsg header) та raw .bin — через codec-worker (extract/compose).
// Extract потребує reference-файл (refPath): рядки, які є у ньому дослівно,
// вважаються неперекладними (preserved). Якщо refPath нема — reference = eng
// (усе preserved → 0 слотів), тому caller має передати refPath або порожній буфер.

const fs = require('fs/promises');

function toAb(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Fallback без worker'а (тести / CLI): виконуємо extract/compose in-process.
async function inProcessWorker(payload) {
  const { extract } = require('../extract');
  const { compose } = require('../build');
  if (payload.op === 'extract') {
    const r = extract(Buffer.from(payload.eng), Buffer.from(payload.ref), payload.opts || {});
    return { ok: true, slots: r.slots, stats: r.stats };
  }
  if (payload.op === 'compose') {
    const r = compose(Buffer.from(payload.eng), payload.replacements || [], payload.opts || {});
    return { ok: true, bytes: toAb(r.buffer), errors: r.errors, applied: r.applied, skipped: r.skipped };
  }
  throw new Error('inProcessWorker: unknown op ' + payload.op);
}

async function parse(engPath, env) {
  const runWorker = env.runWorker || inProcessWorker;
  const eng = await fs.readFile(engPath);
  let ref;
  if (env.refPath) {
    try { ref = await fs.readFile(env.refPath); } catch (_) { ref = Buffer.alloc(0); }
  } else {
    ref = Buffer.alloc(0);
  }
  const opts = Object.assign({}, (env.cls && env.cls.extractOpts) || {}, env.opts || {});
  // Сирі .bin (btltbl: назви вмінь і предметів, команди бою, магазини) гра
  // малює системним шрифтом — там своя однобайтова кирилиця. Справжні
  // EvMsg-.binl — це діалоги, у них лишається екран `19 NN`.
  const sysfont = !!(env.cls && env.cls.kind === 'rawbin');
  const engAb = toAb(eng);
  const refAb = toAb(ref);
  const r = await runWorker({ op: 'extract', eng: engAb, ref: refAb, opts }, [engAb, refAb]);
  const slots = r.slots.map(s => ({
    index: s.index,
    offset: s.offset,
    byteLen: s.byteLen,
    english: s.english,
    key: s.english,
    // Службова обгортка сторінки — не показується перекладачеві, дописується
    // назад при збірці (див. tools/lib/extract.js).
    prefix: s.prefix || '',
    suffix: s.suffix || ''
  }));

  return {
    slots,
    stats: r.stats,
    engSize: eng.length,
    refSize: ref.length,
    async compose(ukByOffset) {
      const replacements = [];
      for (const s of slots) {
        const uk = ukByOffset.get(s.offset);
        if (uk) replacements.push({ offset: s.offset, oldLen: s.byteLen, ukText: uk });
      }
      // Буфер міг бути transfer'нутий у worker при extract — читаємо знову.
      const eng2 = await fs.readFile(engPath);
      const ab = toAb(eng2);
      const c = await runWorker({ op: 'compose', eng: ab, replacements, opts: { sysfont } }, [ab]);
      return {
        outputs: [{ buf: Buffer.from(c.bytes), pathFor: (outPath) => outPath }],
        applied: c.applied || 0,
        skipped: c.skipped || 0,
        errors: c.errors || [],
        extra: {}
      };
    }
  };
}

// pageLimits — межі розкладки діалогів (384 гліфи / 32 рядки на сторінку);
// у меню-рендерера свої буфери, тому там ця перевірка не діє.
module.exports = { kind: 'binl', preserveWhitespace: true, structuralGuard: true, pageLimits: true, parse };
