'use strict';

const path = require('path');
const codec = require('../shared/codec');
const { Worker } = require('worker_threads');

// =====================================================================
// Worker pool — паралельне виконання codec-worker задач.
// Замість одного worker'а тримаємо POOL_SIZE workers і розподіляємо задачі
// round-robin. Кожен worker має своє pending-map. Це дозволяє buildGlossary
// та composeAll обробляти 4-8 файлів одночасно (CPU cores), що зменшує
// загальний час у кілька разів.
// =====================================================================
const POOL_SIZE = Math.max(2, Math.min(8, require('os').cpus().length));
const CODEC_SCRIPT = path.join(__dirname, '..', 'workers', 'codec-worker.js');
const FORMAT_SCRIPT = path.join(__dirname, '..', 'workers', 'format-worker.js');

// createPool(scriptPath) → { runWorker, broadcast, terminateAll } — пул воркерів
// одного скрипта. Два пули: codec-worker (extract/compose/encode/decode binl)
// і format-worker (розбір/збірка будь-якого формату + список файлів).
function createPool(scriptPath) {
  let workerSeq = 0;
  const workerPool = [];   // [{ worker, pending: Map<id, {resolve, reject}> }]
  let workerRR = 0;        // round-robin counter

  function rejectWorkerPending(slot, reason) {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    for (const { reject } of slot.pending.values()) reject(err);
    slot.pending.clear();
  }

  function makeWorkerSlot() {
    // Користувацька карта нативних гліфів — та сама, що й у main (див. codec.setNativeMapPath).
    const w = new Worker(scriptPath, { workerData: { nativeMapPath: codec.getNativeMapPath() } });
    const slot = { worker: w, pending: new Map() };
    w.on('message', (msg) => {
      const id = msg && msg.id;
      const p = slot.pending.get(id);
      if (!p) return;
      slot.pending.delete(id);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(msg.error || 'Помилка обробника'));
    });
    w.on('error', (err) => {
      rejectWorkerPending(slot, err);
      // позначити slot як «мертвий»; перестворимо на наступному виклику
      slot.dead = true;
    });
    w.on('exit', () => {
      rejectWorkerPending(slot, 'Обробник завершив роботу');
      slot.dead = true;
    });
    return slot;
  }

  function getWorkerSlot() {
    // Лінива ініціалізація pool'а на перший виклик.
    if (workerPool.length === 0) {
      for (let i = 0; i < POOL_SIZE; i++) workerPool.push(makeWorkerSlot());
    }
    // Перебудуй якщо якийсь slot помер.
    for (let i = 0; i < workerPool.length; i++) {
      if (workerPool[i].dead) workerPool[i] = makeWorkerSlot();
    }
    // Стратегія: round-robin серед slot'ів. Простіше за least-loaded і
    // на практиці добре розподіляє рівномірне навантаження (всі задачі ~однакові).
    const slot = workerPool[workerRR % workerPool.length];
    workerRR++;
    return slot;
  }

  function runWorkerOnce(payload, transferList) {
    return new Promise((resolve, reject) => {
      const id = ++workerSeq;
      const slot = getWorkerSlot();
      slot.pending.set(id, { resolve, reject });
      try {
        slot.worker.postMessage(Object.assign({ id }, payload), transferList || []);
      } catch (e) {
        slot.pending.delete(id);
        reject(e);
      }
    });
  }

  // Якщо worker впав (crash/OOM), усі його pending-задачі відхиляються з
  // «Обробник завершив роботу». Одна повторна спроба на новому slot'і — інакше
  // composeAll втрачав би 1/N файлів через один збій. Transfer-list не можна
  // переслати вдруге (буфери вже відчужені), тому retry лише без нього.
  async function runWorker(payload, transferList) {
    try {
      return await runWorkerOnce(payload, transferList);
    } catch (e) {
      const workerDied = e && /завершив роботу|Обробник/.test(String(e.message));
      if (!workerDied || (transferList && transferList.length)) throw e;
      return runWorkerOnce(payload, []);
    }
  }

  // broadcast(payload) — одне повідомлення кожному воркеру пулу (напр. глосарій перед composeAll).
  async function broadcast(payload) {
    if (workerPool.length === 0) getWorkerSlot();
    await Promise.all(workerPool.map((slot) => new Promise((resolve, reject) => {
      if (slot.dead) return resolve();
      const id = ++workerSeq;
      slot.pending.set(id, { resolve, reject });
      try { slot.worker.postMessage(Object.assign({ id }, payload)); } catch (e) { slot.pending.delete(id); reject(e); }
    })));
  }

  function terminateAll() {
    for (const slot of workerPool) {
      if (slot && slot.worker) {
        try { slot.worker.terminate(); } catch (_) {}
      }
    }
    workerPool.length = 0;
  }

  return { runWorker, broadcast, terminateAll };
}

const codecPool = createPool(CODEC_SCRIPT);
const formatPool = createPool(FORMAT_SCRIPT);
function terminateAll() { codecPool.terminateAll(); formatPool.terminateAll(); }

module.exports = {
  runWorker: codecPool.runWorker, terminateAll, POOL_SIZE, createPool,
  runFormat: formatPool.runWorker, broadcastFormat: formatPool.broadcast
};
