# -*- coding: utf-8 -*-
"""comfontua.py — вбудувати українську кирилицю у шрифти Re:Chain of Memories.

Перемальовує комірки атласу для кодів із cyrmap.py і виставляє байт ширини.
Таблиця «код -> гліф», кількість гліфів і розмір текстури НЕ змінюються.

    python3 comfontua.py --bin  "<...>\\SY0001.BIN" --vtm "<...>\\SY0001.VTM"
                         --comic ComicHearts-Regular.otf
                         --menu  KHMenu-Regular.otf
                         --out   build_font
"""
import os, sys, argparse, json
import numpy as np
from PIL import Image
from scipy.ndimage import grey_erosion
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comfont import Font
from raster import cell_image
from cyrmap import UA, CODES

# калібрування підібрано попіксельно під наявну латиницю кожного шрифту
PROFILES = {
    # інтерфейс: KHMenu, біла заливка без контуру.
    # KHMenu жирніший за рідний шрифт гри (штрих 6 проти 4 при тій самій
    # капітелі), тому малюємо більшим кеглем і з'їдаємо 1 піксель ерозією.
    # рідний sysfont гри — ВУЖЧИЙ за KHMenu (О завширшки 11 при капітелі 28),
    # тому базове стиснення 0.73: інакше український рядок ліз би за межі меню
    'sysfont': dict(font='menu',  style='plain',   size=39.5, radius=0.0,
                    base=34, thresh=160, penx=2, wadj=+2, erode=0, fill=255,
                    xscale=0.73),
    # діалоги: ComicHearts, чорний контур + СІРА заливка 128 (як в оригіналі,
    # білу заливка гра не використовує)
    'evtfont': dict(font='comic', style='outline', size=40.0, radius=2.5,
                    base=41, thresh=110, penx=2, wadj=-2, erode=0, fill=128,
                    xscale=1.0),
}


TOP, BOT, SIDE = 10, 10, 16      # запас навколо комірки на час малювання
# Чорнило не має торкатися країв комірки: гра семплить атлас білінійно, і крайній
# піксель «просвічує» у сусідню комірку (хвости Д/Ц/Щ/р/у/ф чи крапки Ї/Й з'являлись
# під/над чужими літерами). Оригінальні гліфи гри тримають запас 1–2 px.
MARGIN = 1


def do_font(name, binl, png, srcfont, report):
    prof = PROFILES[name]
    f = Font(binl, png, name)
    S = f.cell // f.line                      # HD-масштаб (2)
    W, H = f.cell + SIDE, f.cell + TOP + BOT
    added, squeezed = [], []
    for ch in UA:
        g = f.glyph(CODES[ch])
        if not 0 < g < f.count:
            raise RuntimeError('%s: %r -> гліф %d поза межами' % (name, ch, g))
        bx, by = f.box(g)

        # спершу пробуємо просто менший кегль (літера лишається неспотвореною),
        # і тільки якщо не допомогло — стискаємо по горизонталі
        xs0 = prof['xscale']
        cands = ([(prof['size'] - 0.5 * i, xs0) for i in range(24)]
                 + [(prof['size'] - 0.5 * i, xs0 - 0.03 * j)
                    for j in range(1, 9) for i in range(24)])
        size, xs, made = prof['size'], 1.0, None
        for size, xs in cands:
            for _ in range(1):
                cell, _, _ = cell_image(ch, srcfont, size, prof['radius'],
                                        prof['base'] + TOP, W, H, thr=100,
                                        style=prof['style'],
                                        thresh=prof['thresh'] * ((xs / xs0) ** 1.5),
                                        xscale=xs)
                arr = np.array(cell)
                if prof['erode']:
                    k = 2 * prof['erode'] + 1
                    arr[..., 3] = grey_erosion(arr[..., 3], size=(k, k))
                m = arr[..., 3] >= 110
                if not m.any():
                    continue
                _, xx = np.nonzero(m)                 # ширина — по «щільному» чорнилу
                ys, _ = np.nonzero(arr[..., 3] >= 24)  # запас — по всьому антиаліасу
                # перевіряємо ПІСЛЯ ерозії: чи вміщується у справжню комірку із запасом MARGIN;
                # якщо вилазить лише по вертикалі — спершу зсуваємо гліф у межах комірки
                # (до 3 px, це 1.5 px у масштабі гри), і лише потім зменшуємо кегль
                lo, hi = TOP + MARGIN, TOP + f.cell - MARGIN     # допустимі ряди [lo, hi)
                if xx.max() + 1 + prof['penx'] <= f.cell - MARGIN:
                    shift = 0
                    if ys.max() >= hi: shift = -(ys.max() - hi + 1)
                    elif ys.min() < lo: shift = lo - ys.min()
                    if abs(shift) <= 3 and ys.min() + shift >= lo and ys.max() + shift < hi:
                        if shift:
                            arr = np.roll(arr, shift, axis=0)
                            if shift > 0: arr[:shift] = 0
                            else: arr[shift:] = 0
                        made = (arr, xx.max() + 1)
                        break
            if made:
                break
        if not made:
            raise RuntimeError('гліф %r не влазить у комірку' % ch)
        arr, right = made
        if prof['fill'] != 255:                 # білу заливку -> сіру, як в оригіналі
            arr[..., :3] = (arr[..., 0].astype(int) * prof['fill'] // 255)[..., None]
        if xs < xs0 or size < prof['size']:
            squeezed.append('%s%s%s' % (ch,
                            ' ×%.2f' % xs if xs < xs0 else '',
                            ' кегль %.1f' % size if size < prof['size'] else ''))

        work = Image.fromarray(arr, 'RGBA')
        placed = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        placed.paste(work, (prof['penx'], 0))
        final = placed.crop((0, TOP, f.cell, TOP + f.cell))
        f.im.paste(Image.new('RGBA', (f.cell, f.cell), (0, 0, 0, 0)), (bx, by))
        f.im.paste(final, (bx, by))

        # ширина = крок каретки в одиницях висоти рядка
        w = max(2, int(round((right + prof['penx'] + prof['wadj']) / S)))
        f.widths[g] = min(w, 255)
        added.append(dict(ch=ch, code='0x%04X' % CODES[ch], glyph=g,
                          box=[bx, by], width=w, size=round(size, 1),
                          xscale=round(xs, 2)))
    report[name] = dict(count=f.count, png=f.im.size, squeezed=squeezed, added=added)
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bin', required=True)
    ap.add_argument('--vtm', required=True)
    ap.add_argument('--comic', required=True)
    ap.add_argument('--menu', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    ob = os.path.join(a.out, 'SY0001.BIN'); os.makedirs(ob, exist_ok=True)
    ov = os.path.join(a.out, 'SY0001.VTM'); os.makedirs(ov, exist_ok=True)
    src = {'comic': a.comic, 'menu': a.menu}
    report = {}
    for name in ('sysfont', 'evtfont'):
        f = do_font(name,
                    os.path.join(a.bin, 'UK_%s.binl' % name),
                    os.path.join(a.vtm, 'UK_%s_fo240.png' % name),
                    src[PROFILES[name]['font']], report)
        f.save(os.path.join(ob, 'UK_%s.binl' % name),
               os.path.join(ov, 'UK_%s_fo240.png' % name))
        r = report[name]
        print('%-8s %d гліфів (без змін) | 66 літер на місці хіраґани | атлас %s%s'
              % (name, r['count'], 'x'.join(map(str, r['png'])),
                 ('  стиснуто: ' + ', '.join(r['squeezed'])) if r['squeezed'] else ''))
    json.dump(report, open(os.path.join(a.out, 'ua_glyphs.json'), 'w'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
