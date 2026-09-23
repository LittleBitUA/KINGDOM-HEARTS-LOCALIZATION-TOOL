'use strict';

// Автопошук встановлених збірок Kingdom Hearts: Steam (усі бібліотеки на всіх
// дисках), Epic Games Store, плюс перебір типових тек на кожному диску.
// Повертає теки збірок і мапу gameId → тека (перший знайдений виграє).

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Збірки: які ігри містять, як називаються теки у Steam/Epic, за чим упізнати.
const COLLECTIONS = [
  {
    key: 'kh1525',
    name: 'KINGDOM HEARTS HD 1.5+2.5 ReMIX',
    short: 'KH HD 1.5+2.5 ReMIX',
    steamAppId: '2552430',
    dirNames: ['KINGDOM HEARTS -HD 1.5+2.5 ReMIX-', 'KH_1.5_2.5'],
    games: ['kh1-final-mix', 'kh-re-com', 'kh-bbs-final-mix', 'kh-days', 'kh-recoded', 'kh-theater'],
    markers: ['Image/dt/kh1_first.hed', 'Image/en/kh1_first.hed', 'Image/dt/Recom.hed', 'Image/en/Recom.hed']
  },
  {
    key: 'kh28',
    name: 'KINGDOM HEARTS HD 2.8 Final Chapter Prologue',
    short: 'KH HD 2.8',
    steamAppId: '2552440',
    dirNames: ['KINGDOM HEARTS HD 2.8 Final Chapter Prologue', 'KH_2.8'],
    games: ['kh-ddd'],
    markers: ['Image/dt/kh3d_first.hed', 'Image/en/kh3d_first.hed']
  }
];

function exists(p) { try { return fs.existsSync(p); } catch (_) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }

// Чи тека справді є збіркою (є хоч один маркерний .hed або тека Image).
function matchCollection(dir) {
  if (!isDir(dir)) return null;
  for (const c of COLLECTIONS) {
    if (c.markers.some(m => exists(path.join(dir, m)))) return c;
  }
  return null;
}

function driveLetters() {
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const d = String.fromCharCode(i) + ':\\';
    if (isDir(d)) out.push(d);
  }
  return out;
}

function regQuery(hive, key, value) {
  try {
    const txt = execFileSync('reg', ['query', hive + '\\' + key, '/v', value], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const m = txt.match(/REG_SZ\s+(.+)$/m);
    return m ? m[1].trim() : null;
  } catch (_) { return null; }
}

// Усі Steam-бібліотеки: реєстр → libraryfolders.vdf, плюс типові теки на дисках.
function steamLibraries() {
  const libs = new Map();   // lower-case → як на диску (дедуплікація за регістром)
  const roots = [];
  if (process.platform === 'win32') {
    for (const r of [
      regQuery('HKCU', 'Software\\Valve\\Steam', 'SteamPath'),
      regQuery('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
      regQuery('HKLM', 'SOFTWARE\\Valve\\Steam', 'InstallPath')
    ]) if (r) roots.push(r.replace(/\//g, '\\'));
  }
  for (const d of driveLetters()) {
    for (const rel of ['Steam', 'SteamLibrary', 'Program Files (x86)\\Steam', 'Program Files\\Steam', 'Games\\Steam', 'Games\\SteamLibrary', 'Ігри\\SteamLibrary', 'Игры\\SteamLibrary']) {
      roots.push(path.join(d, rel));
    }
  }
  for (const root of roots) {
    if (!isDir(root)) continue;
    if (isDir(path.join(root, 'steamapps'))) libs.set(root.toLowerCase(), path.normalize(root));
    // libraryfolders.vdf перелічує всі бібліотеки на всіх дисках.
    for (const vdf of [path.join(root, 'steamapps', 'libraryfolders.vdf'), path.join(root, 'config', 'libraryfolders.vdf')]) {
      let txt;
      try { txt = fs.readFileSync(vdf, 'utf8'); } catch (_) { continue; }
      const re = /"path"\s+"([^"]+)"/g;
      let m;
      while ((m = re.exec(txt))) {
        const p = m[1].replace(/\\\\/g, '\\');
        if (isDir(path.join(p, 'steamapps'))) libs.set(p.toLowerCase(), path.normalize(p));
      }
    }
  }
  return [...libs.values()];
}

// Гра у Steam-бібліотеці: appmanifest_<id>.acf → installdir, або тека за назвою.
function steamCollections() {
  const found = [];
  for (const lib of steamLibraries()) {
    const common = path.join(lib, 'steamapps', 'common');
    for (const c of COLLECTIONS) {
      let dir = null;
      try {
        const acf = fs.readFileSync(path.join(lib, 'steamapps', 'appmanifest_' + c.steamAppId + '.acf'), 'utf8');
        const m = acf.match(/"installdir"\s+"([^"]+)"/);
        if (m) dir = path.join(common, m[1]);
      } catch (_) {}
      if (!dir || !isDir(dir)) dir = c.dirNames.map(n => path.join(common, n)).find(isDir) || null;
      if (dir && matchCollection(dir)) found.push({ key: c.key, name: c.name, path: dir, source: 'steam', games: c.games.slice() });
    }
  }
  return found;
}

// Epic Games: маніфести лаунчера (InstallLocation) + типові теки.
function epicCollections() {
  const found = [];
  const dirs = new Set();
  const manifests = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let items = [];
  try { items = fs.readdirSync(manifests).filter(f => /\.item$/i.test(f)); } catch (_) {}
  for (const f of items) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(manifests, f), 'utf8'));
      const loc = j.InstallLocation || j.ManifestLocation;
      if (loc && /kingdom\s*hearts|\bKH_/i.test(String(j.DisplayName || '') + ' ' + String(j.AppName || '') + ' ' + loc)) dirs.add(loc);
    } catch (_) {}
  }
  for (const d of driveLetters()) {
    for (const base of ['Program Files\\Epic Games', 'Epic Games', 'Games\\Epic Games']) {
      for (const c of COLLECTIONS) for (const n of c.dirNames) dirs.add(path.join(d, base, n));
    }
  }
  for (const dir of dirs) {
    const c = matchCollection(dir);
    if (c) found.push({ key: c.key, name: c.name, path: path.normalize(dir), source: 'epic', games: c.games.slice() });
  }
  return found;
}

// Головна точка: збірки + мапа gameId → тека. Steam має пріоритет над Epic.
function detectGames() {
  const collections = [];
  const seen = new Set();
  for (const c of [...steamCollections(), ...epicCollections()]) {
    const k = c.path.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    collections.push(c);
  }
  const games = {};
  for (const c of collections) {
    for (const gid of c.games) {
      if (!games[gid]) games[gid] = { path: c.path, collection: c.name, source: c.source };
    }
  }
  return { collections, games };
}

module.exports = { detectGames, COLLECTIONS, steamLibraries, matchCollection };
