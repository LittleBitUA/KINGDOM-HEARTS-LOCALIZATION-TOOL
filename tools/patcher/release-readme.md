<div align="center">

# УКРАЇНІЗАТОР KINGDOM HEARTS

**Один файл. Сам знаходить гру, сам робить резервну копію, сам ставить переклад.**

Windows · Linux · Steam Deck

</div>

---

## Що завантажити

| Ви граєте на | Файл |
|---|---|
| Windows | `KH-UA-Patcher-win-x64.zip` |
| Linux, Steam Deck | `KH-UA-Patcher-linux-x64.tar.gz` |

Нічого встановлювати наперед не треба: ані .NET, ані mono, ані KHPCPatchManager.
Усе вже всередині.

## Як поставити

**Windows.** Розпакуйте архів **цілком** у будь-яку теку (наприклад, у
«Завантаження») і запустіть **`INSTALL.bat`**.

**Linux і Steam Deck.** Розпакуйте архів, відкрийте теку в терміналі й виконайте:

```sh
./install.sh
```

На Steam Deck треба спершу перейти в **режим робочого столу**, далі Konsole →
перетягніть `install.sh` у вікно → Enter.

Далі програма все зробить сама: знайде гру, покаже, що знайшла, і спитає дозволу.
**Гру перед цим закрийте.**

## Що воно робить із грою

Гра зберігає текст, шрифти й текстури в кількох великих архівах `.pkg`. Щоб
з'явилась українська, ці архіви треба перезібрати — тому перший запуск триває
довго (вони важать кілька гігабайтів), а на диску має бути приблизно стільки ж
вільного місця.

Оригінали **нікуди не зникають**: вони лягають у теку `backup` поруч із самою
грою. Звідти їх можна повернути будь-коли:

```
INSTALL.bat --відкотити          (Windows)
./install.sh --відкотити         (Linux)
```

Повторне встановлення теж безпечне: воно завжди рахується від оригіналу з
резервної копії, а не поверх попереднього патчу.

## Якщо щось пішло не так

**«Гру не знайдено автоматично.»** Програма спитає шлях — вкажіть теку, де лежать
файли `kh1_first.pkg`, `bbs_first.pkg` тощо. Зазвичай це:

```
…\KINGDOM HEARTS -HD 1.5+2.5 ReMIX-\Image\dt
```

Можна й одразу: `INSTALL.bat --гра "D:\Ігри\...\Image\dt"`.

**«На диску вільно менше, ніж треба.»** Звільніть місце розміром із самі архіви:
під час перезбирання поруч зі старим `.pkg` існує новий.

**Патч не дописується, помилка доступу.** Гра або лаунчер ще тримають файли —
закрийте Steam/Epic повністю й спробуйте ще раз.

**Steam Deck, гра на SD-картці.** Це підтримано: програма перебирає і
`/run/media`, і всі бібліотеки Steam із `libraryfolders.vdf`.

Докладний журнал кожного запуску лишається у `patch-log.txt` поруч із програмою —
його й надсилайте, якщо потрібна допомога.

## Усі ключі

| Ключ | Що робить |
|---|---|
| `--гра <тека>` | вказати теку гри вручну |
| `--відкотити` | повернути оригінали з `backup` |
| `--без-копії` | не лишати резервну копію (економія місця) |
| `--так` | нічого не питати |
| `--список` | показати знайдені встановлення й вийти |
| `--cli …` | режим самого KHPCPatchManager (розпакувати `.hed`, зібрати патч) |

Те саме, що `--гра`, робить змінна оточення `KH_GAME_DIR`.

## Кілька ігор одразу

У теці `patches/` може лежати скільки завгодно файлів патчу — `.kh1pcpatch`,
`.compcpatch`, `.bbspcpatch`, `.dddpcpatch`. Програма розбере їх за розширенням і
накотить кожен у свою збірку за один запуск.

---

## What this is (English)

A standalone console installer for Ukrainian translations of the **Kingdom Hearts**
PC releases. It finds the game (Steam, Epic, Steam Deck, SD cards), backs up the
original `.pkg` archives and applies a `.pcpatch` — with no .NET, mono or other
tooling required on your machine.

Windows: unpack and run `INSTALL.bat`. Linux / Steam Deck: unpack and run
`./install.sh`. Use `--restore` to put the original files back, `--game <dir>` to
point at the game yourself, `--list` to see what was detected.

---

## Ліцензії

Усередині — код [KHPCPatchManager](https://github.com/AntonioDePau/KHPCPatchManager)
(Apache-2.0, AntonioDePau), який спирається на [OpenKH](https://github.com/Xeeynamo/OpenKh)
(Xeeynamo та команда OpenKH, Noxalus). Перелік наших змін до нього — у `NOTICE.txt`,
сам текст ліцензії — у `LICENSE-KHPCPatchManager.txt`.

Решта — [KINGDOM HEARTS LOCALIZATION TOOL](https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL),
Dmytro Bidlov «Little Bit» Team, ліцензія MIT.
