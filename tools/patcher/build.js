#!/usr/bin/env node
'use strict';

// Збирає окремий встановлювач українізатора — консольну програму, яку
// поширюють разом із файлами .kh1pcpatch / .compcpatch / .bbspcpatch /
// .dddpcpatch. Вона сама знаходить теку гри (Steam, Epic, Steam Deck),
// сама застосовує патч і не потребує ані .NET, ані xdelta, ані KHPCPatchManager
// поруч: усе всередині одного файла.
//
// Всередині — код самого KHPCPatchManager (Apache-2.0, AntonioDePau), який ми
// тягнемо з GitHub на закріпленому теґу й латаємо: прибираємо GUI на
// System.Windows.Forms (він є лише під Windows) і виправляємо місця, де шлях
// збирається через '\' (під Linux це ламало пошук remastered-файлів у патчі).
// Список правок — у PATCHES нижче; кожна падає з помилкою, якщо вихідний код
// змінився, щоб мовчки не зібралося щось інше.
//
//   node tools/patcher/build.js                       — обидві платформи
//   node tools/patcher/build.js --rid win-x64         — лише Windows
//   node tools/patcher/build.js --patches <тека>      — вкласти .pcpatch у реліз
//   node tools/patcher/build.js --clean               — перезавантажити вихідники
//
// Результат: tools/patcher/dist/KH-UA-Patcher-<rid>/ і архів поруч.

const fs = require('fs');
const fsP = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const TAG = 'v1.2.1';                 // закріплена версія KHPCPatchManager
const REPO = 'AntonioDePau/KHPCPatchManager';
const VENDOR = path.join(ROOT, '.vendor', TAG);
const WORK = path.join(ROOT, '.build');
const DIST = path.join(ROOT, 'dist');
const RIDS = ['win-x64', 'linux-x64'];

// Вихідні файли KHPCPatchManager, потрібні для збірки (за теґом TAG).
const SOURCES = [
  'AssemblyInfo.cs',
  'KHPCPatchManager.cs',
  'LICENSE',
  'OpenKH/KH2/constants.cs',
  'OpenKH/Xe.BinaryMapper/BinaryMapping.cs',
  'OpenKH/Xe.BinaryMapper/BinaryMappingHelpers.cs',
  'OpenKH/Xe.BinaryMapper/DataAttribute.cs',
  'OpenKH/Xe.BinaryMapper/HelperMethods.cs',
  'OpenKH/Xe.BinaryMapper/IBinaryMapping.cs',
  'OpenKH/Xe.BinaryMapper/MappingConfiguration.cs',
  'OpenKH/Xe.BinaryMapper/Mappings.cs',
  'OpenKH/Xe.BinaryMapper/RealBinaryMapping.Read.cs',
  'OpenKH/Xe.BinaryMapper/RealBinaryMapping.Write.cs',
  'OpenKH/Xe.BinaryMapper/RealBinaryMapping.cs',
  'OpenKH/egsEncryption.cs',
  'OpenKH/egsHDAsset.cs',
  'OpenKH/egsTools.cs',
  'OpenKH/epicgameassets.cs',
  'OpenKH/extensions.cs',
  'OpenKH/hed.cs',
  'OpenKH/helpers.cs',
  'kh.ico',
  'packages/DotNetZip.dll',
  'resources.zip'
];

// ---------------------------------------------------------------- правки

