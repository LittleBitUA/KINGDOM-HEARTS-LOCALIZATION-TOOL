'use strict';

// Editor-режим: відкрити/зберегти один файл через codec-worker.

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const win = require('./window');
const { runWorker } = require('./worker-pool');
const codec = require('../shared/codec');
const { dl } = require('./menu');

const filtersOpen = () => [
  { name: dl('supported') + ' (*.bin;*.binl;*.ard;*.ctdl)', extensions: ['bin', 'binl', 'ard', 'ctdl'] },
  { name: dl('binFiles') + ' (*.bin)', extensions: ['bin'] },
  { name: dl('binlFiles') + ' (*.binl)', extensions: ['binl'] },
  { name: dl('ardFiles') + ' (*.ard)', extensions: ['ard'] },
  { name: dl('ctdlFiles') + ' (*.ctdl)', extensions: ['ctdl'] },
  { name: dl('allFiles'), extensions: ['*'] }
];

const filtersSave = () => filtersOpen().slice(1);

ipcMain.handle('file:open', async (_e, opts) => {
  // decodeMode: 'smart' (default) | 'overlay' | 'base' — див. shared/codec.js
  const decodeMode = (opts && ['smart', 'overlay', 'base'].includes(opts.decodeMode)) ? opts.decodeMode : 'smart';
  const result = await dialog.showOpenDialog(win.get(), {
    title: dl('importFile'),
    properties: ['openFile'],
    filters: filtersOpen()
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }
  const filePath = result.filePaths[0];
  try {
    const buffer = await fs.readFile(filePath);
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const r = await runWorker({ op: 'decode', bytes: ab, decodeMode, scheme: codec.getDefaultScheme() }, [ab]);
    return {
      canceled: false,
      decodeMode,
      filePath,
      fileName: path.basename(filePath),
      byteLength: buffer.length,
      text: r.text
    };
  } catch (e) {
    return { canceled: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('file:save', async (_event, payload) => {
  const text = (payload && payload.text) != null ? payload.text : '';
  const suggestedName = (payload && payload.suggestedName) || 'untitled.bin';

  const result = await dialog.showSaveDialog(win.get(), {
    title: dl('exportFile'),
    defaultPath: suggestedName,
    filters: filtersSave()
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  let bytes;
  try {
    const r = await runWorker({ op: 'encode', text, scheme: codec.getDefaultScheme() });
    bytes = Buffer.from(r.bytes);
  } catch (e) {
    return { canceled: false, error: (e && e.message) || String(e) };
  }

  try {
    await fs.writeFile(result.filePath, bytes);
  } catch (e) {
    return { canceled: false, error: 'Не вдалося записати файл: ' + ((e && e.message) || String(e)) };
  }

  return {
    canceled: false,
    filePath: result.filePath,
    fileName: path.basename(result.filePath),
    byteLength: bytes.length
  };
});
