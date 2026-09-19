# KH1 (1.5 ReMIX PC) — текст меню: `sysmsg.binl` (Message v361), `.kmb`, пари `_offset/_data`

Джерело: Ghidra-аналіз `KINGDOM HEARTS FINAL MIX.exe` (скрипти в [`tools/ghidra/`](../../tools/ghidra/)),
звірено на всіх мовних версіях `menu/<lang>/sysmsg.bin/XX_sysmsg.binl` і на робочому UA-файлі,
зібраному старим імпортером (KH_MAPPER), який гра приймала.

## Де живе текст меню (рядки в exe)

| Шлях у грі | Що це | Стан у нашому інструменті |
|---|---|---|
| `menu/<lang>/sysmsg.bin` → `XX_sysmsg.binl` | 488 системних повідомлень («Load this game?», «Ability equipped.», налаштування, гейм-овер) | ✅ handler `binl-v361` |
| `menu/<lang>/sysfont.bin` | шрифт меню (гліфи 0x20+, таблиця метрик 16 байт/гліф) | — |
| `menu/md_syno.kmb`, `menu/md_jiminy.kmb`, `menu/md_dic_msg.kmb`, `menu/md_anthem.kmb` | Синопсис, Журнал Джиміні, словник, «Ансем-репорти» | ⏳ формат KMB (u32 count + рядки з `00`, за OpenKh PR #1275) — файлів у `kh1_first` немає, шукати в інших `.hed` |
| `menu/md_memo_sysmsg.bin` → `md_memo_sysmsg.binl` | sysmsg-повідомлення журналу | ⏳ той самий Message v361, файл не знайдено |
| `exchange/%s_wsysmsg_offset.bin` + `_data.bin` | «Power / Armor / Shield / Special» | ✅ пара `mesofs` |
| `exchange/%s_wname_offset.bin` + `_data.bin` | **назви світів** (End of the World, Monstro, …) | ✅ пара `mesofs` (у `E:\RUS_KH\ENG` цих файлів ще нема — взяти з `original/exchange`) |
| `exchange/%s_name_mes.bin`, `%s_name_o_mes.bin`, `%s_ShopMessage.bin`, `%s_PresentMessage.bin`, `%s_HZRankingMsg.bin`, кубки `%s_*_cup.bin` | raw-таблиці | ✅ `rawbin` |
| `exchange/%s_gumi_mes_ofs.bin` + `_data.bin`, `%s_gumi_shop_msg.bin`, `%s_item_shop_msg.bin` | gummi/магазини | ✅ / ⏳ |
| `btltbl.bin` → `XX_AbilityName/AbilityHelp/ItemHelp/Word.bin` | бойові таблиці | ✅ `rawbin` |
| `ChallengeMsg.bin`, `ChallengeOfs.binl`, `SASAMSG.BIN`, `SAWDMSG.BIN`, `SAWEMSG.BIN`, `ghelp.bin` | міні-ігри / gummi | ⏳ не в `kh1_first` |

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