// Наш ZipManager: той самий контракт, але порівняння імен усередині .pcpatch
// іде за нормалізованим '/'-шляхом, а не через DotNetZip-селектори з '\'.
// Під Windows різниці немає, під Linux без цього патч «не бачить» своїх тек.
const ZIP_MANAGER = `namespace OpenKh.Egs{
	public class ZipManager{
		public static List<ZipFile> ZipFiles {get{return KHPCPatchManager.ZipFiles;}}

		// Шляхи всередині .pcpatch завжди '/'-роздільні, незалежно від ОС.
		private static string Norm(string p){
			if(p == null) return "";
			return p.Replace('\\\\', '/').Trim('/');
		}

		private static bool ZipDirectoryExists(string dir){
			string d = Norm(dir) + "/";
			foreach(var zip in ZipFiles)
				foreach(var name in zip.EntryFileNames)
					if(Norm(name).StartsWith(d, StringComparison.OrdinalIgnoreCase)) return true;
			return false;
		}

		private static ZipEntry FindEntry(string file){
			string f = Norm(file);
			foreach(var zip in ZipFiles)
				foreach(var entry in zip.Entries)
					if(!entry.IsDirectory && Norm(entry.FileName).Equals(f, StringComparison.OrdinalIgnoreCase)) return entry;
			return null;
		}

		public static bool ZipFileExists(string file){
			return FindEntry(file) != null;
		}

		public static bool DirectoryExists(string dir){
			return ZipDirectoryExists(dir) || Directory.Exists(dir);
		}

		public static bool FileExists(string file){
			return ZipFileExists(file) || File.Exists(file);
		}

		// Імена всередині folder, відносні до нього.
		public static IEnumerable<string> GetFiles(string folder){
			string d = Norm(folder) + "/";
			List<string> found = new List<string>();
			foreach(var zip in ZipFiles){
				foreach(var name in zip.EntryFileNames){
					string n = Norm(name);
					if(!n.StartsWith(d, StringComparison.OrdinalIgnoreCase)) continue;
					string rel = n.Substring(d.Length);
					if(rel.Length == 0 || rel.EndsWith("/")) continue;
					if(!found.Contains(rel)) found.Add(rel);
				}
			}
			if(found.Count > 0) return found;
			if(Directory.Exists(folder)) return Helpers.GetAllFiles(folder);
			return Enumerable.Empty<string>();
		}

		public static byte[] FileReadAllBytes(string file){
			ZipEntry entry = FindEntry(file);
			if(entry != null){
				using(var stream = entry.OpenReader()){
					var bytes = new byte[entry.UncompressedSize];
					int read = 0;
					while(read < bytes.Length){
						int n = stream.Read(bytes, read, bytes.Length - read);
						if(n <= 0) break;
						read += n;
					}
					return bytes;
				}
			}
			if(File.Exists(file)) return File.ReadAllBytes(file);
			return new byte[0];
		}

		public static string[] FileReadAllLines(string file){
			if(ZipFileExists(file)){
				string text = System.Text.Encoding.ASCII.GetString(FileReadAllBytes(file));
				return text.Split(new string[]{"\\r\\n", "\\n"}, StringSplitOptions.None);
			}
			if(File.Exists(file)) return File.ReadAllLines(file);
			return new string[0];
		}

		public static Stream FileReadStream(string file){
			if(ZipFileExists(file)) return new MemoryStream(FileReadAllBytes(file));
			if(File.Exists(file)) return File.OpenRead(file);
			return new MemoryStream();
		}
	}
}`;

// Замість вікна на WinForms — підказка в консолі.
const GUI_STUB = `	// GUI на System.Windows.Forms прибрано: ця збірка консольна й однакова
	// під Windows і Linux. Вікном тут керує KhUa.Program.
	static void InitUI(){
		Console.WriteLine("Це консольна збірка. Перетягування файлів у вікно тут немає —");
		Console.WriteLine("вкажіть патч аргументом або запустіть встановлювач без аргументів.");
	}
}`;

// Шлях відносно origin — нормалізуємо ОБИДВА боки до '/'. Головне тут не
// стислість: після цієї правки в коді не лишається жодної гілки, яка залежить
// від роздільника ОС, тож під Windows і під Linux виконується те саме. Тому
// перевірка збірки під Windows щось та й означає для Linux-збірки.
const REL_HELPER = `        static string Rel(string filePath, string origin)
        {
            string f = (filePath ?? "").Replace('\\\\', '/');
            string o = (origin ?? "").Replace('\\\\', '/').TrimEnd('/') + "/";
            return f.StartsWith(o, StringComparison.OrdinalIgnoreCase) ? f.Substring(o.Length) : f;
        }

        public static string GetRelativePath(string filePath, string origin)
        {
            return Rel(filePath, origin);
        }`;

