#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
kh1sysfont.py — українська абетка у СИСТЕМНОМУ шрифті KH1 (1.5 ReMIX PC).

Системний шрифт — це меню, підписи кнопок, цифри і сітка екрана введення
назви (пліт). Діалоги малюються іншим шрифтом, для якого є kh1font.py.

Що робить:
  * бере ЧИСТІ оригінали `US_font_data_tbl.bin` і `UK_sysfont_bin0.dds`;
  * малює 66 українських літер (А…Я, а…я) у 66 ПІДРЯД записів, починаючи
    з --start (типово 0x8A): 26 з них у оригіналі порожні, решта — акцентована
    латиниця, яка в українському атласі не потрібна (атлас свій на кожну мову);
  * прописує байт ширини; координати, сторінку й коди НЕ чіпає взагалі;
  * жоден латинський гліф, цифра чи символ не зачіпається — англійська 1:1;
  * пише мапу «літера → байт» для кодека і конфіг сітки плоту для ASI.

Адресація, перевірена на живих рядках гри:
    байт 0x01 — пробіл; байти від 0x20: номер запису = байт − 0x20.
Тому запис 0x8A видно як байт 0xAA, а останній (0xCB) — як 0xEB.

Атлас намальований у ПОДВІЙНОМУ розмірі, а байт ширини рахується в ігрових
пікселях — звідси ділення на 2. Стиль: рівний колір ≈130 без обводки,
форма несе альфа зі згладжуванням.

    python kh1sysfont.py --tbl US_font_data_tbl.bin --dds UK_sysfont_bin0.dds \
        --font KHMenu-Regular.otf --out build/ [--preview preview.png]
