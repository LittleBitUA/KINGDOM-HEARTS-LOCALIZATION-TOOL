# KH1 (1.5 ReMIX PC) — текст меню: `sysmsg.binl` (Message v361), `.kmb`, пари `_offset/_data`

Джерело: Ghidra-аналіз `KINGDOM HEARTS FINAL MIX.exe` (скрипти в [`tools/ghidra/`](../../tools/ghidra/)),
звірено на всіх мовних версіях `menu/<lang>/sysmsg.bin/XX_sysmsg.binl` і на робочому UA-файлі,
зібраному старим імпортером (KH_MAPPER), який гра приймала.

## Де живе текст меню (рядки в exe)

| Шлях у грі | Що це | Стан у нашому інструменті |
|---|---|---|
| `menu/<lang>/sysmsg.bin` → `XX_sysmsg.binl` | 488 системних повідомлень («Load this game?», «Ability equipped.», налаштування, гейм-овер) | ✅ handler `binl-v361` |
| `menu/<lang>/sysfont.bin` | шрифт меню (гліфи 0x20+, таблиця метрик 16 байт/гліф) | — |
| `menu/md_syno.kmb`, `menu/md_jiminy.kmb`, `menu/md_dic_msg.kmb`, `menu/md_anthem.kmb` (`kh1_third`, `remastered/menu/md_*.kmb/UK_*.kmb`) | Синопсис, Журнал Джиміні, словник, «Ансем-репорти» | ✅ handler `kmb` (див. нижче) |
| `menu/md_memo_sysmsg.bin` → `md_memo_sysmsg.binl` (`kh1_third`, `remastered/menu/md_memo_sysmsg.bin/UK_…binl`) | 267 sysmsg-повідомлень журналу («Which character?», «Rotate with…») | ✅ той самий Message v361 (`binl-v361`) |
| `exchange/%s_wsysmsg_offset.bin` + `_data.bin` | «Power / Armor / Shield / Special» | ✅ пара `mesofs` |
| `exchange/%s_wname_offset.bin` + `_data.bin` | **назви світів** (End of the World, Monstro, …) | ✅ пара `mesofs` (у `E:\RUS_KH\ENG` цих файлів ще нема — взяти з `original/exchange`) |
| `exchange/%s_name_mes.bin`, `%s_name_o_mes.bin`, `%s_ShopMessage.bin`, `%s_PresentMessage.bin`, `%s_HZRankingMsg.bin`, кубки `%s_*_cup.bin` | raw-таблиці | ✅ `rawbin` |
| `exchange/%s_gumi_mes_ofs.bin` + `_data.bin`, `%s_gumi_shop_msg.bin`, `%s_item_shop_msg.bin` | gummi/магазини | ✅ пара `mesofs` / ✅ `rawbin` (u32 count + рядки; гра читає послідовно — RU-мод виріс з 2272 до 2928 байт) |
| `btltbl.bin` → `XX_AbilityName/AbilityHelp/ItemHelp/Word.bin` | бойові таблиці | ✅ `rawbin` |
| `worldmap/challe.dat/XX_ChallengeOfs.binl` + `XX_ChallengeMsg.bin` (`kh1_fourth`), `exchange/XX_SAWEOMSG.BIN` + `XX_SAWEMSG.BIN`, `XX_SAWDOMSG.BIN` + `XX_SAWDMSG.BIN`, `exchange/XX_SASAOMSG.BIN` + `remastered/gumi/SASAMSG.BIN/XX_SASAMSG.BIN` (`kh1_third`) | gummi-меню, карта світу, челенджі | ✅ пари `mesofs` у діалекті меню (див. нижче) |
| `exchange/XX_allarea.nam` | назви кімнат (18 світів × кімнати) у **fullwidth Shift-JIS** (`Ｄｉｎｉｎｇ　Ｒｏｏｍ`) — рендер шрифтом меню за unicode-полем `US_font_data_tbl.bin`; RU-мод поклав літери на коди хіраґани | ⏳ разом із нативним шрифтом меню (окрема задача) — формат: `u32 worlds`, таблиця `(u32 off, u32 size)` @0x10; блок світу: `u32 rooms`, 12×00, `(u32 off, u32 size)` відносно блоку, рядки з `00`, комірки кратні 4 |
| `exchange/UK/psel.bin` | не текст (графіка/палітра, 0xD0-заповнення; UK/GR різняться лише хвостом) | — |

## `Message v361` — контейнер

```
0x00  char[12] "Message v361"
0x0C  u32 count               — 488
0x10  u32 offsetTableOffset   — 0x20
0x14  u32 textOffset          — 0x20 + offsetTableLength
0x18  u32 offsetTableLength   — (count | count+1) × 2
0x1C  u32 textLength
offsetTable: u16[] зсувів від textOffset (перший = 0, зростають)
text: запис = байти + 00; далі опційний sentinel 00; padding 0xCD до кратного 16
```

Гра (`FUN_1402ccb90`) читає файл **`memcpy`-ом у статичний буфер `0x4800` (18 432) байт**
без перевірки розміру — більший файл переписує сусідні глобали. Оригінал = 13 374 байт,
робочий UA = 14 298. `composeMessageV361` відмовляється писати понад 0x4800.
Доступ до повідомлення `id` (1-based): `text + offsets[id-1]` (`FUN_1402ccb30`).
Sentinel-зсув у старого імпортера = `textLength` (а не `textLength-1`) — гра терпить, ми приймаємо.

## Керівні коди тексту меню (з рендерерів `FUN_1402cb210` / `FUN_1402cd670` / `FUN_1402e7060`)

