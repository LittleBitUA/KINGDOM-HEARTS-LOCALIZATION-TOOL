#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bbsfont.py — додати українську кирилицю в шрифти Birth by Sleep (PC HD).

Пише у ВІЛЬНІ комірки наявної сітки: жоден англійський, латинський чи
японський гліф не зачіпається. Оновлює:

    original/arc_en/system/FontEn.arc                    (COD — координати й ширини, INF — лічильник)
    remastered/arc_en/system/FontEn.arc/US_FontEn_arcN.png  (самі пікселі)

Кирилиця живе у сторінці Shift-JIS 0x84 — там, де вона і має бути.
Українські Ґ Є І Ї ґ є і ї, яких у Shift-JIS немає, — у вільні слоти
того самого рядка.
"""
import os, sys, struct, json, argparse
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arc import Arc
from raster import cell_image
import mtx as mtxlib

from cyrmap import UA, CODES

# який PNG якому шрифту відповідає (визначено за розмірами й вмістом)
PNG_INDEX = {'menufont': 0, 'helpfont': 1, 'cmdfont': 2, 'mesfont': 4, 'numeral': 5}

# калібрування: у пікселях того масштабу, в якому малюємо
PROFILES = {
    'mesfont':  dict(style='outline', render=2, font='comic',
                     size=32.0, radius=1.5, base=42, penx=1, thresh=110),
    # HD-текстури інтерфейсу — це НЕ збільшений PSP-оригінал, а справжня
    # графіка вдвічі більшої роздільності (штрих 2 px, є субпіксельні деталі).
    # Тому малюємо одразу в HD (render=2), розміри й база — в пікселях HD.
    'helpfont': dict(style='plain', render=2, font='menu',
                     size=25.6, radius=0.0, base=30, penx=1, thresh=240),
    'menufont': dict(style='plain', render=2, font='menu',
                     size=20.0, radius=0.0, base=30, penx=1, thresh=180),
    'cmdfont':  dict(style='plain', render=2, font='menu',
                     size=20.0, radius=0.0, base=23, penx=1, thresh=180),
}


def load(arc_path):
    a = Arc(open(arc_path, 'rb').read())
    return a, {e['name']: e for e in a.entries}


def inf_of(by, name):
    d = by[name + '.inf']['data']
    cnt, w, h = struct.unpack_from('<hhh', d, 0)
    return cnt, w, h, d[6], d[7]


def cod_of(by, name):
    d = by[name + '.cod']['data']
    return [list(struct.unpack_from('<HHHBB', d, i * 8)) for i in range(len(d) // 8)]


def build_arc(a, replace):
    """Зібрати ARC заново, підмінивши вміст деяких записів."""
    ents = []
    for e in a.entries:
        data = replace.get(e['name'], e['data'])
        ents.append((e, data))
    head = bytearray(struct.pack('<IhhII', 0x435241, a.version, a.count, 0, 0))
    table = bytearray(0x20 * a.count)
    body = bytearray()
    base = 0x10 + 0x20 * a.count
    for i, (e, data) in enumerate(ents):
        if e['link']:
            struct.pack_into('<IiiI', table, i * 0x20, e['dirhash'], 0, 0, e['unused'])
        else:
            while (base + len(body)) % 0x10:
                body.append(0)
            off = base + len(body)
            body += data
            struct.pack_into('<IiiI', table, i * 0x20, 0, off, len(data), e['unused'])
        table[i * 0x20 + 0x10:i * 0x20 + 0x20] = e['name'].encode('utf-8').ljust(16, b'\0')[:16]
    while (base + len(body)) % 0x10:
        body.append(0)
    return bytes(head + table + body)


# ---------------------------------------------------------------------------
# Кожна українська літера займає ГОТОВИЙ запис .cod наявної катакани
# (див. cyrmap.py). Запис лишається на своєму місці — код, X, Y і палітра
# не змінюються, тож пошук гліфа в рушії працює так само, як для оригіналу.
# Перемальовуються тільки пікселі комірки й байт ширини (зсув 0x07).
#
# Розмір PNG не змінюється НІКОЛИ: рушій рахує UV від фактичного розміру
# текстури, і будь-яка зміна висоти зсуває всі гліфи разом.
def _quant(rgba, outline):
    """RGBA-піксель -> рівень 0..3 палітри PSP-текстури."""
    a = rgba[..., 3].astype(int)
    if not outline:                       # 0 прозоро, 2 напів, 3 повністю
        return np.where(a < 100, 0, np.where(a < 200, 2, 3)).astype(np.uint8)
    lum = (rgba[..., 0].astype(int) * 299 + rgba[..., 1].astype(int) * 587
           + rgba[..., 2].astype(int) * 114) // 1000
    return np.where(a < 64, 0,
           np.where(lum < 100, 1, np.where(lum < 190, 2, 3))).astype(np.uint8)


def do_font(name, by, rem_dir, font_path, report, chars=UA):
    prof = PROFILES[name]
    cnt, w, h, cw, ch = inf_of(by, name)
    recs = cod_of(by, name)
    png_path = os.path.join(rem_dir, 'US_FontEn_arc%d.png' % PNG_INDEX[name])
    im = Image.open(png_path).convert('RGBA')
    S = (im.width // 2) // w
    R = prof['render']
    half = im.width // 2

    # PSP-текстура всередині .arc: частина екранів малюється саме з неї
    mраw = by[name + '.mtx']['data']
    midx = mtxlib.mtx_indices(mраw, w, h, 4)

    where = {}
    for i, r in enumerate(recs):
        where.setdefault(r[0], i)

    added, squeezed = [], []
    for c in chars:
        code = CODES[c]
        if code not in where:
            raise RuntimeError('%s: у шрифті немає запису 0x%04X для %r' % (name, code, c))
        i = where[code]
        _, gx, gy, pal, _ = recs[i]
        px, py = gx * S + pal * half, gy * S
        if py + ch * S > im.height or px + cw * S > im.width:
            raise RuntimeError('%s: комірка 0x%04X поза межами текстури' % (name, code))

        xs0 = prof.get('xscale', 1.0)
        xs = xs0
        for _ in range(14):
            cell, bb, clipped = cell_image(c, font_path, prof['size'], prof['radius'],
                                           prof['base'], cw * R, ch * R,
                                           style=prof['style'],
                                           thresh=prof['thresh'] * ((xs / xs0) ** 1.5),
                                           xscale=xs)
            if not clipped:
                break
            xs -= 0.03
        else:
            raise RuntimeError('гліф %r не влазить у комірку' % c)
        if xs < xs0:
            squeezed.append('%s %.0f%%' % (c, xs * 100))

        shifted = Image.new('RGBA', cell.size, (0, 0, 0, 0))
        shifted.paste(cell, (prof['penx'] * R, 0))
        if R != S:
            shifted = shifted.resize((cw * S, ch * S), Image.NEAREST)
        im.paste(Image.new('RGBA', (cw * S, ch * S), (0, 0, 0, 0)), (px, py))
        im.paste(shifted, (px, py))

        # ширина = крок каретки від лівого краю комірки (поле 0x07 у .cod);
        # край рахуємо за альфою >= 110, щоб не залічити ореол згладжування
        aa = np.array(shifted.getchannel('A'))
        cx = np.nonzero((aa >= 110).any(axis=0))[0]
        if len(cx) == 0:
            raise RuntimeError('гліф %r вийшов порожнім' % c)
        width = max(2, int(round((cx.max() + 1) / S)))
        recs[i] = [code, gx, gy, pal, min(width, 255)]

        # той самий гліф у PSP-текстуру: 2 біти на палітру в одному 4bpp пікселі
        small = np.array(shifted.resize((cw, ch), Image.LANCZOS))
        lvl = _quant(small, prof['style'] == 'outline')
        blk = midx[gy:gy + ch, gx:gx + cw]
        if blk.shape == lvl.shape:
            sh = 2 * pal
            mask = np.uint8(0xFF ^ (0x3 << sh))
            midx[gy:gy + ch, gx:gx + cw] = (blk & mask) | (lvl << sh)
        added.append(dict(ch=c, code='0x%04X' % code, xy=[gx, gy], palette=pal,
                          px=[px, py], width=width, xscale=round(xs, 2)))

    cod = b''.join(struct.pack('<HHHBB', *r) for r in recs)
    newmtx = mtxlib.swizzle(mtxlib.pack4(midx), w // 2, h)[:len(mраw)]
    report[name] = dict(count=len(recs), png=im.size, squeezed=squeezed, added=added,
                        mtx=len(newmtx))
    im.save(png_path)
    return {name + '.cod': cod, name + '.mtx': newmtx}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--arc', required=True, help='original/arc_en/system/FontEn.arc')
    ap.add_argument('--rem', required=True, help='тека remastered/.../FontEn.arc з PNG')
    ap.add_argument('--comic', required=True)
    ap.add_argument('--menu', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--fonts', default='mesfont,helpfont,menufont,cmdfont')
    a = ap.parse_args()

    arcobj, by = load(a.arc)
    outrem = os.path.join(a.out, 'remastered', 'arc_en', 'system', 'FontEn.arc')
    os.makedirs(outrem, exist_ok=True)
    for i in range(6):
        src = os.path.join(a.rem, 'US_FontEn_arc%d.png' % i)
        Image.open(src).save(os.path.join(outrem, 'US_FontEn_arc%d.png' % i))

    src = {'comic': a.comic, 'menu': a.menu}
    replace, report = {}, {}
    for n in a.fonts.split(','):
        replace.update(do_font(n, by, outrem, src[PROFILES[n]['font']], report))
        r = report[n]
        print('%-9s записів %d (без змін) | 66 літер на місці катакани | PNG %s + PSP .mtx%s'
              % (n, r['count'], 'x'.join(map(str, r['png'])),
                 ('  стиснуто: ' + ', '.join(r['squeezed'])) if r['squeezed'] else ''))

    outarc = os.path.join(a.out, 'original', 'arc_en', 'system')
    os.makedirs(outarc, exist_ok=True)
    open(os.path.join(outarc, 'FontEn.arc'), 'wb').write(build_arc(arcobj, replace))
    json.dump(report, open(os.path.join(a.out, 'ua_glyphs.json'), 'w'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
