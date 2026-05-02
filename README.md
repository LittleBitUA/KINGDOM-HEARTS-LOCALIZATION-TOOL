<div align="center">

# 👑 KH1 Localization Tool

[![Latest](https://img.shields.io/github/v/release/LittleBitUA/KH1-Localization-tool?style=for-the-badge&color=ffd700&labelColor=0f1730)](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-38bdf8?style=for-the-badge&labelColor=0f1730)](LICENSE)
[![Electron](https://img.shields.io/badge/electron-32.x-47848f?style=for-the-badge&labelColor=0f1730)](https://electronjs.org)

**Інструмент для локалізації Kingdom Hearts 1 — кодек, редактор тексту, кернінг, словник.**
*A localization toolkit for Kingdom Hearts 1 — codec, text editor, kerning, glossary.*

[🇺🇦 Українська](#-українська) · [🇬🇧 English](#-english) · [📥 Download](https://github.com/LittleBitUA/KH1-Localization-tool/releases/latest)

</div>

---

## 🇺🇦 Українська

### Що це

Кросплатформенний редактор для перекладу тексту гри **Kingdom Hearts 1 — Final Mix HD**. Підтримує всі основні текстові формати гри, має словник із автоматичним підхопленням повторень, валідатор токенів, візуальний редактор кернінгу та збірку patch-файлу.

### ✨ Можливості

| Категорія | Що працює |
|---|---|
| **Кодек** | Двобайтові команди (`{0x05/06/07,0xXX}`), українська overlay-карта, lossless round-trip |
| **Формати** | `.bin` (raw KH1 text), `.binl` (з EvMsg-заголовком), `.ard` (KGR контейнер), `_mes_ofs.bin`+`_mes_data.bin` (gummi/exchange меню) |
| **Глосарій** | 📊 Dashboard з прогрес-баром, фільтри, сортування, 🩹 авто-фікс структури, 🔄 bulk Find/Replace (regex/whole-word) |
| **Імпорт** | HTML / CSV / TSV / TXT — з token-guard'ом проти втрати керівних байтів |
| **Auto-wrap** | Адаптивне розставляння `{lf}` за EN-структурою з кернінг-метриками з `.knj` |
| **Кернінг** | Візуальний редактор `.knj` з DDS-атласом (drag для зміни ширини, auto-fit за α-каналом) |
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

#### `.ev` / `.evdl` (event scripts)
Парсер реалізований ([tools/lib/ev-format.js](tools/lib/ev-format.js)) але **тимчасово вимкнений** у Safe Mode. Потрібна подальша reverse-engineering робота над game-side validation мехнізмами.

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

Cross-platform editor for translating **Kingdom Hearts 1 — Final Mix HD** text. Supports all main game text formats, has a glossary with auto-deduplication, token validator, visual kerning editor, and patch builder.

### ✨ Features

| Category | What works |
|---|---|
| **Codec** | Two-byte commands (`{0x05/06/07,0xXX}`), Ukrainian overlay map, lossless round-trip |
| **Formats** | `.bin` (raw KH1 text), `.binl` (with EvMsg header), `.ard` (KGR container), `_mes_ofs.bin`+`_mes_data.bin` (gummi/exchange menus) |
| **Glossary** | 📊 Dashboard with progress bar, filters, sorting, 🩹 auto-fix structure, 🔄 bulk Find/Replace (regex/whole-word) |
| **Import** | HTML / CSV / TSV / TXT — with token-guard against losing control bytes |
| **Auto-wrap** | Adaptive `{lf}` placement by EN structure using kerning metrics from `.knj` |
| **Kerning** | Visual `.knj` editor with DDS atlas (drag-to-resize widths, auto-fit by α-channel) |
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

#### `.ev` / `.evdl` (event scripts)
Parser implemented ([tools/lib/ev-format.js](tools/lib/ev-format.js)) but **temporarily disabled** in Safe Mode. Pending further reverse-engineering of game-side validation mechanisms.

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
