# Розбори форматів і нотатки з еталонних наборів

Ці документи перенесено з Python-наборів `DropDistanceHD/{BBS,CoM,KH3D_UA_Toolkit}`,
з яких портовано кодеки цього застосунку. Вони — джерело правди про байтові
формати; JS-код у `tools/lib/` звіряється з їхніми `.py` (див. `test/fixtures/`).

| файл | про що |
|---|---|
| `bbs-analysis.md` | Birth by Sleep: `@CTD` v1, кодування тексту, `.arc`/INF/COD/CLU/MTX, HD-текстури, дві палітри. **Увага:** розділ про сторінку `0x84` — застарілий; фінальне рішення — коди катакани `0x83xx` (`tools/py/bbs/cyrmap.py`). |
| `bbs-fonts.md` | Що саме змінено у шрифтах BBS і як перегенерувати. |
| `bbs-toolkit-readme.md` | Формат `text_all.txt`, що ловить пакувальник. |
| `recom-analysis.md` | Re:Chain of Memories: контейнер `.CTD`/`.ctdl`, кодування, шрифт `.binl` (FFMW), атлас, куди переселено кирилицю (хіраґана `0x829F–0x82E0`). |
| `recom-toolkit-readme.md` | Унікальні рядки (`text_uniq.txt`/`text_ua.txt`), збірка, тестовий набір. |
| `ddd-toolkit-readme.md` | Dream Drop Distance: швидкий старт, `text_all.txt`, шрифти `.bcfnt`. |
| `ddd-session-notes.md` | Нотатки сесії DDD: формати, пастки (CMAP catch-all, Pillow stroke), калібрування. |