| Байт | Довжина | Дія |
|---|---|---|
| `00`, `10` | — | кінець повідомлення |
| `01` | 1 | пробіл (фіксована ширина) |
| `02` | 1 | новий рядок |
| `03 NN` | 2 | висота рядка = NN, потім новий рядок |
| `04` / `05` / `06` | 1 | вирівнювання ліворуч / по центру / праворуч |
| `07 NN` | 2 | колір з палітри (`NN=0` — колір за замовчуванням) |
| `08 RR GG BB AA` | 5 | колір RGBA (напр. `E6 E6 E6 80`) |
| `09` | 1 | вставити число з аргументів виклику |
| `0A` | 1 | вставити вкладене повідомлення з аргументів |
| `0B a b c` | 4 | іконка/текстура |
| `0C NN` | 2 | масштаб шрифту |
| `0D i16` / `0E i16` | 3 | зсув X / Y (у пікселях, знаковий LE) |
| `0F NN` | 2 | вставити системний рядок/гліф кнопки за номером |
| `11 i16` / `13 i16` | 3 | абсолютний X |
| `12 i16` / `14 i16` | 3 | абсолютний Y |
| `15..1F NN` | 2 | двобайтовий гліф: індекс `(b<<8 \| NN) − 0x1820` |
| `≥ 20` | 1 | гліф: індекс `b − 0x20` (наша таблиця `kh1sys_text.json`) |

Усі команди у нашому кодеку — сирі токени `{0xAA,0xBB,…}` (`codec.decode(bytes, {cmd:'sysmsg'})`),
щоб байти параметрів (0x32 = «H», 0x80 = альфа) не потрапляли в текст. Перекладачу міняти їх не треба;
0x00 усередині запису законний лише як байт параметра (наприклад `{0x0D,0x06,0x00}`).

**Це не те саме, що діалоги подій (`EvMsg` .binl в ARD):** там свій байткод (`05/06/07` + u16,
`0A/0B/0D` 4 байти, `0C/0E` 2 байти), а розмір вікна задає скрипт EVDL syscall-ами
(`Set_window_size`, `Set_window_type`, `Set_window_width_auto`…) перед `Display_message(id)`.

## `.kmb` — списки рядків меню (`tools/lib/menu-msg.js`, handler `kmb`)

`u32 count`, далі `count` рядків у діалекті меню з термінатором `00`. Кінець рядка шукаємо,
перестрибуючи команди (`0D 0C 00` = зсув X на 12, а не термінатор). Хвіст — нулі:
`md_syno` доповнено до `0x4800`, `md_anthem`/`md_dic_msg` мають один завершальний `00`,
`md_jiminy` — до кратного 16. Compose зберігає розмір оригіналу, якщо вміщується; інакше —
той самий хвіст, вирівняний на 16 (якщо оригінал був кратний 16). Перевірено байт-у-байт на
UK/FR/GR/IT/SP; RU-мод змінював розміри вільно (`md_syno` 18432 → 17443).

## Пари таблиця-зсувів + дані у діалекті меню

Той самий формат, що `_mes_ofs/_mes_data` (u16-зсуви, `0xCD`/`00`-доповнення), але текст —
діалект меню, тож `parsePair(…, {cmd:'sysmsg'})` шукає термінатор з урахуванням команд.
`SAWDOMSG` має 1024 вказівники, з яких лише 40 ненульові (решта — посилання на рядок 0);
`SASAOMSG` лежить в `original/exchange/`, а його дані — в `remastered/gumi/SASAMSG.BIN/` —
класифікатор шукає data-половину в `../gumi/SASAMSG.BIN/` і `../../remastered/gumi/SASAMSG.BIN/`,
а `composeAll` кладе її у DONE за власним шляхом джерела (`kh1_third/remastered/gumi/SASAMSG.BIN/`).
Розміри інших мов (FR/GR/IT/SP більші за UK) показують, що гра не тримає їх у фіксованому буфері.

**Рендер:** усе це — шрифт меню (`sysfont.bin` + `US_font_data_tbl.bin`), де нативних гліфів
`19 NN` ще немає — як і для `sysmsg.binl`. Компонування працює, кирилиця в цих файлах
з'явиться разом із нативним шрифтом меню.

## Імена токенів меню

Щоб параметри команд не виглядали як літери, декодувальник діалекту меню
показує їх іменами (`shared/kh1-tokens.js`, окремі від діалогових — кодувальник
не знає діалекту):

| Байти | Токен | Дія |
|---|---|---|
| `01` | `{space}` | пробіл |
| `03 NN` | `{line_h N}` | висота рядка + новий рядок |
| `04` / `05` / `06` | `{align_l}` / `{align_c}` / `{align_r}` | вирівнювання |
| `07 NN` | `{palette N}` | колір із палітри |
| `08 RR GG BB AA` | `{rgba RRGGBBAA}` | колір RGBA |
| `09` | `{num}` | вставити число з аргументів |
| `0A` | `{sub_msg}` | вставити вкладене повідомлення |
| `0B a b c` | `{m_icon a,b,c}` | іконка/текстура |
| `0C NN` | `{scale N}` | масштаб шрифту |
| `0D lo hi` / `0E lo hi` | `{dx N}` / `{dy N}` | зсув X / Y |
| `0F NN` | `{sys_str N}` | вставити системний рядок |
| `10` | `{end2}` | кінець повідомлення |
| `11`/`13`, `12`/`14` + i16 | `{abs_x N}`/`{abs_x2 N}`, `{abs_y N}`/`{abs_y2 N}` | абсолютні координати |
