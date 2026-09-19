'use strict';

const { parentPort } = require('worker_threads');
const { decode, encode, loadMap, setDefaultScheme } = require('../shared/codec');
const { extract } = require('../tools/lib/extract');
const { compose } = require('../tools/lib/build');

loadMap();

function arrayBufferOf(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

parentPort.on('message', (msg) => {
  const id = msg && msg.id;
  const op = msg && msg.op;
  try {
    // Схема кирилиці (overlay/native) приходить з main разом із кожним запитом.
    setDefaultScheme((msg && msg.scheme) || 'overlay');
    if (op === 'decode') {
      const buf = Buffer.from(msg.bytes);
      const mode = msg.decodeMode === 'base' ? false : (msg.decodeMode === 'overlay' ? true : 'smart');
      // «Message v361» (sysmsg) має інший набір керівних команд — власний діалект декодера.
      const cmd = buf.length >= 12 && buf.toString('ascii', 0, 12) === 'Message v361' ? 'sysmsg' : 'evmsg';
      const text = decode(buf, { overlay: mode, cmd });
      parentPort.postMessage({ id, ok: true, text });
      return;
    }

    if (op === 'encode') {
      const buf = encode(msg.text);
      const ab = arrayBufferOf(buf);
      parentPort.postMessage({ id, ok: true, bytes: ab }, [ab]);
      return;
    }

    if (op === 'extract') {
      const eng = Buffer.from(msg.eng);
      const rus = Buffer.from(msg.rus);
      const r = extract(eng, rus, msg.opts || {});
      parentPort.postMessage({ id, ok: true, slots: r.slots, stats: r.stats });
      return;
    }

    if (op === 'compose') {
      const eng = Buffer.from(msg.eng);
      const r = compose(eng, msg.replacements || []);
      const ab = arrayBufferOf(r.buffer);
      parentPort.postMessage(
        { id, ok: true, bytes: ab, errors: r.errors, applied: r.applied, skipped: r.skipped },
        [ab]
      );
      return;
    }

    parentPort.postMessage({ id, ok: false, error: 'Невідома операція: ' + String(op) });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: (e && e.message) || String(e) });
  }
});
