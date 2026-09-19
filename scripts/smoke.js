#!/usr/bin/env node
'use strict';

// Запускає Electron з KH_SMOKE=1 (headless e2e IPC-тест, див. main/smoke.js)
// і прокидає його exit-code. Знімає ELECTRON_RUN_AS_NODE, який VS Code
// виставляє дочірнім процесам (інакше Electron стартує як голий Node).

const { spawnSync } = require('child_process');
const path = require('path');

const electron = require('electron'); // шлях до бінарника
const env = Object.assign({}, process.env, { KH_SMOKE: '1' });
delete env.ELECTRON_RUN_AS_NODE;

const r = spawnSync(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit', timeout: 60000 });
if (r.error) { console.error(r.error); process.exit(1); }
process.exit(r.status == null ? 1 : r.status);