// Кожна правка: { file, find, replace, note }. `find` — рядок або RegExp;
// якщо не знайдено (чи знайдено не стільки, скільки очікуємо) — збірка падає.
const PATCHES = [
  {
    file: 'KHPCPatchManager.cs',
    note: 'WinForms і System.Drawing є лише під Windows',
    find: 'using System.Windows.Forms;\nusing System.Drawing;\n',
    replace: ''
  },
  {
    file: 'KHPCPatchManager.cs',
    note: 'ZipManager: порівняння шляхів усередині .pcpatch без залежності від роздільника ОС',
    findRe: /namespace OpenKh\.Egs\{[\s\S]*?\n\}\n(?=\npublic class KHPCPatchManager)/,
    replace: ZIP_MANAGER + '\n'
  },
  {
    file: 'KHPCPatchManager.cs',
    note: 'DllImport user32/kernel32 під Linux немає — виклики прибрано разом із GUI',
    find: '\t[DllImport("kernel32.dll")]\n\tstatic extern IntPtr GetConsoleWindow();\n\n\t[DllImport("user32.dll")]\n\tstatic extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\n',
    replace: ''
  },
  {
    file: 'KHPCPatchManager.cs',
    note: 'SetProcessDPIAware — теж Windows-only',
    find: '\t[System.Runtime.InteropServices.DllImport("user32.dll")]\n\tprivate static extern bool SetProcessDPIAware();\n',
    replace: ''
  },
  {
    file: 'KHPCPatchManager.cs',
    note: 'їхній Main стає CliMain: точку входу дає наш встановлювач',
    find: '\t[STAThread]\n    static void Main(string[] args){\n\t\tif (Environment.OSVersion.Version.Major >= 6)\n                SetProcessDPIAware();\n\t\tFileVersionInfo fvi = FileVersionInfo.GetVersionInfo(ExecutingAssembly.Location);',
    replace: '    public static void CliMain(string[] args){\n\t\tFileVersionInfo fvi = FileVersionInfo.GetVersionInfo(Environment.ProcessPath ?? ExecutingAssembly.Location);'
  },
  {
    file: 'KHPCPatchManager.cs',
    note: 'UpdateResources потрібен нашому коду',
    find: '\tstatic void UpdateResources(){',
    replace: '\tpublic static void UpdateResources(){'
  },
  {
    file: 'KHPCPatchManager.cs',
    note: 'рядки лише для GUI (status.Text, MessageBox, кнопки)',
    findRe: /^[ \t]*if\(GUI_Displayed\).*\r?\n/gm,
    replace: '',
    expect: 11
  },
  {
    file: 'KHPCPatchManager.cs',
    note: 'саме вікно й діалоги — від полів StatusBar/Button до кінця класу',
    findRe: /\tstatic StatusBar status = new StatusBar\(\);[\s\S]*\n\}\s*$/,
    replace: GUI_STUB + '\n'
  },
  {
    file: 'OpenKH/egsTools.cs',
    note: 'шлях до remastered будували заміною "\\original\\" — під Linux роздільник інший',
    findRe: /completeFilePath\.Replace\("\\\\original\\\\",\s*"\\\\remastered\\\\"\)/g,
    replace: 'Path.Combine(inputFolder, REMASTERED_FILES_FOLDER_NAME, filename)',
    expect: 2
  },
  {
    file: 'OpenKH/helpers.cs',
    note: 'GetAllFiles: відрізали префікс через "\\"',
    find: '.Select(x => x.Replace($"{folder}\\\\", "")\n                            .Replace(@"\\", "/"));',
    replace: '.Select(x => Rel(x, folder));'
  },
  {
    file: 'OpenKH/helpers.cs',
    note: 'GetRelativePath і GetAllFiles зведено до спільного Rel() без роздільника ОС',
    find: '        public static string GetRelativePath(string filePath, string origin)\n' +
          '        {\n' +
          '            return filePath.Replace($"{origin}\\\\", "").Replace(@"\\", "/");\n' +
          '        }',
    replace: REL_HELPER
  }
];

// ---------------------------------------------------------------- дрібниці

const args = process.argv.slice(2);
function flag(name) { return args.includes('--' + name); }
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
function log(s) { process.stdout.write(s + '\n'); }

function run(cmd, argv, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let tail = '';
    const eat = (b) => {
      const t = b.toString();
      tail = (tail + t).slice(-4000);
      process.stdout.write(t.replace(/^/gm, '    '));
    };
    child.stdout.on('data', eat);
    child.stderr.on('data', eat);
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(cmd + ' → ' + code + '\n' + tail)));
  });
}

