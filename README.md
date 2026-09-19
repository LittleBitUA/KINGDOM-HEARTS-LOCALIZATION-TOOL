<div align="center">

# 👑 KH1 Localization Tool

[![Latest](https://img.shields.io/github/v/release/LittleBitUA/KH1-Localization-tool?style=for-the-badge&color=ffd700&labelColor=0f1730)](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-38bdf8?style=for-the-badge&labelColor=0f1730)](LICENSE)
[![Electron](https://img.shields.io/badge/electron-44.x-47848f?style=for-the-badge&labelColor=0f1730)](https://electronjs.org)

**Інструмент для локалізації Kingdom Hearts — KH1 (BIN/BINL/ARD) + Birth by Sleep (CTD + редактор шрифту).**
*A localization toolkit for Kingdom Hearts — KH1 (BIN/BINL/ARD) + Birth by Sleep (CTD + font editor).*

[🇺🇦 Українська](#-українська) · [🇬🇧 English](#-english) · [📥 Download](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest)

</div>

---

## 🇺🇦 Українська

### Що це

Кросплатформенний редактор для перекладу тексту ігор **Kingdom Hearts 1 — Final Mix HD** та **Kingdom Hearts: Birth by Sleep — Final Mix HD**. Підтримує основні текстові формати обох ігор, має словник із автоматичним підхопленням повторень, валідатор токенів, візуальний редактор кернінгу (KH1) та редактор шрифту (BBS), збірку patch-файлу.

### ✨ Можливості

| Категорія | Що працює |
|---|---|
| **Ігри** | KH1 Final Mix HD · Birth by Sleep Final Mix HD (per-game ізольовані налаштування і теки) |
| **Кодек KH1** | Двобайтові команди (`{0x05/06/07,0xXX}`), українська overlay-карта, lossless round-trip |
| **Формати KH1** | `.bin` (raw text), `.binl` (з EvMsg-заголовком), `.ard` (KGR контейнер), `_mes_ofs.bin`+`_mes_data.bin` (gummi/exchange меню) |
| **Кодек BBS** | CTD з 32-byte header + 12-byte message + 32-byte layout entries, byte-identical round-trip (152/152), prefix-byte sequences (0x81/0x99/F1/F2/F5/F9), Cyrillic→Latin Extended мапа для font-hack |
| **Формати BBS** | `.ctd` (event/menu/HUD), HD-PNG атлас фонтів, `mesfont/menufont/cmdfont/helpfont/numeral` шрифти |
| **Редактор шрифту BBS** | Atlas viewer (HD PNG 1024×512), COD overlay з квадратними клітинами, правка X/Y/palette/width гліфів, експорт overlay-PNG як guide-шар, зум (−/+/Fit, Ctrl+wheel), збереження `.cod` |
| **Глосарій** | 📊 Dashboard з прогрес-баром, фільтри, сортування, 🩹 авто-фікс структури, 🔄 bulk Find/Replace (regex/whole-word) |
| **Імпорт** | HTML / CSV / TSV / TXT — з token-guard'ом проти втрати керівних байтів. HTML-імпорт сумісний з output OpenKh CTD Editor (`{:unk XX}`) |
| **Auto-wrap** | Адаптивне розставляння `{lf}` за EN-структурою з кернінг-метриками з `.knj` |
| **Кернінг (KH1)** | Візуальний редактор `.knj` з DDS-атласом (drag для зміни ширини, auto-fit за α-каналом) |
| **Auto-layout** | Авто-створення тек на запуск (KH1: `MYFILES/PROGRESS/DONE`; BBS: `ENG/PROGRESS/DONE`) |
| **Auto-update** | Через GitHub Releases (electron-updater) |
| **i18n** | UI українською + англійською (`/Налаштування → Мова`) |

### 📚 Підтримка форматів

#### `.binl` (структуровані діалоги)
Сигнатура `EvMsg`, header 11 байт + footer 5 байт. Усередині — sequence of null-terminated strings з offset-based індексацією.

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
Парсер реалізований ([tools/lib/ev-format.js](tools/lib/ev-format.js)) але **тимчасово вимкнений** у Safe Mode. Потрібна подальша reverse-engineering робота над game-side validation мехнізмами.

#### `.ctd` (Birth by Sleep — event/menu/HUD)
Власна clean-room реалізація ([tools/lib/ctd-codec.js](tools/lib/ctd-codec.js), [tools/lib/ctd-format.js](tools/lib/ctd-format.js)). Структура:
- 32-byte header: `count`, `messageTableOff`, `layoutTableOff`, `textBlockOff`, `textBlockSize`
- N × 12-byte message entries (id + offset у text-block + len)
- N × 32-byte layout entries (X/Y/font/scale/color)
- Text-block: послідовність KH-encoded байт-стрічок з padding `0xCD`
- Підтримка prefix-байтів `0x81`/`0x99` (CJK punctuation, latin extended) і кнопкових пар `F1/F2/F5/F9 + XX` (геймпадні гліфи).
- **Byte-identical round-trip**: оригінальні `.ctd` файли парсяться, перетворюються в TSV, повертаються назад у `.ctd` без жодного відхилення (152/152).

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
npm start              # dev-режим
npm run build          # портабельний .exe
npm run build:installer # NSIS installer
```

---

## 🇬🇧 English

### What is this

Cross-platform editor for translating **Kingdom Hearts 1 — Final Mix HD** and **Kingdom Hearts: Birth by Sleep — Final Mix HD** text. Supports the main text formats of both games, has a glossary with auto-deduplication, token validator, visual kerning editor (KH1) and font editor (BBS), and patch builder.

### ✨ Features

| Category | What works |
|---|---|
| **Games** | KH1 Final Mix HD · Birth by Sleep Final Mix HD (per-game isolated settings and folders) |
| **KH1 codec** | Two-byte commands (`{0x05/06/07,0xXX}`), Ukrainian overlay map, lossless round-trip |
| **KH1 formats** | `.bin` (raw text), `.binl` (with EvMsg header), `.ard` (KGR container), `_mes_ofs.bin`+`_mes_data.bin` (gummi/exchange menus) |
| **BBS codec** | CTD with 32-byte header + 12-byte message + 32-byte layout entries, byte-identical round-trip (152/152), prefix-byte sequences (0x81/0x99/F1/F2/F5/F9), Cyrillic→Latin Extended map for font-hack |
| **BBS formats** | `.ctd` (event/menu/HUD), HD-PNG font atlases, `mesfont/menufont/cmdfont/helpfont/numeral` fonts |
| **BBS font editor** | Atlas viewer (HD PNG 1024×512), COD overlay with square cells, edit X/Y/palette/width per glyph, export overlay PNG as guide layer, zoom (−/+/Fit, Ctrl+wheel), save `.cod` |
| **Glossary** | 📊 Dashboard with progress bar, filters, sorting, 🩹 auto-fix structure, 🔄 bulk Find/Replace (regex/whole-word) |
| **Import** | HTML / CSV / TSV / TXT — with token-guard against losing control bytes. HTML import compatible with OpenKh CTD Editor output (`{:unk XX}`) |
| **Auto-wrap** | Adaptive `{lf}` placement by EN structure using kerning metrics from `.knj` |
| **Kerning (KH1)** | Visual `.knj` editor with DDS atlas (drag-to-resize widths, auto-fit by α-channel) |
| **Auto-layout** | Auto-creates folder layout on launch (KH1: `MYFILES/PROGRESS/DONE`; BBS: `ENG/PROGRESS/DONE`) |
| **Auto-update** | Via GitHub Releases (electron-updater) |
| **i18n** | UK + EN UI (`Settings → Language`) |

### 📚 Format support

#### `.binl` (structured dialogs)
`EvMsg` signature, 11-byte header + 5-byte footer. Contains a sequence of null-terminated strings with offset-based indexing.

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
Parser implemented ([tools/lib/ev-format.js](tools/lib/ev-format.js)) but **temporarily disabled** in Safe Mode. Pending further reverse-engineering of game-side validation mechanisms.

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
npm start              # dev mode
npm run build          # portable .exe
npm run build:installer # NSIS installer
```

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
