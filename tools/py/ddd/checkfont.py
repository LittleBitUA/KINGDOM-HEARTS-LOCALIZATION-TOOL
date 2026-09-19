#!/usr/bin/env python3
"""checkfont.py — перевіряє, чи побачить гра українські літери у .bcfnt.

Емулює обидві стратегії пошуку в ланцюжку CMAP:
  * "перший блок, чий діапазон містить код" (так робить рушій KH3D)
  * повний обхід ланцюжка
і додатково перевіряє, що всі старі гліфи лишились на місці.

    python3 checkfont.py mesfont.bcfnt [US_mesfont_bcfnt0.png]
"""
import sys, struct
import numpy as np

UA = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
LAT = 'ABCXYZabcxyz0189 .,!?\'"-—«»…'


def blocks_of(d):
    hdr = struct.unpack_from('<H', d, 6)[0]
    cmap_off = struct.unpack_from('<I', d, hdr + 8 + 16)[0]
    out, off = [], cmap_off
    while off:
        c = off - 8
        cb, ce, mt, _p, nxt = struct.unpack_from('<HHHHI', d, c + 8)
        out.append((c, cb, ce, mt))
        off = nxt
    return out


def lookup(d, blocks, code, first_match=True):
    found = None
    for c, cb, ce, mt in blocks:
        if not (cb <= code <= ce):
            continue
        p = c + 20
        v = None
        if mt == 0:
            v = struct.unpack_from('<H', d, p)[0] + (code - cb)
        elif mt == 1:
            v = struct.unpack_from('<H', d, p + 2 * (code - cb))[0]
            if v == 0xFFFF:
                v = None
        elif mt == 2:
            n = struct.unpack_from('<H', d, p)[0]
            for k in range(n):
                cc, ii = struct.unpack_from('<HH', d, p + 2 + 4 * k)
                if cc == code:
                    v = ii
                    break
        if first_match:
            return v
        if v is not None:
            found = v
    return found


def main(path, png=None):
    d = open(path, 'rb').read()
    hdr = struct.unpack_from('<H', d, 6)[0]
    alter = struct.unpack_from('<H', d, hdr + 8 + 2)[0]
    bl = blocks_of(d)
    print('CMAP блоки:', [(hex(b[1]), hex(b[2]), 'type%d' % b[3]) for b in bl])
    print('alterCharIndex (гліф-заглушка "?"):', alter)
    ok = True
    for mode, name in ((True, 'перший збіг'), (False, 'повний обхід')):
        miss_ua = [c for c in UA if lookup(d, bl, ord(c), mode) in (None, alter)]
        miss_lat = [c for c in LAT if lookup(d, bl, ord(c), mode) in (None, alter) and c != '?']
        print('  %-14s кирилиця: %s | латиниця: %s' % (
            name,
            'ВСІ 66 ОК' if not miss_ua else 'НЕМАЄ ' + ''.join(miss_ua),
            'ОК' if not miss_lat else 'НЕМАЄ ' + ''.join(miss_lat)))
        ok &= not miss_ua and not miss_lat
    if png:
        from PIL import Image
        sys.path.insert(0, __file__.rsplit('/', 1)[0])
        from khfont import Bcfnt
        f = Bcfnt(d)
        im = Image.open(png).convert('RGBA')
        S = im.width // f.sheetWidth
        empty = [c for c in UA
                 if np.array(im.crop(f.cell(f.cmap[ord(c)], S)).getchannel('A')).max() < 16]
        print('  текстура (%dx%d, x%d): %s' % (im.width, im.height, S,
              'усі гліфи намальовані' if not empty else 'ПОРОЖНІ ' + ''.join(empty)))
        ok &= not empty
    print('РЕЗУЛЬТАТ:', 'OK' if ok else 'Є ПРОБЛЕМИ')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))
