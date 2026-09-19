#!/usr/bin/env python3
"""
make_ua_font.py — додає нативні українські гліфи до шрифтів KH3D HD.

Гліфи малюються у ВІЛЬНІ комірки наявного аркуша (нічого з того, що гра вже
використовує, не перезаписується), додаються відповідні записи CWDH і новий
блок CMAP, після чого записуються:

    <out>/original/font/en/bin/<name>.bcfnt                          (метрики + вбудована A4-текстура)
    <out>/remastered/font/en/bin/<name>.bcfnt/US_<name>_bcfnt0.png   (HD-текстура)

Два стилі накреслення:
  outline — mesfont / talkfont: біла заливка з чорним обведенням, справжній HD-арт ×2
  plain   — cmdfont / helpfont: білі гліфи без обведення; «ремастер»-текстура цих
            шрифтів насправді просто оригінал, збільшений ×2 методом nearest,
            тому малюємо в 1× і збільшуємо так само.
"""
import os, sys, json, argparse
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from khfont import Bcfnt, a4_encode
from raster import cell_image

UA_UPPER = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'
UA_LOWER = 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
UA_CHARS = UA_UPPER + UA_LOWER

# підібрано порівнянням із наявними англійськими гліфами (див. calibrate.py)
PROFILES = {
    'mesfont':  dict(style='outline', size=33.8, radius=2.5, base=36, thresh=110, render=2, font='comic'),
    'talkfont': dict(style='outline', size=33.8, radius=2.5, base=36, thresh=110, render=2, font='comic'),
    'cmdfont':  dict(style='plain',   size=10.0, radius=0.0, base=10, thresh=95, render=1, font='menu'),
    'helpfont': dict(style='plain',   size=12.3, radius=0.0, base=14, thresh=140, render=1, font='menu'),
}

LATIN = ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'
         'abcdefghijklmnopqrstuvwxyz0123456789')


def fit_advance(f, font_path):
    """Регресія: charWidth у грі від ширини просування вихідного шрифту."""
    from fontTools.ttLib import TTFont
    tt = TTFont(font_path); hm = tt['hmtx']; cm = tt.getBestCmap()
    xs, ys = [], []
    for ch in LATIN:
        if ord(ch) in f.cmap and ord(ch) in cm:
            xs.append(hm[cm[ord(ch)]][0])
            ys.append(f.widths[f.cmap[ord(ch)]][2])
    A = np.vstack([np.array(xs, float), np.ones(len(xs))]).T
    sol, *_ = np.linalg.lstsq(A, np.array(ys, float), rcond=None)
    pred = A @ sol
    return float(sol[0]), float(sol[1]), float(np.abs(pred - np.array(ys)).max())


