'use strict';

// KH1 .binl (EvMsg header) та raw .bin — через codec-worker (extract/compose).
// Extract потребує reference-файл (rusPath): рядки, які є у ньому дослівно,
// вважаються неперекладними (preserved). Якщо rusPath нема — reference = eng
// (усе preserved → 0 слотів), тому caller має передати rusPath або порожній буфер.

const fs = require('fs/promises');
const codec = require('../../../shared/codec');

function toAb(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Fallback без worker'а (тести / CLI): виконуємо extract/compose in-process.
async function inProcessWorker(payload) {
  const { extract } = require('../extract');
  const { compose } = require('../build');
  if (payload.op === 'extract') {
    const r = extract(Buffer.from(payload.eng), Buffer.from(payload.rus), payload.opts || {});
    return { ok: true, slots: r.slots, stats: r.stats };
  }
  if (payload.op === 'compose') {
    const r = compose(Buffer.from(payload.eng), payload.replacements || []);
    return { ok: true, bytes: toAb(r.buffer), errors: r.errors, applied: r.applied, skipped: r.skipped };
  }
  throw new Error('inProcessWorker: unknown op ' + payload.op);
}

async function parse(engPath, env) {
  const runWorker = env.runWorker || inProcessWorker;
  const eng = await fs.readFile(engPath);
  let rus;
  if (env.rusPath) {
    try { rus = await fs.readFile(env.rusPath); } catch (_) { rus = Buffer.alloc(0); }
  } else {
    rus = Buffer.alloc(0);
  }
  const opts = Object.assign({}, (env.cls && env.cls.extractOpts) || {}, env.opts || {});
  const engAb = toAb(eng);
  const rusAb = toAb(rus);
  const r = await runWorker({ op: 'extract', eng: engAb, rus: rusAb, opts, scheme: codec.getDefaultScheme() }, [engAb, rusAb]);
  const slots = r.slots.map(s => ({
    index: s.index,
    offset: s.offset,
    byteLen: s.byteLen,
    english: s.english,
    key: s.english
  }));

  return {
    slots,
    stats: r.stats,
    engSize: eng.length,
    rusSize: rus.length,
    async compose(ukByOffset) {
      const replacements = [];
      for (const s of slots) {
        const uk = ukByOffset.get(s.offset);
        if (uk) replacements.push({ offset: s.offset, oldLen: s.byteLen, ukText: uk });
      }
      // Буфер міг бути transfer'нутий у worker при extract — читаємо знову.
      const eng2 = await fs.readFile(engPath);
      const ab = toAb(eng2);
      const c = await runWorker({ op: 'compose', eng: ab, replacements, scheme: codec.getDefaultScheme() }, [ab]);
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

module.exports = { kind: 'binl', preserveWhitespace: true, structuralGuard: true, parse };
