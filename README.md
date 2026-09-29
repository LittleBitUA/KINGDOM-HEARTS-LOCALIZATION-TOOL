<div align="center">

# KINGDOM HEARTS LOCALIZATION TOOL

**Translate the Kingdom Hearts games — text, fonts and textures — in one desktop app.**

[![Release](https://img.shields.io/github/v/release/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL?style=for-the-badge&color=ffd700&labelColor=0f1730)](https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL/total?style=for-the-badge&color=6ea8ff&labelColor=0f1730)](https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL/releases)
[![License](https://img.shields.io/badge/license-MIT-brightgreen?style=for-the-badge&labelColor=0f1730)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-x64-0f1730?style=for-the-badge&labelColor=0f1730)](#download)

[English](#english) · [Українська](#українська) · [**Download**](https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL/releases/latest)

*May your heart be your guiding key.*

</div>

---

## English

A desktop toolkit for translating the **Kingdom Hearts** PC releases into any language. It reads the game's own text containers, shows the strings in a normal editor, and writes them back byte-exactly — respecting the buffer limits, control bytes and layout data the games are full of.

It is not a generic hex editor. Every format below was reverse-engineered specifically, so the tool knows what it is allowed to move and what must stay where it is.

### Supported games

| Game | Platform | Text formats | Status |
|---|---|---|---|
| Kingdom Hearts Final Mix | PC (Steam / Epic) | `.binl` (EvMsg + Message v361), raw `.bin`, `.ev` / `.evdl`, `*_mes_ofs` pairs, `.kmb` | ✅ ready |
| Kingdom Hearts Re:Chain of Memories | PC (Steam / Epic) | `.ctdl` | ✅ ready |
| Kingdom Hearts: Birth by Sleep Final Mix | PC (Steam / Epic) | `.ctd`, `.arc` layouts (`.l2d`) | ✅ ready |
| Kingdom Hearts 3D: Dream Drop Distance HD | PC (KH HD 2.8) | `.ctd` v0x1F7 (UTF‑16LE) | ✅ ready |
| Kingdom Hearts 358/2 Days (HD cutscenes) | PC (KH HD 1.5+2.5) | `.ctd` v0x1F7 | ✅ ready |
| Kingdom Hearts Re:coded (HD cutscenes) | PC (KH HD 1.5+2.5) | `.ctd` v0x1F7 | ✅ ready |
| Kingdom Hearts Theater (KH1 cutscenes) | PC (KH HD 1.5+2.5) | `.ctd` v0x1F7 | ✅ ready |
| Kingdom Hearts 0.2 Birth by Sleep | PC (KH HD 2.8) · Unreal Engine 4 | archives readable, text lives in textures | 🚧 planned |
| Kingdom Hearts χ Back Cover | PC (KH HD 2.8) | movie — subtitles only | 🚧 planned |

### What is inside

| Module | What it does |
|---|---|
| **Translate** | Extract → edit → compose. A glossary keyed by the English string, so the same line translated once is reused everywhere it appears. Token validation, structural guards, per-file progress. |
| **Kerning** | Per-glyph advance widths for the KH1 dialogue font. |
| **CoM kerning** | The same for Re:Chain of Memories, including its bubble layout records. |
| **Bubbles** | Re:CoM text windows: position, size, alignment and type of every dialogue box. |
| **Textures** | Import/export of in-game textures (DDS/PNG), with the game-specific atlas rules. |
| **BBS font** | Glyph atlas and metrics editor for Birth by Sleep. |
| **UA fonts** | Generates a full Cyrillic set into a game's font, drawing into free cells so the Latin alphabet stays byte-identical. |

### Download

Grab the latest `.exe` from **[Releases](https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL/releases/latest)**. Windows x64, portable — no installer needed. The app checks for updates on its own and can download a new version in place.

### Quick start

1. **Unpack the game.** Use [KHPCPatchManager](https://github.com/Noxalus/KHPCPatchManager) on the `.pkg` archives; you get a `*.hed_out` folder.
2. **Point the app at the folders.** `ENG` — the unpacked game; `PROGRESS` — where the glossary lives; `DONE` — where finished files are written. An optional reference folder can hold another language's files: lines identical to the source are then treated as untranslatable.
3. **Translate.** Pick a file, edit rows, save. The glossary fills in repeats automatically.
4. **Compose all files** and copy `DONE` over your patch folder.
5. **Repack** with KHPCPatchManager and apply the patch.

### Shipping your translation to players

`tools/patcher/` builds a **standalone console installer** you hand out together
with your `.pcpatch`. It finds the game on its own (Steam, Epic, Steam Deck, SD
cards), backs up the original archives and applies the patch — with no .NET, mono
or KHPCPatchManager needed on the player's machine.

```bash
npm run patcher:build                                      # Windows + Linux
node tools/patcher/build.js --patches path/to/PATCH/KH1-UA # bundle the patch
```

It rebuilds KHPCPatchManager from source for both platforms — the upstream release
is Windows-only, despite what its project file claims. The rebuild is verified to
produce byte-identical archives. See [tools/patcher/README.md](tools/patcher/README.md).

### Build from source

```bash
git clone https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL.git
cd KINGDOM-HEARTS-LOCALIZATION-TOOL
npm install
npm start            # run
npm run check        # lint + tests + headless smoke test
npm run build        # portable .exe into dist/
```

Node 20+ and Windows are expected. Python 3.10+ with `pillow`, `numpy`, `fonttools` and `scipy` is only needed for the font generators.

### Contributing

Issues and pull requests are welcome, especially:

- new games or containers of the series;
- corrections to the format documentation;
- translations of the interface (it already ships Ukrainian and English).

### Credits

Built by **Dmytro Bidlov** — *«Little Bit» Team*.

Thanks to the [OpenKh](https://github.com/Xeeynamo/OpenKh) project and to [KHPCPatchManager](https://github.com/Noxalus/KHPCPatchManager), without which unpacking the PC releases would be far harder.

Released under the [MIT licence](LICENSE). Kingdom Hearts is a trademark of Square Enix and Disney; this is an unofficial fan tool, not affiliated with either.

---

## Українська

Настільний інструмент для перекладу ПК-версій **Kingdom Hearts** будь-якою мовою. Він читає власні текстові контейнери гри, показує рядки у звичайному редакторі й записує їх назад побайтово — з повагою до буферів, керуючих байтів і розкладок, яких у цих іграх дуже багато.

Це не універсальний hex-редактор. Кожен формат нижче розібрано окремо, тому програма знає, що можна рухати, а що мусить лишитися на місці.

### Які ігри підтримано

| Гра | Платформа | Формати тексту | Стан |
|---|---|---|---|
| Kingdom Hearts Final Mix | PC (Steam / Epic) | `.binl` (EvMsg і Message v361), сирі `.bin`, `.ev` / `.evdl`, пари `*_mes_ofs`, `.kmb` | ✅ готово |
| Kingdom Hearts Re:Chain of Memories | PC (Steam / Epic) | `.ctdl` | ✅ готово |
| Kingdom Hearts: Birth by Sleep Final Mix | PC (Steam / Epic) | `.ctd`, розкладки `.l2d` в `.arc` | ✅ готово |
| Kingdom Hearts 3D: Dream Drop Distance HD | PC (KH HD 2.8) | `.ctd` v0x1F7 (UTF‑16LE) | ✅ готово |
| Kingdom Hearts 358/2 Days (ролики HD) | PC (KH HD 1.5+2.5) | `.ctd` v0x1F7 | ✅ готово |
| Kingdom Hearts Re:coded (ролики HD) | PC (KH HD 1.5+2.5) | `.ctd` v0x1F7 | ✅ готово |
| Kingdom Hearts Theater (ролики KH1) | PC (KH HD 1.5+2.5) | `.ctd` v0x1F7 | ✅ готово |
| Kingdom Hearts 0.2 Birth by Sleep | PC (KH HD 2.8) · Unreal Engine 4 | архіви читаються, текст лежить у текстурах | 🚧 у планах |
| Kingdom Hearts χ Back Cover | PC (KH HD 2.8) | фільм — лише субтитри | 🚧 у планах |

### Що всередині

| Розділ | Для чого |
|---|---|
| **Переклад** | Витяг → редагування → збирання. Глосарій за англійським рядком: перекладене один раз підставляється скрізь, де трапляється. Перевірка токенів, структурні запобіжники, поступ по кожному файлу. |
| **Кернінг** | Ширини символів шрифту діалогів KH1. |
| **Кернінг CoM** | Те саме для Re:Chain of Memories разом із записами розкладки хмаринок. |
| **Хмаринки** | Текстові вікна Re:CoM: положення, розмір, вирівнювання й тип кожного. |
| **Текстури** | Імпорт і експорт ігрових текстур (DDS/PNG) за правилами атласів кожної гри. |
| **Шрифт BBS** | Редактор атласа й метрик для Birth by Sleep. |
| **Шрифти UA** | Малює повну кирилицю у шрифт гри — у вільні комірки, щоб латиниця лишилася побайтово тією самою. |

### Завантажити

Останній `.exe` — у **[Releases](https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL/releases/latest)**. Windows x64, портативний, встановлювати не треба. Програма сама перевіряє оновлення й може завантажити нову версію на місці.

### З чого почати

1. **Розпакуй гру** через [KHPCPatchManager](https://github.com/Noxalus/KHPCPatchManager) — отримаєш теку `*.hed_out`.
2. **Вкажи теки:** `ENG` — розпакована гра, `PROGRESS` — де лежить глосарій, `DONE` — куди складати готове. Додатково можна дати теку еталона з файлами іншої мови: рядки, ідентичні до джерела, вважатимуться неперекладними.
3. **Перекладай.** Вибери файл, редагуй рядки, зберігай. Повтори глосарій підставить сам.
4. **«Зібрати всі файли»** і скопіюй `DONE` поверх теки патча.
5. **Запакуй** назад через KHPCPatchManager і накоти патч.

### Як віддати переклад гравцям

`tools/patcher/` збирає **окремий консольний встановлювач**, який поширюють разом
із `.pcpatch`. Він сам знаходить гру (Steam, Epic, Steam Deck, SD-картка), сам
робить резервну копію й сам накочує патч — на машині гравця не потрібно ані .NET,
ані mono, ані KHPCPatchManager.

```bash
npm run patcher:build                                      # Windows + Linux
node tools/patcher/build.js --patches шлях/до/PATCH/KH1-UA # вкласти патч усередину
```

KHPCPatchManager для цього перезбирається з вихідників під обидві платформи —
їхній реліз працює лише під Windows, хоч у `.csproj` написано інше. Перевірено,
що перезбирання архівів дає байт у байт той самий результат. Подробиці —
[tools/patcher/README.md](tools/patcher/README.md).

### Збірка з коду

```bash
git clone https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL.git
cd KINGDOM-HEARTS-LOCALIZATION-TOOL
npm install
npm start            # запуск
npm run check        # лінт + тести + headless smoke
npm run build        # портативний .exe у dist/
```

Потрібні Node 20+ і Windows. Python 3.10+ з `pillow`, `numpy`, `fonttools` і `scipy` — лише для генераторів шрифтів.

### Долучитися

Issues і pull request'и вітаються — особливо:

- нові ігри чи контейнери серії;
- виправлення в документації форматів;
- переклади інтерфейсу (зараз є українська й англійська).

### Автор

**Dmytro Bidlov** — *«Little Bit» Team*.

Дякую проєкту [OpenKh](https://github.com/Xeeynamo/OpenKh) і [KHPCPatchManager](https://github.com/Noxalus/KHPCPatchManager) — без них розпакувати ПК-версії було б значно важче.

Ліцензія [MIT](LICENSE). Kingdom Hearts — торгова марка Square Enix і Disney; це неофіційний фанатський інструмент, не пов'язаний із ними.