async function download(rel) {
  const dest = path.join(VENDOR, rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const url = 'https://raw.githubusercontent.com/' + REPO + '/' + TAG + '/' + rel.split(path.sep).join('/');
  const res = await fetch(url);
  if (!res.ok) throw new Error('не завантажилось (' + res.status + '): ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsP.mkdir(path.dirname(dest), { recursive: true });
  await fsP.writeFile(dest, buf);
  return dest;
}

async function copyDir(src, dst) {
  await fsP.mkdir(dst, { recursive: true });
  for (const e of await fsP.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(from, to);
    else await fsP.copyFile(from, to);
  }
}

// ---------------------------------------------------------------- кроки

async function fetchSources() {
  log('Вихідники KHPCPatchManager ' + TAG + ' → ' + path.relative(process.cwd(), VENDOR));
  let got = 0;
  for (const rel of SOURCES) {
    const before = fs.existsSync(path.join(VENDOR, rel));
    await download(rel);
    if (!before) got++;
  }
  const manifest = {};
  for (const rel of SOURCES) {
    manifest[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(VENDOR, rel))).digest('hex');
  }
  await fsP.writeFile(path.join(VENDOR, 'sha256.json'), JSON.stringify(manifest, null, 2) + '\n');
  log('  завантажено нових: ' + got + ', усього ' + SOURCES.length);
}

function applyPatch(text, p) {
  if (p.find != null) {
    const n = text.split(p.find).length - 1;
    if (n !== (p.expect || 1)) {
      throw new Error('правка «' + p.note + '» у ' + p.file + ': очікували ' + (p.expect || 1) +
        ' збіг(ів), знайшли ' + n + '. Вихідний код KHPCPatchManager змінився — правку треба переглянути.');
    }
    return text.split(p.find).join(p.replace);
  }
  const re = p.findRe;
  const found = text.match(re);
  const n = found ? (re.flags.includes('g') ? found.length : 1) : 0;
  if (n !== (p.expect || 1)) {
    throw new Error('правка «' + p.note + '» у ' + p.file + ': очікували ' + (p.expect || 1) +
      ' збіг(ів), знайшли ' + n + '. Вихідний код KHPCPatchManager змінився — правку треба переглянути.');
  }
  return text.replace(re, () => p.replace);
}

async function prepareSources() {
  log('Латаємо вихідники → ' + path.relative(process.cwd(), WORK));
  await fsP.rm(WORK, { recursive: true, force: true });
  const up = path.join(WORK, 'upstream');
  for (const rel of SOURCES) {
    const to = path.join(up, rel);
    await fsP.mkdir(path.dirname(to), { recursive: true });
    await fsP.copyFile(path.join(VENDOR, rel), to);
  }
  const byFile = new Map();
  for (const p of PATCHES) {
    if (!byFile.has(p.file)) byFile.set(p.file, fs.readFileSync(path.join(up, p.file), 'utf8'));
  }
  for (const p of PATCHES) {
    byFile.set(p.file, applyPatch(byFile.get(p.file), p));
    log('  ✓ ' + p.file + ' — ' + p.note);
  }
  for (const [file, text] of byFile) await fsP.writeFile(path.join(up, file), text, 'utf8');

  // наші файли
  await copyDir(path.join(ROOT, 'src'), WORK);
  await fsP.copyFile(path.join(up, 'kh.ico'), path.join(WORK, 'kh.ico'));
  await fsP.writeFile(path.join(WORK, 'NOTICE.txt'), NOTICE, 'utf8');
}

const NOTICE = [
  'KH-UA-Patcher',
  '',
  'Усередині — код KHPCPatchManager (https://github.com/' + REPO + ', ' + TAG + '),',
  'ліцензія Apache-2.0, автор AntonioDePau; сам він спирається на OpenKH',
  '(Xeeynamo та команда OpenKH, Noxalus).',
  '',
  'Наші зміни до того коду:',
  ...PATCHES.map((p) => '  * ' + p.file + ' — ' + p.note),
  '',
  'Решта (пошук гри, консольний встановлювач) — KINGDOM HEARTS LOCALIZATION TOOL,',
  'Dmytro Bidlov «Little Bit» Team, ліцензія MIT.',
  ''
].join('\n');

async function publish(rid) {
  const out = path.join(WORK, 'out', rid);
  log('dotnet publish ' + rid);
  await run('dotnet', [
    'publish', 'UaPatcher.csproj',
    '-c', 'Release',
    '-r', rid,
    '--self-contained', 'true',
    '-p:PublishSingleFile=true',
    '-p:EnableCompressionInSingleFile=true',
    '-p:DebugType=none',
    '-p:InvariantGlobalization=true',
    '-o', out
  ], WORK);
  return out;
}

async function assemble(rid, publishedDir, patchesDir) {
  const win = rid.startsWith('win');
  const name = 'KH-UA-Patcher-' + rid;
  const dest = path.join(DIST, name);
  await fsP.rm(dest, { recursive: true, force: true });
  await fsP.mkdir(dest, { recursive: true });

  const exe = win ? 'KH-UA-Patcher.exe' : 'KH-UA-Patcher';
  await fsP.copyFile(path.join(publishedDir, exe), path.join(dest, exe));
  if (!win) await fsP.chmod(path.join(dest, exe), 0o755);

  // resources/ розпаковуємо заздалегідь: EgsHdAsset читає їх із теки поруч
  // із програмою, а розпаковувати сама вона вміє лише в поточну теку.
  // усередині resources.zip записи вже лежать у теці resources/ — тому
  // розпаковуємо в корінь релізу, інакше вийде resources/resources/
  await unzipTo(path.join(VENDOR, 'resources.zip'), dest);
  const res = path.join(dest, 'resources');
  await fsP.mkdir(res, { recursive: true });
  await fsP.writeFile(path.join(res, 'custom_filenames.txt'), '', 'utf8');

  await fsP.copyFile(path.join(WORK, 'NOTICE.txt'), path.join(dest, 'NOTICE.txt'));
  await fsP.copyFile(path.join(VENDOR, 'LICENSE'), path.join(dest, 'LICENSE-KHPCPatchManager.txt'));

  // Назва пускача навмисне ASCII: cmd.exe шукає файл ANSI-кодуванням системи,
  // і на не-кириличній Windows кириличне ім'я .bat просто не знаходиться.
  const launcher = win ? 'INSTALL.bat' : 'install.sh';
  await fsP.copyFile(path.join(ROOT, 'launchers', launcher), path.join(dest, launcher));
  if (!win) await fsP.chmod(path.join(dest, launcher), 0o755);

  const patches = path.join(dest, 'patches');
  await fsP.mkdir(patches, { recursive: true });
  let n = 0;
  if (patchesDir) {
    for (const f of await fsP.readdir(patchesDir)) {
      if (!/\.(kh1|kh2|com|bbs|ddd)pcpatch$/i.test(f)) continue;
      await fsP.copyFile(path.join(patchesDir, f), path.join(patches, f));
      n++;
    }
  }
  if (!n) await fsP.writeFile(path.join(patches, 'ПОКЛАДІТЬ-ПАТЧ-СЮДИ.txt'),
    'Сюди кладуть файл патчу: .kh1pcpatch, .compcpatch, .bbspcpatch або .dddpcpatch.\n', 'utf8');

  // Дві різні речі: ЧИТАТИ.txt — коротка пам'ятка, що відкриється подвійним
  // кліком у будь-якій системі; README.md — сторінка для GitHub Releases.
  await fsP.writeFile(path.join(dest, 'ЧИТАТИ.txt'), readme(win), 'utf8');
  await fsP.copyFile(path.join(ROOT, 'release-readme.md'), path.join(dest, 'README.md'));
  return { dest, name, patches: n };
}

function readme(win) {
  const runLine = win
    ? 'Запустіть «INSTALL.bat» — подвійний клік.'
    : 'Відкрийте теку в терміналі й виконайте:  ./install.sh\n(на Steam Deck: Konsole → перетягніть install.sh у вікно й натисніть Enter)';
  return [
    'УКРАЇНІЗАТОР KINGDOM HEARTS',
    '',
    runLine,
    '',
    'Програма сама знайде гру (Steam, Epic, Steam Deck, SD-картка), сама зробить',
    'резервні копії й сама застосує патч. Гру перед цим треба закрити.',
    '',
    'Що всередині:',
    '  patches/     — файли патчу; можна покласти кілька для різних ігор',
    '  resources/   — списки імен файлів гри, без них патч не застосується',
    '  backup       — створюється в теці гри (Image/dt/backup); там оригінали',
    '',
    'Корисні ключі (з командного рядка):',
    '  --гра <тека>   вказати теку гри вручну, якщо автопошук не знайшов',
    '  --відкотити    повернути оригінальні файли з резервної копії',
    '  --без-копії    не лишати резервну копію (місце на диску)',
    '  --так          нічого не питати',
    '  --список       лише показати, які збірки знайдено',
    '  --cli ...      режим самого KHPCPatchManager (розпакувати .hed тощо)',
    '',
    'Перше застосування довге: .pkg важать кілька ГБ.',
    'Журнал роботи лишається у файлі patch-log.txt поруч із програмою.',
    ''
  ].join('\n');
}

// Розпакування .zip без сторонніх залежностей (у resources.zip лише .txt,
// збережені Deflate або без стиснення).
async function unzipTo(zipPath, dest) {
  const zlib = require('zlib');
  const buf = await fsP.readFile(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('не схоже на zip: ' + zipPath);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('пошкоджений каталог zip');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lnLen = buf.readUInt16LE(local + 26);
    const leLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnLen + leLen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : zlib.inflateRawSync(raw);
    const to = path.join(dest, name);
    await fsP.mkdir(path.dirname(to), { recursive: true });
    await fsP.writeFile(to, data);
  }
}

async function archive(dir, name, win) {
  const out = path.join(DIST, name + (win ? '.zip' : '.tar.gz'));
  await fsP.rm(out, { force: true });
  if (win) {
    // Compress-Archive — є в кожній Windows; для Linux потрібен tar, бо .zip
    // не зберігає біт «виконуваний».
    await run('powershell', ['-NoProfile', '-Command',
      "Compress-Archive -Path '" + dir + "' -DestinationPath '" + out + "' -Force"]);
  } else {
    // tar запускаємо В теці dist із відносними іменами: шлях виду E:\… GNU tar
    // приймає за адресу віддаленої машини й намагається туди під'єднатись.
    // --mode: під Windows біт «виконуваний» файлам не поставити, а в архіві
    // він потрібен, інакше на Linux програма не запуститься без chmod.
    try { await run('tar', ['-czf', name + '.tar.gz', '--mode=755', '--owner=0', '--group=0', name], DIST); }
    catch (_) { await run('tar', ['-czf', name + '.tar.gz', name], DIST); }
  }
  return out;
}

// ---------------------------------------------------------------- головне

(async () => {
  if (flag('clean')) await fsP.rm(path.join(ROOT, '.vendor'), { recursive: true, force: true });
  const rids = (opt('rid', '') ? opt('rid', '').split(',') : RIDS).map((s) => s.trim()).filter(Boolean);
  const patchesDir = opt('patches', '') ? path.resolve(opt('patches', '')) : null;
  if (patchesDir && !fs.existsSync(patchesDir)) throw new Error('немає теки з патчами: ' + patchesDir);

  await fsP.mkdir(VENDOR, { recursive: true });
  await fetchSources();
  await prepareSources();
  await fsP.mkdir(DIST, { recursive: true });
  // Той самий текст поруч з архівами — його й вставляють у GitHub Releases.
  await fsP.copyFile(path.join(ROOT, 'release-readme.md'), path.join(DIST, 'README.md'));

  const made = [];
  for (const rid of rids) {
    const published = await publish(rid);
    const { dest, name, patches } = await assemble(rid, published, patchesDir);
    const arc = await archive(dest, name, rid.startsWith('win'));
    const size = (await fsP.stat(arc)).size;
    made.push({ name, arc, size, patches });
  }

  log('');
  log('Готово:');
  for (const m of made) {
    log('  ' + path.relative(process.cwd(), m.arc) + '  ' + (m.size / 1048576).toFixed(1) + ' МБ' +
      (m.patches ? '  (патчів усередині: ' + m.patches + ')' : '  (патчі не вкладено)'));
  }
})().catch((e) => {
  process.stderr.write('\nПомилка: ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exit(1);
});
