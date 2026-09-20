# -*- coding: utf-8 -*-
"""imz_tool.py — текстури інтерфейсу Re:Chain of Memories (IMGZ → PNG → IMGZ).

`.imz` = контейнер IMGZ: заголовок ('IMGZ', версія 0x100, зсув таблиці 0x10,
кількість), таблиця (offset u32, size u32) на кожну текстуру, далі самі
IMGD (KH2-подібні: 32bpp RGBA або 8bpp + CLUT; альфа PS2 — 0x80 = непрозоро).
Напис «FRIENDS», «LEVEL UP!», «CARDS», підказки меню тощо лежать у
remastered/FORM/<n>/FOxxxx.RTM/UK_*.imz.

    python imz_tool.py export --src <…/Recom.hed_out> --out <тека>  [--only 'UK_*.imz']
        → <тека>/remastered/FORM/0002/FO0002.RTM/UK_Cockpit.imz.0.png (+ .json з описом)
          (UK_*.png з FORM копіюються як є)
    python imz_tool.py import --src <…/Recom.hed_out> --png <тека> --out <тека-патчу/Recom>
        → перезбирає .imz із відредагованих PNG (розмір має збігатися з оригіналом;
          8bpp-текстури перетворюються назад через квантування до 256 кольорів)

Вихід import має розкладку патчу KHPCPatchManager (Recom/remastered/…) —
тека кладеться у staging поруч із текстами.
"""
import os, sys, json, struct, argparse, fnmatch, shutil
from PIL import Image


def read_imgz(d):
    assert d[:4] == b'IMGZ', 'не IMGZ'
    ver, tab, cnt = struct.unpack_from('<III', d, 4)
    return [struct.unpack_from('<II', d, tab + i * 8) for i in range(cnt)]


def imgd_info(sub):
    magic, ver, bo, bl, co, cl, u18, w, h, pw, ph, u24, u26, fmt = struct.unpack_from('<4sIIIIIiHHHHHHI', sub, 0)
    assert magic == b'IMGD', 'не IMGD'
    bpp = 32 if bl == w * h * 4 else (8 if bl == w * h else (4 if bl * 2 == w * h else 0))
    return dict(bo=bo, bl=bl, co=co, cl=cl, w=w, h=h, bpp=bpp)


def _unswizzle_clut(clut):
    pal = [struct.unpack_from('<BBBB', clut, i * 4) for i in range(256)]
    fixed = []
    for i in range(256):
        blk, j = divmod(i, 32); sub, k = divmod(j, 8); sub = [0, 2, 1, 3][sub]
        fixed.append(pal[blk * 32 + sub * 8 + k])
    return fixed


def _swizzle_index(i):
    blk, j = divmod(i, 32); sub, k = divmod(j, 8); sub = [0, 2, 1, 3][sub]
    return blk * 32 + sub * 8 + k


def imgd_to_image(sub):
    inf = imgd_info(sub)
    w, h = inf['w'], inf['h']
    bm = sub[inf['bo']:inf['bo'] + inf['bl']]
    if inf['bpp'] == 32:
        img = Image.frombytes('RGBA', (w, h), bm)
    elif inf['bpp'] == 8:
        pal = _unswizzle_clut(sub[inf['co']:inf['co'] + inf['cl']])
        img = Image.new('RGBA', (w, h)); px = img.load()
        for y in range(h):
            row = y * w
            for x in range(w):
                px[x, y] = pal[bm[row + x]]
    else:
        raise ValueError('непідтримуваний IMGD (%d×%d, %d байтів)' % (w, h, inf['bl']))
    # альфа PS2: 0x80 = непрозоро → 0xFF
    r, g, b, a = img.split()
    a = a.point(lambda v: min(255, v * 2))
    return Image.merge('RGBA', (r, g, b, a)), inf