def build(name, orig_path, rem_png, font_path, outdir, report):
    prof = PROFILES[name]
    f = Bcfnt(open(orig_path, 'rb').read())
    sheet = Image.open(rem_png).convert('RGBA')
    S = sheet.width // f.sheetWidth
    assert sheet.size == (f.sheetWidth * S, f.sheetHeight * S)
    R = prof['render']
    cw, chh = f.cellWidth * R, f.cellHeight * R

    from fontTools.ttLib import TTFont
    tt = TTFont(font_path); hm = tt['hmtx']; ttcm = tt.getBestCmap()
    adv_a, adv_b, adv_err = fit_advance(f, font_path)

    todo = [c for c in UA_CHARS if ord(c) not in f.cmap]
    reused = [dict(ch=c, code='U+%04X' % ord(c), index=f.cmap[ord(c)], reused=True)
              for c in UA_CHARS if ord(c) in f.cmap]
    start = f.glyphCount
    capacity = f.cellsPerSheet * f.nSheets
    assert start + len(todo) <= capacity, 'не вистачає вільних комірок'

    A = np.array(sheet.getchannel('A'))
    for k in range(len(todo)):
        x0, y0, x1, y1 = f.cell(start + k, S)
        if A[y0:y1, x0:x1].max() > 8:
            raise RuntimeError('комірка %d не порожня' % (start + k))

    added, squeezed = [], []
    for k, ch in enumerate(todo):
        idx = start + k
        xs = 1.0
        for _ in range(14):
            cell, bb, clipped = cell_image(ch, font_path, prof['size'], prof['radius'],
                                           prof['base'], cw, chh, style=prof['style'],
                                           thresh=prof['thresh'] * (xs ** 1.5), xscale=xs)
            if not clipped:
                break
            xs -= 0.03          # широкі літери (Щ, Ш, Ю) трохи стискаємо
        else:
            raise RuntimeError('гліф %r не влазить у комірку %dx%d' % (ch, cw, chh))
        if xs < 1.0:
            squeezed.append('%s %.0f%%' % (ch, xs * 100))
        if R != S:
            cell = cell.resize((f.cellWidth * S, f.cellHeight * S), Image.NEAREST)
        gw = min(int(round(bb[2] / R)), f.cellWidth)
        adv = hm[ttcm[ord(ch)]][0]
        cwd = int(round(adv_a * adv + adv_b))
        cwd = min(max(cwd, gw), f.maxCharWidth)
        x0, y0, x1, y1 = f.cell(idx, S)
        sheet.paste(cell, (x0, y0))
        f.widths.append((0, gw, cwd))
        f.cmap[ord(ch)] = idx
        added.append(dict(ch=ch, code='U+%04X' % ord(ch), index=idx,
                          cell=[idx % f.nColumns, idx // f.nColumns],
                          px_original=list(f.cell(idx, 1)), px_remastered=[x0, y0, x1, y1],
                          left=0, glyphWidth=gw, charWidth=cwd, xscale=round(xs, 2), reused=False))

    small = sheet.getchannel('A').resize((f.sheetWidth, f.sheetHeight),
                                         Image.NEAREST if R == 1 else Image.LANCZOS)
    f.sheets = [a4_encode(np.array(small), f.sheetWidth, f.sheetHeight)]

    ob = os.path.join(outdir, 'original', 'font', 'en', 'bin')
    rb = os.path.join(outdir, 'remastered', 'font', 'en', 'bin', name + '.bcfnt')
    os.makedirs(ob, exist_ok=True); os.makedirs(rb, exist_ok=True)
    open(os.path.join(ob, name + '.bcfnt'), 'wb').write(f.build())
    sheet.save(os.path.join(rb, 'US_%s_bcfnt0.png' % name))

    report[name] = dict(style=prof['style'], glyphsBefore=start, glyphsAfter=f.glyphCount,
                        cellCapacity=capacity, advanceFitMaxErr=round(adv_err, 2),
                        rowsUsed=(f.glyphCount + f.nColumns - 1) // f.nColumns,
                        rowsAvailable=f.nRows, added=added, reused=reused, squeezed=squeezed)
    return f, sheet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--orig', required=True, help='тека original/font/en/bin')
    ap.add_argument('--rem', required=True, help='тека remastered/font/en/bin')
    ap.add_argument('--comic', required=True, help='ComicHearts — діалоги')
    ap.add_argument('--menu', required=True, help='KHMenu — інтерфейс')
    ap.add_argument('--out', required=True)
    ap.add_argument('--fonts', default='mesfont,talkfont,cmdfont,helpfont')
    a = ap.parse_args()
    src = {'comic': a.comic, 'menu': a.menu}
    report = {}
    for name in a.fonts.split(','):
        build(name, os.path.join(a.orig, name + '.bcfnt'),
              os.path.join(a.rem, name + '.bcfnt', 'US_%s_bcfnt0.png' % name),
              src[PROFILES[name]['font']], a.out, report)
        r = report[name]
        print('%-9s %-7s %d -> %d гліфів (рядків %d з %d)%s'
              % (name, r['style'], r['glyphsBefore'], r['glyphsAfter'],
                 r['rowsUsed'], r['rowsAvailable'],
                 ('  стиснуто: ' + ', '.join(r['squeezed'])) if r['squeezed'] else ''))
    json.dump(report, open(os.path.join(a.out, 'ua_glyphs.json'), 'w'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
