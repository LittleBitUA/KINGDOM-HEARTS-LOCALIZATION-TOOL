#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
kh1font.py — нативна українська кирилиця у шрифті діалогів KH1 (1.5 ReMIX PC).

Малює 66 літер у ВІЛЬНІ комірки атласу `UK_kanji_knj0.dds` (індекси 224+ —
двобайтові коди `19 NN`, див. docs/formats/kh1-dialog-text.md), прописує
ширини у `UK_kanji.knj` (усі 4 копії таблиці на 0x40080/0x401D0/0x40320/0x40470)
і пише мапу літера → байти для кодека (`kh1-native-map.json`).
Жоден латинський/акцентований гліф не зачіпається.

Стиль повторює оригінал: сіра заливка 0x80 (PS2 «1.0», гра множить на колір
тексту) + чорна обводка з антиаліасингом. Розмір, товщина обводки і базова
лінія калібруються автоматично за наявними літерами `H`/`x`/`A`.

    python kh1font.py --knj UK_kanji.knj --dds UK_kanji_knj0.dds \
        --font ComicHearts-Regular.otf --out build/ [--preview preview.png]
"""
import os, sys, json, argparse
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'bbs'))
from raster import cell_image  # noqa: E402  (спільний растеризатор з BBS-набору)

UA = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
# Літери, чиї гліфи збігаються з латинськими — у «гібридному» режимі кодек
# може писати їх 1 байтом (sysmsg.binl має буфер 0x4800).
LOOKALIKE = {'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M',
             'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o',
             'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x'}

CELL_W, CELL_H, COLS, ROWS = 48, 64, 21, 16
ATLAS = 1024
WIDTH_TABLES = (0x40080, 0x401D0, 0x40320, 0x40470)
FIRST_FREE = 224           # перший індекс, доступний лише через 19 NN
KNJ_SIZE = 0x405C0
FILL_GRAY = 0x80

# KH1SYS: байт = індекс + 0x20; A..Z = 0x2B.., a..z = 0x45..
LATIN_IDX = {chr(ord('A') + i): 0x2B - 0x20 + i for i in range(26)}
LATIN_IDX.update({chr(ord('a') + i): 0x45 - 0x20 + i for i in range(26)})


def read_dds(path):
    d = open(path, 'rb').read()
    if d[:4] != b'DDS ' or len(d) < 128 + ATLAS * ATLAS * 4:
        raise RuntimeError('%s: очікується нестиснений DDS 1024x1024 BGRA' % path)
    px = np.frombuffer(d[128:128 + ATLAS * ATLAS * 4], dtype=np.uint8).reshape(ATLAS, ATLAS, 4).copy()
    return d[:128], px


def write_dds(path, header, px):
    with open(path, 'wb') as f:
        f.write(header)
        f.write(px.tobytes())


def cell_rect(idx):
    return (idx % COLS) * CELL_W, (idx // COLS) * CELL_H


def cell_of(px, idx):
    x, y = cell_rect(idx)
    return px[y:y + CELL_H, x:x + CELL_W]


def fill_mask(cell):
    """Маска заливки (не обводки): непрозоро і світло."""
    a = cell[..., 3].astype(int)
    lum = cell[..., 1].astype(int)
    return (a >= 200) & (lum >= 90)


def ink_mask(cell, thr=110):
    return cell[..., 3] >= thr


def bbox(mask):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def measure_original(px):
    """Висота великої літери, x-висота, базова лінія і товщина обводки з оригіналу."""
    H = bbox(fill_mask(cell_of(px, LATIN_IDX['H'])))
    x = bbox(fill_mask(cell_of(px, LATIN_IDX['x'])))
    Hink = bbox(ink_mask(cell_of(px, LATIN_IDX['H'])))
    cap_h = H[3] - H[1]
    base = H[3]                       # перший рядок під заливкою
    outline = max(1, (Hink[3] - Hink[1] - cap_h) / 2.0)
    return dict(cap_h=cap_h, x_h=x[3] - x[1], base=base, outline=outline,
                left=H[0], top=H[1])


def render(ch, font_path, size, radius, base):
    """RGBA-комірка 48x64 у стилі KH1: сіра заливка 0x80 + чорна обводка."""
    cell, bb, clipped = cell_image(ch, font_path, size, radius, base, CELL_W, CELL_H,
                                   style='outline', thr=32)
    arr = np.array(cell)
    fill = fill_mask(arr)
    out = arr.copy()
    # білу заливку растеризатора → сіра 0x80 (як в оригіналі), обводка лишається чорною
    lum = arr[..., 0].astype(int)
    g = np.clip(lum * FILL_GRAY // 255, 0, FILL_GRAY).astype(np.uint8)
    out[..., 0] = out[..., 1] = out[..., 2] = g
    return out, bb, clipped, fill


def calibrate(px, font_path, meas):
    """Підбираємо розмір шрифту так, щоб заливка 'H' мала висоту оригіналу."""
    size = float(meas['cap_h'])
    for _ in range(12):
        arr, _, _, fill = render('H', font_path, size, meas['outline'], meas['base'])
        bb = bbox(fill)
        h = bb[3] - bb[1]
        if h == meas['cap_h']:
            break
        size *= meas['cap_h'] / max(1, h)
    return size


def advance_from_cell(cell):
    """Байт ширини (advance/2) як у оригінальних гліфів: правий край заливки + обводка."""
    fb = bbox(fill_mask(cell))
    ib = bbox(ink_mask(cell))
    right = max(fb[2] if fb else 0, (ib[2] - 1) if ib else 0)
    return int(max(2, min(255, round((right + 1) / 2.0))))


def check_width_formula(px, knj):
    """Похибка формули ширини на оригінальних латинських літерах (для звіту)."""
    errs = []
    for ch, idx in LATIN_IDX.items():
        w = knj[WIDTH_TABLES[0] + idx]
        errs.append(advance_from_cell(cell_of(px, idx)) - w)
    return float(np.mean(np.abs(errs))), int(max(errs)), int(min(errs))


def bgra_from_rgba(rgba):
    return rgba[..., [2, 1, 0, 3]]


def font_cmap(font_path):
    """Множина кодів символів шрифту (None, якщо fontTools недоступний)."""
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return None
    return set((TTFont(font_path).getBestCmap() or {}).keys())


def choose_fonts(letters, primary, fallback):
    """Для кожного символу — шрифт, у якому він є (основний, інакше запасний).
    Повертає (mapping ch→font_path, список відсутніх скрізь)."""
    cm_p = font_cmap(primary)
    cm_f = font_cmap(fallback) if fallback else None
    chosen, missing = {}, []
    for ch in letters:
        if cm_p is None or ord(ch) in cm_p:
            chosen[ch] = primary
        elif cm_f is not None and ord(ch) in cm_f:
            chosen[ch] = fallback
        else:
            missing.append(ch)
    return chosen, missing


def free_cells(px, knj, start=FIRST_FREE):
    """Комірки без чорнила і з нульовою шириною, починаючи зі start."""
    out = []
    for idx in range(start, COLS * ROWS):
        if not ink_mask(cell_of(px, idx)).any() and knj[WIDTH_TABLES[0] + idx] == 0:
            out.append(idx)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--knj', required=True, help='оригінальний UK_kanji.knj')
    ap.add_argument('--dds', required=True, help='оригінальний UK_kanji_knj0.dds')
    ap.add_argument('--font', required=True, help='TTF/OTF з кирилицею (ComicHearts-Regular.otf)')
    ap.add_argument('--out', required=True, help='тека для UK_kanji.knj, UK_kanji_knj0.dds, kh1-native-map.json')
    ap.add_argument('--letters', default=UA, help='повний набір символів (за замовчуванням — українська абетка)')
    ap.add_argument('--extra', default='', help='додаткові символи після --letters (інші мови: ЁёЪъЫыЭэ, ĞğŞş, …)')
    ap.add_argument('--fallback-font', help='запасний TTF/OTF для символів, яких нема в основному (напр. Comic Sans MS)')
    ap.add_argument('--start', type=int, default=FIRST_FREE, help='перший індекс комірки (224 = код 19 00)')
    ap.add_argument('--size', type=float, help='розмір шрифту (px); без нього — автокалібрування по «H»')
    ap.add_argument('--radius', type=float, help='радіус обводки (px); без нього — з оригіналу')
    ap.add_argument('--base', type=int, help='базова лінія (px від верху комірки); без нього — з оригіналу')
    ap.add_argument('--penx', type=int, default=1, help='відступ зліва у комірці')
    ap.add_argument('--preview', help='PNG зі свіжими гліфами поруч із оригінальними')
    ap.add_argument('--layout', choices=['flat', 'game'], default='flat',
                    help="game: писати у <out>/original/exchange/ і <out>/remastered/exchange/UK_kanji.knj/ (як у kh1_first.hed_out)")
    a = ap.parse_args()

    knj = bytearray(open(a.knj, 'rb').read())
    if len(knj) != KNJ_SIZE:
        raise RuntimeError('%s: очікується %d байт, є %d' % (a.knj, KNJ_SIZE, len(knj)))
    header, px = read_dds(a.dds)

    meas = measure_original(px)
    radius = a.radius if a.radius is not None else meas['outline']
    base = a.base if a.base is not None else meas['base']
    size = a.size if a.size is not None else calibrate(px, a.font, dict(meas, outline=radius, base=base))
    werr = check_width_formula(px, knj)

    cells = free_cells(px, knj, a.start)
    letters = [ch for ch in dict.fromkeys(a.letters + a.extra) if not ch.isspace()]
    if len(cells) < len(letters):
        raise RuntimeError('вільних комірок %d, потрібно %d (зайвих: %d)' % (len(cells), len(letters), len(letters) - len(cells)))
    fonts, missing = choose_fonts(letters, a.font, a.fallback_font)
    if missing:
        raise RuntimeError('нема гліфів для: %s (у %s%s)' % (' '.join(missing), os.path.basename(a.font),
                           (' і ' + os.path.basename(a.fallback_font)) if a.fallback_font else ''))
    # запасний шрифт калібруємо окремо — інша висота великих літер
    sizes = {a.font: size}
    if a.fallback_font and any(f == a.fallback_font for f in fonts.values()):
        sizes[a.fallback_font] = a.size if a.size is not None else calibrate(px, a.fallback_font, dict(meas, outline=radius, base=base))

    mapping, report = {}, []
    for ch, idx in zip(letters, cells):
        fpath = fonts[ch]
        arr, bb, clipped, fill = render(ch, fpath, sizes[fpath], radius, base)
        if clipped:
            raise RuntimeError('гліф %r не влазить у комірку 48x64 (size=%.1f)' % (ch, sizes[fpath]))
        shifted = np.zeros_like(arr)
        shifted[:, a.penx:] = arr[:, :CELL_W - a.penx]
        x, y = cell_rect(idx)
        px[y:y + CELL_H, x:x + CELL_W] = bgra_from_rgba(shifted)
        w = advance_from_cell(px[y:y + CELL_H, x:x + CELL_W])
        for off in WIDTH_TABLES:
            knj[off + idx] = w
        code = idx - FIRST_FREE
        hi, lo = 0x19 + (code >> 8), code & 0xFF
        mapping[ch] = [hi, lo]
        report.append(dict(ch=ch, idx=idx, bytes='%02X %02X' % (hi, lo), width=w, cell=[x, y],
                           font=os.path.basename(fpath)))

    if a.layout == 'game':
        knj_dir = os.path.join(a.out, 'original', 'exchange')
        dds_dir = os.path.join(a.out, 'remastered', 'exchange', os.path.basename(a.knj))
    else:
        knj_dir = dds_dir = a.out
    os.makedirs(knj_dir, exist_ok=True)
    os.makedirs(dds_dir, exist_ok=True)
    open(os.path.join(knj_dir, os.path.basename(a.knj)), 'wb').write(bytes(knj))
    write_dds(os.path.join(dds_dir, os.path.basename(a.dds)), header, px)
    out_map = dict(_comment='KH1 native Cyrillic: letter -> [hi, lo] glyph code (19 NN => index 224+NN in kanji.knj/knj0.dds). '
                            'Generated by tools/py/kh1/kh1font.py.',
                   cell=[CELL_W, CELL_H], cols=COLS, first_index=FIRST_FREE,
                   font=os.path.basename(a.font), size=round(size, 2), radius=round(radius, 2), base=base,
                   fallback_font=os.path.basename(a.fallback_font) if a.fallback_font else None,
                   extra=''.join(ch for ch in letters if ch not in a.letters),
                   lookalike=LOOKALIKE, map=mapping)
    with open(os.path.join(a.out, 'kh1-native-map.json'), 'w', encoding='utf-8') as f:
        json.dump(out_map, f, ensure_ascii=False, indent=1)
    # звіт у форматі, який читає вкладка «Шрифти UA» (як у bbsfont.py)
    with open(os.path.join(a.out, 'ua_glyphs.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(kanji=dict(count=len(report), added=report, size=round(size, 2), radius=round(radius, 2), base=base)),
                  f, ensure_ascii=False, indent=1)

    if a.preview:
        # верхній ряд — оригінальні H x A g, далі всі нові гліфи по 21 у ряд
        n = len(report)
        rows = 1 + (n + COLS - 1) // COLS
        im = Image.new('RGBA', (COLS * CELL_W, rows * CELL_H), (30, 30, 60, 255))
        for i, ch in enumerate('HxAgQjyW'):
            c = cell_of(px, LATIN_IDX[ch])
            im.paste(Image.fromarray(c[..., [2, 1, 0, 3]].copy(), 'RGBA'), (i * CELL_W, 0), Image.fromarray(c[..., 3].copy(), 'L'))
        for i, r in enumerate(report):
            c = cell_of(px, r['idx'])
            pos = ((i % COLS) * CELL_W, (1 + i // COLS) * CELL_H)
            im.paste(Image.fromarray(c[..., [2, 1, 0, 3]].copy(), 'RGBA'), pos, Image.fromarray(c[..., 3].copy(), 'L'))
        # гліфи сірі 0x80 — для превʼю підсвітлимо, як робить гра (×2)
        arr = np.array(im)
        bright = arr.copy()
        bright[..., :3] = np.clip(arr[..., :3].astype(int) * 2, 0, 255)
        Image.fromarray(bright, 'RGBA').save(a.preview)

    print(json.dumps(dict(size=round(size, 2), radius=round(radius, 2), base=base,
                          cap_h=meas['cap_h'], x_h=meas['x_h'],
                          width_formula_error=dict(mean=round(werr[0], 2), max=werr[1], min=werr[2]),
                          added=len(report), first=report[0], last=report[-1],
                          free_left=len(cells) - len(report)), ensure_ascii=False))


if __name__ == '__main__':
    main()
