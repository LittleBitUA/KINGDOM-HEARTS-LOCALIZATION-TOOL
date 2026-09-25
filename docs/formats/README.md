# Kingdom Hearts — text formats

Everything this project learned about how the Kingdom Hearts PC releases store
their text, fonts and layouts. Written down so the next person does not have to
rediscover it.

**Start here → [kh-games-overview.md](kh-games-overview.md)** — every game of the
series, where its text lives, which container it uses, and what is still unsolved.

Усе, що цей проєкт з'ясував про текст, шрифти й розкладки ПК-версій Kingdom
Hearts. Записано, щоб наступному не довелося відкривати це заново.

---

## Text containers

| Kind | Games | What it is |
|---|---|---|
| `binl` | KH1 FM | `.binl` with an `EvMsg` header (11-byte header, 5-byte footer). Field and cutscene messages. |
| `binl-v361` | KH1 FM | `.binl` starting with `Message v361`: a u16 offset table plus a NUL-terminated string pool. Menus (`sysmsg`). **Hard 0x4800-byte buffer** — see [kh1-menu-text.md](kh1-menu-text.md). |
| `rawbin` | KH1 FM | Bare `.bin` with encoded text and no header: ability and item names, battle commands, shop lines. |
| `mesofs` | KH1 FM | A pair — `*_mes_ofs.bin` (offsets) + `*_mes_data.bin` (text). Also `*_offset.bin` + `*_data.bin`. |
| `ev` | KH1 FM | `.ev` / `.evdl` event scripts with a text block inside bytecode. Pointers in the footer must be relocated when the block is rebuilt. |
| `kmb` | KH1 FM | Journal, dictionary and synopsis pages. |
| `ctd` | BBS FM | `@CTD` version 1 — dialogue and menus. |
| `ctd-ddd` | DDD, Days, Re:coded, Theater | `@CTD` version 0x1F7, UTF-16LE. |
| `ctdl` | Re:CoM | Same `@CTD` magic, a different layout; carries the text-window records too. |
| `bbs-arc` | BBS FM | `.arc` archives whose `.l2d` layouts have menu text baked in (pause, camp…). |

## Per-game notes

| File | What is in it |
|---|---|
| [kh-games-overview.md](kh-games-overview.md) | The whole series at a glance: where each game keeps its text and what is blocked. |
| [kh1-text-files.md](kh1-text-files.md) | KH1: which files in the unpacked game are actually text, and which only look like it. |
| [kh1-dialog-text.md](kh1-dialog-text.md) | KH1 dialogue bytecode: control commands, their lengths, and the `19 NN` two-byte escape that reaches the extra font cells. |
| [kh1-menu-text.md](kh1-menu-text.md) | KH1 menus: the `Message v361` layout, the system font's one-byte addressing, and the buffer that limits how long a translation may be. |
| [kh1-exe-map.md](kh1-exe-map.md) | Findings from the executable: hard page limits, how the game measures a line, the name-entry grid tables. |
| [kh1-other-mod-patch.md](kh1-other-mod-patch.md) | A third-party translation taken apart: what it changes beyond text, and which of its tricks are deliberately not repeated here. |
| [bbs-analysis.md](bbs-analysis.md) | Birth by Sleep: containers, text layout, menu strings inside `.arc`. |
| [bbs-fonts.md](bbs-fonts.md) | BBS glyph atlas and metrics. |
| [recom-analysis.md](recom-analysis.md) | Re:Chain of Memories: `.ctdl`, text windows, kerning. |
| [ddd-session-notes.md](ddd-session-notes.md) | Dream Drop Distance: archives and the UTF-16 container. |
| [bbs-toolkit-readme.md](bbs-toolkit-readme.md), [recom-toolkit-readme.md](recom-toolkit-readme.md), [ddd-toolkit-readme.md](ddd-toolkit-readme.md) | The reference Python toolkits these implementations were ported from. |

## Rules that hold across the series

1. **A translation may not grow past the game's buffer.** Several containers are
   read into a fixed allocation; the tool refuses to write a file that would
   exceed it and says by how much.
2. **Layout data is not text.** Bubble rectangles, glyph widths and `.l2d`
   layouts sit next to the strings. Growing a string can shift a texture and
   make the game draw garbage.
3. **Do not touch the Latin alphabet.** Every font here has free or unused
   cells. Drawing new letters there keeps the original English byte-identical,
   which also means the tool can be used for any language, not only Ukrainian.
4. **The same file can be drawn by different fonts.** KH1 has two — the dialogue
   font and the system font — and they address glyphs in completely different
   ways. Getting this backwards produces either invisible or shredded text.
