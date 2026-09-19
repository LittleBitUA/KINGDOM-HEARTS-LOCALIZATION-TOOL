#!/usr/bin/env python3
"""calibrate.py — підібрати кегль / радіус обведення / базову лінію так, щоб нові
гліфи були нерозрізненні від тих, що вже є у грі.

Спершу аналітично: радіус задає товщину обведення, кегль виводиться з висоти
великої літери, базова лінія — з нижнього краю 'H'. Далі — локальне уточнення
з попіксельним порівнянням (альфа + яскравість) по вибірці англійських гліфів.
"""
import sys, os
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from khfont import Bcfnt
from raster import cell_image

SAMPLE = 'HKAEOoxnpmTBCSUZaeiuvw0123'


def _ink(a, thr=32):
    ys, xs = np.where(a > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def calibrate(bcfnt_path, sheet_path, font_path, verbose=True, style='outline', scale=None):
    THRESH = [110] if style == 'outline' else [60, 75, 90, 100, 115, 130, 150, 175, 200]
    from fontTools.ttLib import TTFont
    tt = TTFont(font_path)
    upem = tt['head'].unitsPerEm
    cap = getattr(tt['OS/2'], 'sCapHeight', None) or int(0.7 * upem)

    f = Bcfnt(open(bcfnt_path, 'rb').read())
    sheet = Image.open(sheet_path).convert('RGBA')
    S = scale or (sheet.width // f.sheetWidth)
    cw, ch = f.cellWidth * S, f.cellHeight * S
    if scale:
        sheet = sheet.resize((f.sheetWidth * scale, f.sheetHeight * scale), Image.NEAREST)
    ref = {c: np.array(sheet.crop(f.cell(f.cmap[ord(c)], S))).astype(int)
           for c in SAMPLE if ord(c) in f.cmap}
    hb = _ink(ref['H'][..., 3])
    capH, hbottom = hb[3] - hb[1], hb[3]

    def score(size, radius, base, thresh=110):
        tot = 0.0
        for c, r in ref.items():
            try:
                cell, bb, clipped = cell_image(c, font_path, size, radius, base, cw, ch,
                                               style=style, thresh=thresh)
            except Exception:
                return 1e9
            a = np.array(cell).astype(int)
            tot += abs(r[..., 3] - a[..., 3]).mean() + abs(r[..., 0] - a[..., 0]).mean()
            if clipped:
                tot += 20
        return tot / len(ref)

    # coarse: radius drives everything else
    cands = []
    for r10 in (range(8, 36, 2) if style == 'outline' else [0]):
        radius = r10 / 10
        size = (capH - 2 * radius) * upem / cap
        base = int(round(hbottom - radius))
        if size <= 4:
            continue
        for th in THRESH:
            for ds in ((-1.5, -1.0, -0.5, 0, 0.5, 1.0) if style != 'outline' else [0]):
                cands.append((round(size + ds, 1), radius, base, th))
    best = min(cands, key=lambda c: score(*c))

    # refine locally
    for step in (4, 2, 1):
        size, radius, base, th = best
        grid = [(round(size + ds * step / 10, 1), max(0.0, round(radius + dr * step / 10, 1)),
                 base + db, t)
                for ds in (-1, 0, 1) for dr in (-1, 0, 1) for db in (-1, 0, 1)
                for t in (THRESH if style != 'outline' else [110])]
        best = min(grid, key=lambda c: score(*c))
    e = score(*best)
    if verbose:
        print('%-9s cell %dx%d (x%d) -> size=%.1f radius=%.1f base=%d thresh=%d  err=%.2f'
              % (os.path.basename(bcfnt_path).replace('.bcfnt', ''), cw, ch, S,
                 best[0], best[1], best[2], best[3], e))
    return dict(size=best[0], radius=best[1], base=best[2], thresh=best[3], scale=S, err=e)


if __name__ == '__main__':
    a = sys.argv[1:]
    calibrate(a[0], a[1], a[2], style=(a[3] if len(a) > 3 else 'outline'),
              scale=(int(a[4]) if len(a) > 4 else None))
