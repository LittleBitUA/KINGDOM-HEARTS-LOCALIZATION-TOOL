<div align="center">

# ВСТАНОВЛЮВАЧ ПАТЧІВ KINGDOM HEARTS

**Один файл. Сам знаходить гру, сам робить резервну копію, сам накочує патч.**

Windows · Linux · Steam Deck

</div>

---

## Що це

Програма для гравця, яка ставить у гру готовий патч — файл `.kh1pcpatch`,
`.compcpatch`, `.bbspcpatch` або `.dddpcpatch`. Такі патчі роблять перекладачі
й моддери; **сам патч сюди не входить**, його завантажують окремо в автора
перекладу чи моду.

Нічого встановлювати наперед не треба: ані .NET, ані mono, ані KHPCPatchManager.
Усе вже всередині одного файла.

| Ви граєте на | Завантажте |
|---|---|
| Windows | `KH-UA-Patcher-win-x64.zip` |
| Linux, Steam Deck | `KH-UA-Patcher-linux-x64.tar.gz` |

## Як поставити патч

1. Розпакуйте архів **цілком** у будь-яку теку (наприклад, у «Завантаження»).
2. Покладіть файл патчу в теку **`patches/`**.
3. Закрийте гру й запустіть:
   * **Windows** — `INSTALL.bat`, подвійний клік;
   * **Linux, Steam Deck** — `./install.sh` у терміналі.

На Steam Deck треба спершу перейти в **режим робочого столу**, далі Konsole →
перетягніть `install.sh` у вікно → Enter.

Далі програма все зробить сама: знайде гру, покаже, що знайшла, і спитає дозволу.

## Що воно робить із грою

Гра зберігає текст, шрифти й текстури в кількох великих архівах `.pkg`. Щоб патч
подіяв, ці архіви треба перезібрати — тому перший запуск триває довго (вони
важать кілька гігабайтів), а на диску має бути приблизно стільки ж вільного
місця.

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

У теці `patches/` може лежати скільки завгодно патчів для різних ігор — програма
розбере їх за розширенням і накотить кожен у свою збірку за один запуск.

## Які ігри підтримано

`KINGDOM HEARTS HD 1.5+2.5 ReMIX` (KH1 Final Mix, Re:Chain of Memories, KH2 Final
Mix, Birth by Sleep Final Mix) і `KINGDOM HEARTS HD 2.8 Final Chapter Prologue`
(Dream Drop Distance). Steam і Epic Games.

---

## What this is (English)

A standalone console installer for Kingdom Hearts PC patches (`.kh1pcpatch`,
`.compcpatch`, `.bbspcpatch`, `.dddpcpatch`). It finds the game on its own —
Steam, Epic, Steam Deck, SD cards — backs up the original `.pkg` archives and
applies the patch, with no .NET, mono or other tooling required on your machine.
**No patch is bundled**: drop your own into `patches/`.

Windows: unpack and run `INSTALL.bat`. Linux / Steam Deck: unpack and run
`./install.sh`. Use `--restore` to put the original files back, `--game <dir>` to
point at the game yourself, `--list` to see what was detected. The interface is
in Ukrainian, but every switch also has an English spelling.

Why a rebuild rather than the upstream release: KHPCPatchManager ships a
Windows-only binary — despite `net5.0` in its project file, it is built through a
custom `<Csc>` target against .NET Framework. This build is produced from source
for both platforms and verified to rebuild the game archives byte-identically.

---

## Ліцензії

Усередині — код [KHPCPatchManager](https://github.com/AntonioDePau/KHPCPatchManager)
(Apache-2.0, AntonioDePau), який спирається на [OpenKH](https://github.com/Xeeynamo/OpenKh)
(Xeeynamo та команда OpenKH, Noxalus). Перелік наших змін до нього — у `NOTICE.txt`,
сам текст ліцензії — у `LICENSE-KHPCPatchManager.txt`.

Решта — [KINGDOM HEARTS LOCALIZATION TOOL](https://github.com/LittleBitUA/KINGDOM-HEARTS-LOCALIZATION-TOOL),
Dmytro Bidlov «Little Bit» Team, ліцензія MIT.
