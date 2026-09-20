<div align="center">

# 👑 KH1 Localization Tool

[![Latest](https://img.shields.io/github/v/release/LittleBitUA/KH1-Localization-tool?style=for-the-badge&color=ffd700&labelColor=0f1730)](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-38bdf8?style=for-the-badge&labelColor=0f1730)](LICENSE)
[![Electron](https://img.shields.io/badge/electron-44.x-47848f?style=for-the-badge&labelColor=0f1730)](https://electronjs.org)

**Інструмент для локалізації Kingdom Hearts — KH1 (BIN/BINL/ARD/EV/mes_ofs), Birth by Sleep (CTD), Re:Chain of Memories (CTDL), Dream Drop Distance (CTD UTF-16) + генерація українських шрифтів.**
*A localization toolkit for Kingdom Hearts — KH1 (BIN/BINL/ARD/EV/mes_ofs), Birth by Sleep (CTD), Re:Chain of Memories (CTDL), Dream Drop Distance (UTF-16 CTD) + Ukrainian font generation.*

[🇺🇦 Українська](#-українська) · [🇬🇧 English](#-english) · [📥 Download](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest)

</div>

---

## 🇺🇦 Українська

### Що це

Редактор для перекладу тексту ігор **Kingdom Hearts 1 — Final Mix HD**, **Kingdom Hearts: Birth by Sleep — Final Mix HD** та **Kingdom Hearts Re:Chain of Memories** (PC). Збірки — для Windows; setup-майстер (OpenKH, KHPCPatchManager, Expand-Archive) — Windows-only, сам редактор працює на будь-якій ОС з Electron. Підтримує основні текстові формати обох ігор, має словник із автоматичним підхопленням повторень, валідатор токенів, візуальний редактор кернінгу (KH1) та редактор шрифту (BBS), збірку patch-файлу.

### ✨ Можливості

| Категорія | Що працює |
|---|---|
| **Ігри** | KH1 Final Mix HD · Birth by Sleep Final Mix HD · Re:Chain of Memories · **Dream Drop Distance HD** (per-game ізольовані налаштування і теки) |
| **Кодек KH1** | Двобайтові команди (`{0x05/06/07,0xXX}`), нативна кирилиця кодами `19 NN` (латиниця недоторкана), lossless round-trip |
| **Формати KH1** | `.bin` (raw text), `.binl` (з EvMsg-заголовком), `.binl` **«Message v361»** (`sysmsg` — 488 системних повідомлень), `.ard` (KGR контейнер), `_mes_ofs.bin`+`_mes_data.bin` (gummi/exchange меню), `.ev`/`.evdl` (event-скрипти) |
| **Формати Re:CoM** | `.ctdl` (порт `comtext.py`/`comctd.py`, звірено на всіх 30 503 повідомленнях; `{color xx}` `{icon xx}`, **кирилиця на кодах хіраґани `0x829F–0x82E0`**; round-trip 426/426) |
| **Формати DDD** | `.ctd` v0x1F7 UTF-16LE (порт `khctd.py`; `{PLAYER}` `{BTN_A}` `{U+XXXX}`, сторінкова адресація до 1 МіБ; round-trip 37/37) |
| **Шрифти UA** | Вкладка «Шрифти UA» для KH1 / BBS / Re:CoM / DDD (KH1: нативна кирилиця у вільних комірках 224+ шрифту діалогів, коди `19 NN`, `tools/py/kh1/kh1font.py`): растеризує 66 українських літер (ComicHearts для діалогів, KHMenu для інтерфейсу) у вільні комірки ігрових шрифтів еталонними Python-інструментами (`tools/py`), «Встановити у гру» з бекапом оригіналів |
| **text_all.txt** | Експорт/імпорт формату обміну Python-наборів (`### шлях` / `#N` / текст) — переклад лягає у per-file прогрес і глосарій; пара `text_uniq.txt`+`text_ua.txt` (Re:CoM) → глосарій |
| **Кодек BBS** | Порт еталонного `bbstext.py`: повні таблиці `0x81`/`0x99`, вставки `{icon triangle}` `{color white}` `{sjis xxxx}`, **кирилиця на кодах катакани `0x83xx`** (узгоджено зі згенерованим шрифтом), перевірка наявності гліфа у `FontEn.arc`; byte-identical round-trip 116/116 файлів гри |
| **Формати BBS** | `.ctd` (event/menu/HUD), HD-PNG атлас фонтів, `mesfont/menufont/cmdfont/helpfont/numeral` шрифти |
| **Редактор шрифту BBS** | Atlas viewer (HD PNG 1024×512), COD overlay з квадратними клітинами, правка X/Y/palette/width гліфів, експорт overlay-PNG як guide-шар, зум (−/+/Fit, Ctrl+wheel), збереження `.cod` |
| **Глосарій** | 📊 Dashboard з прогрес-баром, фільтри, сортування, 🩹 авто-фікс структури, 🔄 bulk Find/Replace (regex/whole-word), ↶ Undo масових операцій, 5 ротаційних бекапів `_glossary.json` |
| **Імпорт** | HTML / CSV / TSV / TXT — з token-guard'ом проти втрати керівних байтів. HTML-імпорт сумісний з output OpenKh CTD Editor (`{:unk XX}`) |
| **Auto-wrap** | Адаптивне розставляння `{lf}` за EN-структурою з кернінг-метриками з `.knj` |
| **Кернінг (KH1)** | Візуальний редактор `.knj` з DDS-атласом (drag для зміни ширини, auto-fit за α-каналом) |
| **Auto-layout** | Авто-створення тек на запуск (KH1: `MYFILES/PROGRESS/DONE`; BBS: `ENG/PROGRESS/DONE`) |
| **Auto-update** | Через GitHub Releases (electron-updater) |
| **i18n** | UI українською + англійською (`/Налаштування → Мова`) |

### 📚 Підтримка форматів

#### `.binl` (структуровані діалоги)
Сигнатура `EvMsg`, header 11 байт + footer 5 байт. Усередині — sequence of null-terminated strings з offset-based індексацією. Керівні команди `05/06/07` мають **u16-параметр** — коли старший байт ≠ 0, він входить у токен (`{0x06,0x2C,0x01}` = 300), щоб не показуватись як «пробіл» і не губитись при перекладі; старі ключі глосарія з 2-байтовою формою переносяться автоматично. При збірці діє структурний guard: переклад, що губить токени EN або додає `05/06/0A/0B`, лишає оригінал і потрапляє у звіт помилок.

#### `.binl` «Message v361» (системні повідомлення)
`remastered/menu/<lang>/sysmsg.bin/XX_sysmsg.binl`: header `0x20` (count, offsetTable @`0x10`, textOffset @`0x14`, довжини), таблиця `u16`-зсувів (count або count+1 із sentinel), текст із `00`-термінаторами, `02` = перенос, padding `0xCD` до кратного 16. Власний діалект команд (`0D/0E/13/14` = i16, `08` = RGB, `0B` = 3 параметри) — декодується сирими токенами. Звірено з OpenKh PR #1275.

#### `.bin` (raw text)
Без сигнатури, plain KH1-encoded byte stream. Розпізнається евристично за відсотком printable байтів.

#### `.ard` (карти/контейнери)
Сигнатура `KGR\0`. Підтримка читання та модифікації internal text region.

#### `_mes_ofs.bin` + `_mes_data.bin` (парний формат)
Меню/UI listings (gummi blocks, item names тощо).
- `.ofs`: масив `int16 LE` pointers у `.data`
- `.data`: концатеновані null-terminated strings, KH1 codec
- Cell-preserving compose: кожен рядок займає той самий cell-size, що дозволяє точну byte-identical перебудову.

#### `.ev` / `.evdl` (event scripts, KH1)
Парсер/композер ([tools/lib/ev-format.js](tools/lib/ev-format.js)) увімкнений: text-блок перебудовується compact-режимом з релокацією header-pointer'ів у footer (підтверджено byte-by-byte порівнянням ENG/RUS файлів). Є cell-preserving режим (`opts.cellPreserving`), що гарантує незмінний розмір файлу.

#### `.ctd` (Birth by Sleep — event/menu/HUD)
Власна clean-room реалізація ([tools/lib/ctd-codec.js](tools/lib/ctd-codec.js), [tools/lib/ctd-format.js](tools/lib/ctd-format.js)). Структура:
- 32-byte header: `count`, `messageTableOff`, `layoutTableOff`, `textBlockOff`, `textBlockSize`
- N × 12-byte message entries (id + offset у text-block + len)
- N × 32-byte layout entries (X/Y/font/scale/color)
- Text-block: послідовність KH-encoded байт-стрічок з padding `0xCD`
- Підтримка prefix-байтів `0x81`/`0x99` (CJK punctuation, latin extended) і кнопкових пар `F1/F2/F5/F9 + XX` (геймпадні гліфи).
- **Byte-identical round-trip**: оригінальні `.ctd` файли парсяться, перетворюються в TSV, повертаються назад у `.ctd` без жодного відхилення (152/152).

#### `.ctd` (Dream Drop Distance HD — KH 2.8)
`@CTD` версії `0x1F7`, UTF-16LE. Entry 8 байт: `messageId`, `textOffsetLow`, `(layoutIndex<<4)|page` → адреса = low + page·0x10000. Шрифти `.bcfnt` (Nintendo 3DS BCFNT: CFNT/FINF/TGLP/CWDH/CMAP, A4-текстура зі swizzle) доповнюються кирилицею у вільні комірки, коди — нативний Unicode. Детально — [docs/formats/](docs/formats/).

#### Шрифти BBS (`mesfont`/`menufont`/`cmdfont`/`helpfont`/`numeral`)
Парсер ([tools/lib/bbs-font.js](tools/lib/bbs-font.js)) розпізнає bundle з `.inf` (метадані: count, texture WxH, cell WxH) + `.cod` (8 байт/гліф: charID, posX, posY, palette, width) + `.mtx` (4-bit indexed swizzled SD атлас) + `.clu` (1024-byte RGBA палітра). Опційно — HD-PNG remastered атлас (1024×512 для mesfont, складається з двох 512×512 блоків side-by-side по `palette`).

### 🚀 Як користуватися

1. **Завантаж** останній `.exe` з [Releases](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest).
2. **Налаштуй теки** (через ⚙ Налаштування):
   - **Eng dir** — папка з оригінальним англійським текстом гри
   - **Out dir** — куди писати перекладений вихід
   - **TSV dir** — папка для прогресу/глосарію
3. **Глосарій** → 🔨 **Побудувати/Оновити** — сканує всі файли в Eng dir.
4. Перекладай. Натисни 📐 **Auto-wrap (за EN)** для розставляння `{lf}`.
5. **⚡ Зібрати ВСІ файли** → готовий patch у Out dir.

### ⌨ Гарячі клавіші

- `Ctrl+S` — зберегти
- `Ctrl+F` — пошук
- `Ctrl+E` / `Ctrl+I` — експорт / імпорт TXT (Глосарій)
- `Ctrl+H` — Find/Replace
- `Ctrl+→` / `Ctrl+←` — наступний / попередній файл
- `Esc` — закрити модалі

### 🛠 Збірка з джерел

```bash
git clone https://github.com/LittleBitUA/KH1-Localization-tool.git
cd KH1-Localization-tool
npm install
npm start               # dev-режим
npm test                # unit-тести (node:test, синтетичні фікстури — файли гри не потрібні)
npm run lint            # ESLint
npm run test:smoke      # headless e2e: справжній Electron + IPC на синтетичних файлах
npm run check           # lint + test + smoke
npm run build           # портабельний .exe
npm run build:installer # NSIS installer
```

Шрифти UA потребують **Python 3** з `pillow numpy fonttools scipy` (вкладка «Шрифти UA» сама перевірить і запропонує встановити через pip). Еталонні Python-інструменти й розбори форматів: [tools/py/](tools/py/), [docs/formats/](docs/formats/).

Корисне для розробки:
- `KH_DEBUG=1 npm start` — дзеркалить console renderer'а у термінал і відкриває DevTools.
- Якщо запускаєш з терміналу VS Code і бачиш `ipcMain undefined` — зніми змінну `ELECTRON_RUN_AS_NODE` (VS Code передає її дочірнім процесам).
- CI (GitHub Actions) ганяє lint + тести на кожен push; тег `vX.Y.Z` збирає portable + NSIS і публікує реліз.

Структура коду:
- `main.js` + `main/*.js` — main-процес (вікно, settings, IPC за доменами, worker-pool, setup).
- `renderer/` — ESM-модулі UI (`main.js` — вхід; `core/`, `screens/`, `translate/`, `kerning/`, `bbsfont/`).
- `shared/` — чисті модулі, спільні для main і renderer (codec KH1, TSV-формат, структура токенів, атомарний запис).
- `tools/lib/formats/` — один handler на формат (`parse`/`compose`); `tools/lib/translate-ops.js` — generic extract/compose/glossary/composeAll/text_all поверх реєстру.
- `tools/lib/{bbs-codec,recom-ctdl-codec,ddd-ctd}.js` — порти еталонних Python-кодеків; `data/{bbs,recom,ddd}/` — таблиці, витягнуті з тих самих .py; `test/fixtures/` — вектори, згенеровані Python-кодом (`test/codecs-reference.test.js` звіряє байт-у-байт).
- `tools/py/` — самі Python-інструменти (шрифти + CLI для тексту), `assets/fonts/` — ComicHearts/KHMenu OTF.
- `test/` — тести; `test/helpers/synth.js` будує синтетичні .binl/.ev/mes_ofs/.ctd/.ctdl/Message v361; `test/msg-v361.test.js` додатково ганяє справжній `UK_sysmsg.binl`, якщо гра розпакована.

---

## 🇬🇧 English

### What is this

Editor for translating **Kingdom Hearts 1 — Final Mix HD**, **Kingdom Hearts: Birth by Sleep — Final Mix HD** and **Kingdom Hearts Re:Chain of Memories** (PC) text. Builds target Windows; the setup wizard (OpenKH, KHPCPatchManager, Expand-Archive) is Windows-only, the editor itself runs anywhere Electron does. Supports the main text formats of both games, has a glossary with auto-deduplication, token validator, visual kerning editor (KH1) and font editor (BBS), and patch builder.

### ✨ Features

| Category | What works |
|---|---|
| **Games** | KH1 Final Mix HD · Birth by Sleep Final Mix HD · Re:Chain of Memories · **Dream Drop Distance HD** (per-game isolated settings and folders) |
| **KH1 codec** | Two-byte commands (`{0x05/06/07,0xXX}`), native Cyrillic via `19 NN` codes (Latin untouched), lossless round-trip |
| **KH1 formats** | `.bin` (raw text), `.binl` (with EvMsg header), `.binl` **“Message v361”** (`sysmsg` — 488 system messages), `.ard` (KGR container), `_mes_ofs.bin`+`_mes_data.bin` (gummi/exchange menus), `.ev`/`.evdl` (event scripts) |
| **Re:CoM formats** | `.ctdl` (port of `comtext.py`/`comctd.py`, verified on all 30 503 messages; `{color xx}` `{icon xx}`, **Ukrainian on hiragana codes `0x829F–0x82E0`**; round-trip 426/426) |
| **DDD formats** | `.ctd` v0x1F7 UTF-16LE (port of `khctd.py`; `{PLAYER}` `{BTN_A}` `{U+XXXX}`, paged addressing up to 1 MiB; round-trip 37/37) |
| **UA fonts** | "UA fonts" tab for KH1 / BBS / Re:CoM / DDD (KH1: native Cyrillic in the free dialog-font cells 224+, `19 NN` codes, `tools/py/kh1/kh1font.py`): rasterizes the 66 Ukrainian letters (ComicHearts for dialogue, KHMenu for UI) into free cells of the game fonts using the reference Python tools (`tools/py`); "Install into game" with backups |
| **text_all.txt** | Export/import of the Python toolkits' interchange format (`### path` / `#N` / text) — translations land in per-file progress and the glossary; a `text_uniq.txt`+`text_ua.txt` pair (Re:CoM) → glossary |
| **BBS codec** | Port of the reference `bbstext.py`: full `0x81`/`0x99` tables, `{icon triangle}` `{color white}` `{sjis xxxx}` tags, **Ukrainian on katakana codes `0x83xx`** (in sync with the generated font), FontEn.arc glyph check; byte-identical round-trip on 116/116 game files |
| **BBS formats** | `.ctd` (event/menu/HUD), HD-PNG font atlases, `mesfont/menufont/cmdfont/helpfont/numeral` fonts |
| **BBS font editor** | Atlas viewer (HD PNG 1024×512), COD overlay with square cells, edit X/Y/palette/width per glyph, export overlay PNG as guide layer, zoom (−/+/Fit, Ctrl+wheel), save `.cod` |
| **Glossary** | 📊 Dashboard with progress bar, filters, sorting, 🩹 auto-fix structure, 🔄 bulk Find/Replace (regex/whole-word), ↶ Undo for bulk operations, 5 rotating `_glossary.json` backups |
| **Import** | HTML / CSV / TSV / TXT — with token-guard against losing control bytes. HTML import compatible with OpenKh CTD Editor output (`{:unk XX}`) |
| **Auto-wrap** | Adaptive `{lf}` placement by EN structure using kerning metrics from `.knj` |
| **Kerning (KH1)** | Visual `.knj` editor with DDS atlas (drag-to-resize widths, auto-fit by α-channel) |
| **Auto-layout** | Auto-creates folder layout on launch (KH1: `MYFILES/PROGRESS/DONE`; BBS: `ENG/PROGRESS/DONE`) |
| **Auto-update** | Via GitHub Releases (electron-updater) |
| **i18n** | UK + EN UI (`Settings → Language`) |

### 📚 Format support

#### `.binl` (structured dialogs)
`EvMsg` signature, 11-byte header + 5-byte footer. Contains a sequence of null-terminated strings with offset-based indexing. Commands `05/06/07` carry a **u16 parameter** — a non-zero high byte joins the token (`{0x06,0x2C,0x01}` = 300) instead of showing up as a “space” that a translator could drop; glossary keys in the old 2-byte form migrate automatically. Compose runs a structural guard: a translation that loses EN tokens or adds `05/06/0A/0B` keeps the original and is reported.

#### `.binl` “Message v361” (system messages)
`remastered/menu/<lang>/sysmsg.bin/XX_sysmsg.binl`: `0x20` header (count, offsetTable @`0x10`, textOffset @`0x14`, lengths), `u16` offset table (count or count+1 with sentinel), `00`-terminated text, `02` = line break, `0xCD` padding to 16. Own command dialect (`0D/0E/13/14` = i16, `08` = RGB, `0B` = 3 params) decoded as raw tokens. Verified against OpenKh PR #1275.

#### `.bin` (raw text)
No signature, plain KH1-encoded byte stream. Detected heuristically by printable-byte ratio.

#### `.ard` (maps / containers)
`KGR\0` signature. Read & modify internal text region.

#### `_mes_ofs.bin` + `_mes_data.bin` (paired format)
Menu / UI listings (gummi blocks, item names, etc.).
- `.ofs`: array of `int16 LE` pointers into `.data`
- `.data`: concatenated null-terminated strings, KH1 codec
- Cell-preserving compose: each string occupies the same cell-size, enabling byte-identical rebuild.

#### `.ev` / `.evdl` (event scripts, KH1)
Parser/composer ([tools/lib/ev-format.js](tools/lib/ev-format.js)) is enabled: the text block is rebuilt in compact mode with relocation of footer pointers in the header (confirmed by byte-by-byte ENG/RUS comparison). A cell-preserving mode (`opts.cellPreserving`) keeps the file size unchanged.

#### `.ctd` (Birth by Sleep — event/menu/HUD)
Custom clean-room implementation ([tools/lib/ctd-codec.js](tools/lib/ctd-codec.js), [tools/lib/ctd-format.js](tools/lib/ctd-format.js)). Layout:
- 32-byte header: `count`, `messageTableOff`, `layoutTableOff`, `textBlockOff`, `textBlockSize`
- N × 12-byte message entries (id + offset into text-block + len)
- N × 32-byte layout entries (X/Y/font/scale/color)
- Text-block: sequence of KH-encoded byte strings padded with `0xCD`
- Supports prefix bytes `0x81`/`0x99` (CJK punctuation, latin-extended) and gamepad-button pairs `F1/F2/F5/F9 + XX`.
- **Byte-identical round-trip**: original `.ctd` files parse → TSV → back to `.ctd` with zero deviation (152/152).

#### BBS fonts (`mesfont`/`menufont`/`cmdfont`/`helpfont`/`numeral`)
Parser ([tools/lib/bbs-font.js](tools/lib/bbs-font.js)) reads a bundle of `.inf` (metadata: count, texture WxH, cell WxH) + `.cod` (8 bytes/glyph: charID, posX, posY, palette, width) + `.mtx` (4-bit indexed swizzled SD atlas) + `.clu` (1024-byte RGBA palette). Optional HD remastered PNG atlas (1024×512 for mesfont, two 512×512 blocks side-by-side keyed by `palette`).

### 🚀 Usage

1. **Download** the latest `.exe` from [Releases](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest).
2. **Configure folders** (via ⚙ Settings):
   - **Eng dir** — folder with original English game text
   - **Out dir** — where to write translated output
   - **TSV dir** — folder for progress / glossary
3. **Glossary** → 🔨 **Build / Refresh** — scans all files in Eng dir.
4. Translate. Press 📐 **Auto-wrap (by EN)** to place `{lf}`.
5. **⚡ Compose ALL files** → ready patch in Out dir.

### ⌨ Hotkeys

- `Ctrl+S` — save
- `Ctrl+F` — search
- `Ctrl+E` / `Ctrl+I` — TXT export / import (Glossary)
- `Ctrl+H` — Find/Replace
- `Ctrl+→` / `Ctrl+←` — next / previous file
- `Esc` — close modals

### 🛠 Build from source

```bash
git clone https://github.com/LittleBitUA/KH1-Localization-tool.git
cd KH1-Localization-tool
npm install
npm start               # dev mode
npm test                # unit tests (node:test, synthetic fixtures — no game files needed)
npm run lint            # ESLint
npm run test:smoke      # headless e2e: real Electron + IPC on synthetic files
npm run check           # lint + test + smoke
npm run build           # portable .exe
npm run build:installer # NSIS installer
```

UA fonts need **Python 3** with `pillow numpy fonttools scipy` (the "UA fonts" tab checks and offers a pip install). Reference Python tools and format write-ups: [tools/py/](tools/py/), [docs/formats/](docs/formats/).

Development notes:
- `KH_DEBUG=1 npm start` mirrors the renderer console to the terminal and opens DevTools.
- Running from the VS Code terminal and seeing `ipcMain undefined`? Unset `ELECTRON_RUN_AS_NODE` (VS Code passes it to child processes).
- CI (GitHub Actions) runs lint + tests on every push; a `vX.Y.Z` tag builds portable + NSIS and publishes the release.

Code layout: `main/` (main process by domain), `renderer/` (ESM UI modules), `shared/` (pure modules used by both), `tools/lib/formats/` (one handler per format) + `tools/lib/translate-ops.js`, `test/`.

---

## 🙏 Credits / Подяки

Спираємось на роботи спільноти KH-modding'у:
*Built upon the work of the KH-modding community:*

- **pro100luk** — original codec research, glyph mapping
- **GuidingHeart** — KH1 binary structure analysis
- **EMP-UA** — Ukrainian localization team
- **Giza** — translation contributions
- **gg3502** — [KH1-EVDL-ARD-EDITOR](https://github.com/gg3502/KH1-EVDL-ARD-EDITOR), syscall/opcode docs
- **gaithern** — format research

## 📜 License

MIT — see [LICENSE](LICENSE).

KH1, Kingdom Hearts, and related trademarks are property of Square Enix / Disney. This tool does not include any copyrighted assets.

---

<div align="center">

Made with 💙💛 for Ukrainian gamers

</div>
