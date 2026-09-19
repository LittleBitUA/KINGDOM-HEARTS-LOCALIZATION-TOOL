# Пам'ять сесії — Dream Drop Distance UA Localization

Стан на кінець сесії. Щоб продовжити — прочитай цей файл і `claude/formats.md`.

## Розташування

| що | де |
|---|---|
| гра | `D:\SteamLibrary\steamapps\common\KINGDOM HEARTS HD 2.8 Final Chapter Prologue\Image\dt` |
| робоча тека | `C:\Users\dmytryk\Desktop\DropDistanceHD` |
| набір інструментів | `…\DropDistanceHD\KH3D_UA_Toolkit\` |
| архів для друзів | `…\DropDistanceHD\KH3D_UA_Toolkit.zip` |
| вихідні шрифти | `…\DropDistanceHD\Fonts\{ComicHearts,KHMenu}-Regular.otf` |
| Ghidra + проєкт | `…\DropDistanceHD\Ghidra\` (користувача, не чіпати) |
| пакувальник гри | `…\KH3D_UA_Toolkit\KHPCPatchManager.exe` + `resources\` (користувача) |

## Що зроблено

**Формати повністю розібрані** (специфікації — у `claude/formats.md` і в README архіву):

* `.bcfnt` — BCFNT (Nintendo 3DS), блоки CFNT/FINF/TGLP/CWDH/CMAP, A4-текстура зі swizzle
* `.ctd` — `@CTD`, UTF-16LE, сторінкові офсети `(layoutIndex << 4) | textPage`
* усі 37 файлів EN (7510 рядків) розбираються й збираються **побайтово ідентично**

**Шрифти готові** — 66 українських літер у `mesfont`, `talkfont`, `cmdfont`, `helpfont`.
Лежать у `KH3D_UA_Toolkit\build\kh3d_first\`. Нічого англійського не замінено,
гліфи в вільних комірках. Перевірка: `tools\checkfont.py`.

**Текст** — `KH3D_UA_Toolkit\text_all.txt`, 6059 рядків для перекладу
(з 7510 записів; порожні та службові відфільтровані). Формат:
`### <шлях>` / `#N` / текст. Пакується подвійним кліком на
`Запакувати текст.bat` → `build\kh3d_first\original\message\en\`.

**Прогрес перекладу:** ще не починався, `text_all.txt` чистий англійський.
Тестова вставка кирилиці в `ctrg300.ctd` у грі підтвердилась.

## Дві пастки, на які вже наступали (не наступати вдруге)

1. **CMAP.** Ланцюжок закінчується блоком `type 2 (scan)` з діапазоном
   `0x0000–0xFFFF`. Рушій бере ПЕРШИЙ блок, чий діапазон містить код, тому все,
   додане після нього, недосяжне → символ малюється як `alterCharIndex` = `？`.
   Нові коди вмерджуються ВСЕРЕДИНУ catch-all блоку + окремий блок ПЕРЕД ним.
2. **Pillow `stroke_width`.** Малює обведення й заливку з різних початкових
   точок → у частини літер (Ж, Й, П) один бік лишається без контуру.
   Тому `raster.py` будує контур сам, дилатацією маски (supersampling ×4).

## Калібрування шрифтів

| шрифт | стиль | кегль | обведення | база | поріг |
|---|---|---|---|---|---|
| mesfont / talkfont | outline, ×2 | 33.8 | 2.5 | 36 | — |
| cmdfont | plain, ×1 | 10.0 | — | 10 | 95 |
| helpfont | plain, ×1 | 12.3 | — | 14 | 140 |

`cmdfont`/`helpfont` — білі без обведення, їхня «ремастер»-текстура це просто
оригінал ×2 nearest. Ж, Щ, Ю в них стиснуті по горизонталі на 3–15%.

## Що ще НЕ зроблено

* власне переклад (6059 рядків);
* написи, вмальовані в текстури `.ctt` — клавіатура, заголовки хронік,
  іконки світів. Це графіка, окрема задача;
* `numeral.bcfnt` (цифри, DDS-текстура) — кирилиця там не потрібна;
* `menufont.bcfnt` із `kh3d_third.hed_out` — ще не чіпали, за потреби
  обробляється тим самим `make_ua_font.py` (треба лише додати профіль).

## Перевірене

* тексту немає в `kh3d_second.hed_out`; у `kh3d_third.hed_out` `.exa` це скрипти
  подій без тексту, `.ctt` — текстури; архіву `fourth` не існує;
* Ghidra `FUN_1406d7f10`: мова за індексом `0=jp, 1=uk, 2=gr, 3=fr, 4=sp, 5=it`,
  де `uk` = United Kingdom, тобто наша тека `en`.

## Інструменти (`KH3D_UA_Toolkit\tools\`)

`khctd.py` (читання/запис .ctd) · `khtext.py` (весь текст в один .txt і назад) ·
`pack_ua.py` (пакувальник для .bat) · `khfont.py` (.bcfnt + A4) ·
`raster.py` (растеризація гліфів) · `make_ua_font.py` (додати кирилицю) ·
`calibrate.py` (підбір кегля) · `checkfont.py` (чи побачить гра кирилицю) ·
`preview.py` (рендер рядка як у грі).

Потрібно: Python 3; для шрифтів ще `pillow numpy fonttools scipy`.