def image_to_imgd(sub, img):
    """Повертає новий IMGD-блок з тим самим заголовком і бітмапою з img."""
    inf = imgd_info(sub)
    w, h = inf['w'], inf['h']
    if img.size != (w, h):
        raise ValueError('розмір PNG %s ≠ %d×%d' % (img.size, w, h))
    img = img.convert('RGBA')
    r, g, b, a = img.split()
    a = a.point(lambda v: (v + 1) // 2)          # 0xFF → 0x80
    img = Image.merge('RGBA', (r, g, b, a))
    out = bytearray(sub)
    if inf['bpp'] == 32:
        out[inf['bo']:inf['bo'] + inf['bl']] = img.tobytes()
    elif inf['bpp'] == 8:
        # квантуємо RGBA до 256 кольорів (альфу зберігаємо через окремий канал у палітрі)
        q = img.convert('RGBA').quantize(colors=256, method=Image.Quantize.FASTOCTREE)
        pal = q.getpalette('RGBA')
        idx = q.tobytes()
        clut = bytearray(256 * 4)
        for i in range(256):
            j = _swizzle_index(i)
            clut[j * 4:j * 4 + 4] = bytes(pal[i * 4:i * 4 + 4]) if pal and len(pal) >= (i + 1) * 4 else b'\0\0\0\0'
        out[inf['bo']:inf['bo'] + inf['bl']] = idx
        out[inf['co']:inf['co'] + 1024] = clut
    else:
        raise ValueError('непідтримуваний IMGD')
    return bytes(out)


def iter_imz(src, only):
    for root, _dirs, files in os.walk(src):
        for fn in files:
            if fn.lower().endswith('.imz') and any(fnmatch.fnmatch(fn, pat) for pat in only):
                full = os.path.join(root, fn)
                yield full, os.path.relpath(full, src).replace('\\', '/')


def cmd_export(a):
    n = 0
    for full, rel in iter_imz(a.src, a.only):
        d = open(full, 'rb').read()
        entries = read_imgz(d)
        meta = []
        for i, (off, size) in enumerate(entries):
            sub = d[off:off + size]
            try:
                img, inf = imgd_to_image(sub)
            except Exception as e:
                print('  пропущено %s #%d: %s' % (rel, i, e)); continue
            dst = os.path.join(a.out, rel + '.%d.png' % i)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            img.save(dst)
            meta.append(dict(index=i, png=os.path.basename(dst), width=inf['w'], height=inf['h'], bpp=inf['bpp']))
            n += 1
        json.dump(dict(source=rel, textures=meta), open(os.path.join(a.out, rel + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('%-60s %d текстур' % (rel, len(meta)))
    # готові PNG інтерфейсу (підказки кнопок у FORM) — копіюємо як є; шрифти
    # (SYS/…/UK_*_fo240.png) НЕ чіпаємо — їх генерує вкладка «Шрифти UA»
    for root, _dirs, files in os.walk(os.path.join(a.src, 'remastered', 'FORM')):
        for fn in files:
            if fn.lower().endswith('.png') and any(fnmatch.fnmatch(fn, pat.replace('.imz', '.png')) for pat in a.only):
                full = os.path.join(root, fn); rel = os.path.relpath(full, a.src).replace('\\', '/')
                dst = os.path.join(a.out, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(full, dst); n += 1
                print('%-60s png' % rel)
    print('разом: %d файлів → %s' % (n, a.out))


def cmd_import(a):
    n = 0
    for root, _dirs, files in os.walk(a.png):
        for fn in files:
            if not fn.lower().endswith('.json'): continue
            meta = json.load(open(os.path.join(root, fn), encoding='utf-8'))
            rel = meta['source']
            orig = os.path.join(a.src, rel)
            if not os.path.isfile(orig):
                print('нема оригіналу', orig); continue
            d = open(orig, 'rb').read()
            entries = read_imgz(d)
            out = bytearray(d)
            changed = 0
            for t in meta['textures']:
                png = os.path.join(root, t['png'])
                if not os.path.isfile(png): continue
                off, size = entries[t['index']]
                sub = image_to_imgd(d[off:off + size], Image.open(png))
                assert len(sub) == size
                out[off:off + size] = sub
                changed += 1
            if not changed: continue
            dst = os.path.join(a.out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, 'wb').write(out)
            n += 1
            print('%-60s %d текстур → %s' % (rel, changed, dst))
    # PNG інтерфейсу — копіюємо назад
    for root, _dirs, files in os.walk(a.png):
        for fn in files:
            if fn.lower().endswith('.png') and '.imz.' not in fn.lower():
                full = os.path.join(root, fn); rel = os.path.relpath(full, a.png).replace('\\', '/')
                dst = os.path.join(a.out, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(full, dst); n += 1
    print('разом: %d файлів → %s' % (n, a.out))


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    e = sp.add_parser('export'); e.add_argument('--src', required=True); e.add_argument('--out', required=True)
    e.add_argument('--only', nargs='*', default=['UK_*.imz'])
    i = sp.add_parser('import'); i.add_argument('--src', required=True); i.add_argument('--png', required=True); i.add_argument('--out', required=True)
    a = ap.parse_args()
    (cmd_export if a.cmd == 'export' else cmd_import)(a)


if __name__ == '__main__':
    main()