"""
import os, sys, json, argparse, struct
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'bbs'))
from raster import cell_image  # noqa: E402  (спільний растеризатор)

UPPER = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'
LOWER = 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
UA = UPPER + LOWER

ATLAS = 1024
CELL_W, CELL_H = 36, 48
PAGE_ORG = {0x00: (0, 0), 0x01: (504, 0), 0x10: (0, 480), 0x11: (504, 480)}
REC_SIZE = 16
N_RECORDS = 560
FIRST_REC = 0x8A           # 66 записів підряд: 0x8A..0xCB -> байти 0xAA..0xEB
BYTE_BIAS = 0x20           # байт = запис + 0x20

# Латиниця системного шрифту — опора для калібрування й перевірки формули ширини.
LATIN_REC = {chr(ord('A') + i): 0x0B + i for i in range(26)}
LATIN_REC.update({chr(ord('a') + i): 0x25 + i for i in range(26)})


# ─────────────────────────── читання/запис ───────────────────────────

def read_table(path):
    d = bytearray(open(path, 'rb').read())
    if len(d) != N_RECORDS * REC_SIZE:
        raise RuntimeError('%s: очікується %d Б (%d записів по %d), а є %d'
                           % (path, N_RECORDS * REC_SIZE, N_RECORDS, REC_SIZE, len(d)))
    return d


def read_dds(path):
    d = open(path, 'rb').read()
    need = 128 + ATLAS * ATLAS * 4
    if d[:4] != b'DDS ':
        raise RuntimeError('%s: не DDS' % path)
    if len(d) != need:
        raise RuntimeError('%s: очікується нестиснений 1024x1024 BGRA без мип-рівнів '
                           '(%d Б), а є %d — це не оригінал' % (path, need, len(d)))
    bgra = np.frombuffer(d[128:], np.uint8).reshape(ATLAS, ATLAS, 4).copy()
    return d[:128], bgra


def write_dds(path, header, bgra):
    with open(path, 'wb') as f:
        f.write(header)
        f.write(bgra.tobytes())


def rec_pos(tbl, i):
    r = tbl[i * REC_SIZE:(i + 1) * REC_SIZE]
    ox, oy = PAGE_ORG[r[7]]
    x = int(round(ox + struct.unpack('<H', bytes(r[2:4]))[0] / 8.0))
    y = int(round(oy + struct.unpack('<H', bytes(r[4:6]))[0] / 8.0))
    return x, y


def get_cell(bgra, tbl, i):
    x, y = rec_pos(tbl, i)
    return bgra[y:y + CELL_H, x:x + CELL_W]


def put_cell(bgra, tbl, i, rgba):
    x, y = rec_pos(tbl, i)
    bgra[y:y + CELL_H, x:x + CELL_W] = rgba[..., [2, 1, 0, 3]]


# ─────────────────────────── мірки оригіналу ───────────────────────────

def ink_bbox(cell, thr=60):
    a = cell[..., 3]
    ys, xs = np.nonzero(a > thr)
    if not len(ys):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def measure(bgra, tbl):
    """Капітель, x-висота, базова лінія, лівий відступ і колір — з латиниці."""
    H = ink_bbox(get_cell(bgra, tbl, LATIN_REC['H']))
    x = ink_bbox(get_cell(bgra, tbl, LATIN_REC['x']))
    cell = get_cell(bgra, tbl, LATIN_REC['H'])
    a = cell[..., 3]
    colour = int(np.median(cell[..., 2][a > 200])) if (a > 200).any() else 130
    widths = []
    for r in LATIN_REC.values():
        bb = ink_bbox(get_cell(bgra, tbl, r))
        if bb:
            widths.append(bb[2] - bb[0] + 1)
    stem = stem_width(get_cell(bgra, tbl, LATIN_REC['I']))
    ups = [ink_bbox(get_cell(bgra, tbl, LATIN_REC[c]))[2] - ink_bbox(get_cell(bgra, tbl, LATIN_REC[c]))[0] + 1
           for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    return dict(cap=H[3] - H[1] + 1, xh=x[3] - x[1] + 1, base=H[3] + 1,
                left=H[0], colour=colour, stem=stem, width=float(np.mean(ups)),
                all_widths=widths)


def advance_bytes(cell, pad):
    """Байт ширини з намальованої комірки (атлас 2x → ділимо навпіл)."""
    bb = ink_bbox(cell, thr=32)
    right = (bb[2] + 1) if bb else 0
    return int(max(1, min(255, round((right + pad) / 2.0))))


def fit_pad(bgra, tbl):
    """Підбираємо додаток у формулі ширини так, щоб вона відтворювала латиницю."""
    best, best_err = 2.0, None
    for pad10 in range(0, 81):
        pad = pad10 / 10.0
        errs = [advance_bytes(get_cell(bgra, tbl, r), pad) - tbl[r * REC_SIZE + 6]
                for r in LATIN_REC.values()]
        err = float(np.mean(np.abs(errs)))
        if best_err is None or err < best_err:
            best, best_err = pad, err
    errs = [advance_bytes(get_cell(bgra, tbl, r), best) - tbl[r * REC_SIZE + 6]
            for r in LATIN_REC.values()]
    return best, best_err, int(max(errs)), int(min(errs))


# ─────────────────────────── малювання ───────────────────────────

def render(ch, font_path, size, base, colour, thresh, xscale=1.0):
    cell, bb, clipped = cell_image(ch, font_path, size, 0, base, CELL_W, CELL_H,
                                   style='plain', thr=32, thresh=thresh, xscale=xscale)
    out = np.array(cell)
    out[..., 0] = out[..., 1] = out[..., 2] = colour
    return out, bb, clipped


def stem_width(cell):
    """Товщина штриха: найвужчий суцільний пробіг у середньому рядку чорнила."""
    m = cell[..., 3] > 128
    ys, _ = np.nonzero(m)
    if not len(ys):
        return 0
    row = m[(ys.min() + ys.max()) // 2]
    runs, n = [], 0
    for v in row:
        if v:
            n += 1
        elif n:
            runs.append(n); n = 0
    if n:
        runs.append(n)
    return min(runs) if runs else 0


def mean_ink_width(font_path, size, base, colour, thresh, xscale, letters):
    out = []
    for ch in letters:
        bb = ink_bbox(render(ch, font_path, size, base, colour, thresh, xscale)[0])
        if bb:
            out.append(bb[2] - bb[0] + 1)
    return float(np.mean(out)) if out else 0.0


def cap_size(font_path, meas, thresh, xscale):
    """Кегль, за якого капітель 'H' збігається з оригінальною."""
    size = float(meas['cap'])
    for _ in range(16):
        bb = ink_bbox(render('H', font_path, size, meas['base'], meas['colour'], thresh, xscale)[0])
        h = bb[3] - bb[1] + 1
        if h == meas['cap']:
            break
        size *= meas['cap'] / max(1, h)
    return size


def fit_style(font_path, meas):
    """Підганяємо кегль, стиснення і гамму так, щоб НАША латиниця збіглася з
    ігровою за капітеллю, середньою шириною і товщиною штриха. Ті самі
    параметри потім ідуть на кирилицю."""
    size, xscale, thresh = float(meas['cap']), 1.0, 110.0
    for _ in range(12):
        size = cap_size(font_path, meas, thresh, xscale)
        w = mean_ink_width(font_path, size, meas['base'], meas['colour'], thresh, xscale,
                           'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        if w > 0:
            xscale = max(0.4, min(1.6, xscale * meas['width'] / w))
        st = stem_width(render('I', font_path, size, meas['base'], meas['colour'], thresh, xscale)[0])
        if st and st != meas['stem']:
            thresh = max(40.0, min(220.0, thresh * (1.0 + 0.35 * (st - meas['stem']))))
    size = cap_size(font_path, meas, thresh, xscale)
    return size, xscale, thresh


def shift_right(cell, left):
    """Зсунути чорнило вправо на `left` пікселів — як у оригінальних гліфів."""
    if left <= 0:
        return cell
    out = np.zeros_like(cell)
    out[:, left:] = cell[:, :CELL_W - left]
    return out


# ─────────────────────────── головне ───────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tbl', required=True, help='оригінальний US_font_data_tbl.bin')
    ap.add_argument('--dds', required=True, help='оригінальний UK_sysfont_bin0.dds (без мип-рівнів)')
    ap.add_argument('--font', required=True, help='TTF/OTF з кирилицею (KHMenu-Regular.otf)')
    ap.add_argument('--out', required=True, help='тека для результатів')
    ap.add_argument('--start', type=lambda s: int(s, 0), default=FIRST_REC,
                    help='перший запис (типово 0x8A)')
    ap.add_argument('--size', type=float, help='кегль; без нього — калібрування по «H»')
    ap.add_argument('--thresh', type=float, help='гамма покриття: <100 товщає, >100 тоншає')
    ap.add_argument('--xscale', type=float, help='стиснення по горизонталі')
    ap.add_argument('--preview', help='PNG: нові літери поруч із оригінальною латиницею')
    a = ap.parse_args()

    tbl = read_table(a.tbl)
    header, bgra = read_dds(a.dds)
    meas = measure(bgra, tbl)
    pad, err, emax, emin = fit_pad(bgra, tbl)
    print('оригінал: капітель %d, x-висота %d, базова лінія %d, лівий відступ %d, '
          'колір %d, штрих %d, середня ширина A-Z %.1f'
          % (meas['cap'], meas['xh'], meas['base'], meas['left'], meas['colour'],
             meas['stem'], meas['width']))
    print('формула ширини: (правий край + %.1f) / 2 — похибка на латиниці %.2f (від %d до %d)'
          % (pad, err, emin, emax))

    recs = list(range(a.start, a.start + len(UA)))
    if recs[-1] + BYTE_BIAS > 0xFF:
        raise SystemExit('останній запис 0x%02X дав би байт 0x%X — поза межами' % (recs[-1], recs[-1] + BYTE_BIAS))
    seen = set()
    for i in recs:
        p = rec_pos(tbl, i)
        if p in seen:
            raise SystemExit('записи 0x%02X.. вказують на ту саму комірку %s' % (i, p))
        seen.add(p)

    if a.size and a.xscale and a.thresh:
        size, xscale, thresh = a.size, a.xscale, a.thresh
    else:
        size, xscale, thresh = fit_style(a.font, meas)
        if a.size: size = a.size
        if a.xscale: xscale = a.xscale
        if a.thresh: thresh = a.thresh
    ours_w = mean_ink_width(a.font, size, meas['base'], meas['colour'], thresh, xscale,
                            'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    ours_st = stem_width(render('I', a.font, size, meas['base'], meas['colour'], thresh, xscale)[0])
    print('підібрано: кегль %.2f, стиснення %.3f, гамма %.1f -> наша латиниця: '
          'ширина %.1f (ціль %.1f), штрих %d (ціль %d)'
          % (size, xscale, thresh, ours_w, meas['width'], ours_st, meas['stem']))
    print('записи 0x%02X..0x%02X -> байти 0x%02X..0x%02X'
          % (recs[0], recs[-1], recs[0] + BYTE_BIAS, recs[-1] + BYTE_BIAS))

    mapping, clipped_any, widths = {}, [], []
    for ch, i in zip(UA, recs):
        cell, bb, clipped = render(ch, a.font, size, meas['base'], meas['colour'], thresh, xscale)
        cell = shift_right(cell, meas['left'])
        if clipped:
            clipped_any.append(ch)
        w = advance_bytes(cell, pad)
        put_cell(bgra, tbl, i, cell)
        tbl[i * REC_SIZE + 6] = w
        mapping[ch] = i + BYTE_BIAS
        widths.append(w)
    print('намальовано %d літер, ширина від %d до %d%s'
          % (len(UA), min(widths), max(widths),
             (', ОБРІЗАНІ: ' + ''.join(clipped_any)) if clipped_any else ''))

    os.makedirs(a.out, exist_ok=True)
    open(os.path.join(a.out, os.path.basename(a.tbl)), 'wb').write(bytes(tbl))
    write_dds(os.path.join(a.out, os.path.basename(a.dds)), header, bgra)
    meta = {
        '_comment': ('KH1 системний шрифт: українська літера -> однобайтовий код. '
                     'байт = номер запису + 0x20; байт 0x01 — пробіл. '
                     'Згенеровано tools/py/kh1/kh1sysfont.py.'),
        'font': os.path.basename(a.font), 'size': round(size, 3),
        'thresh': round(thresh, 2), 'xscale': round(xscale, 4),
        'first_record': recs[0], 'records': len(recs), 'map': mapping,
    }
    open(os.path.join(a.out, 'kh1-sysfont-map.json'), 'w', encoding='utf-8').write(
        json.dumps(meta, ensure_ascii=False, indent=2) + '\n')

    if a.preview:
        make_preview(a.preview, bgra, tbl, recs)
    print('готово ->', a.out)


def make_preview(path, bgra, tbl, recs):
    rgba = bgra[..., [2, 1, 0, 3]]

    def strip(pairs, width=1000):
        im = Image.new('RGBA', (width, 56), (24, 24, 32, 255))
        x = 4
        for i in pairs:
            xx, yy = rec_pos(tbl, i)
            im.alpha_composite(Image.fromarray(rgba[yy:yy + CELL_H, xx:xx + CELL_W], 'RGBA'), (x, 2))
            x += tbl[i * REC_SIZE + 6] * 2
        return im

    rows = [
        ('латиниця оригіналу', [LATIN_REC[c] for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']),
        ('латиниця оригіналу', [LATIN_REC[c] for c in 'abcdefghijklmnopqrstuvwxyz']),
        ('нові великі', recs[:len(UPPER)]),
        ('нові малі', recs[len(UPPER):]),
    ]
    out = Image.new('RGB', (1000, len(rows) * 60), (45, 45, 45))
    for n, (_, ids) in enumerate(rows):
        out.paste(strip(ids).convert('RGB'), (0, n * 60))
    out.save(path)
    print('прев\'ю ->', path)


if __name__ == '__main__':
    main()
