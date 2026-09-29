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
from raster import cell_image, SS  # noqa: E402  (спільний растеризатор)

UPPER = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'
LOWER = 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
UA = UPPER + LOWER

ATLAS = 1024
CELL_W, CELL_H = 36, 48
# Атлас 1024×1024 — це чотири сторінки PS2 по 256×256, кожна збільшена вдвічі
# до 512×512 і покладена у свою чверть. Крок саме 512, а не 14·36=504 і 10·48=480:
# комірки займають лише 504×480 із 512×512, решта — поле. Помилка на ці 8 px
# з'їдала ліву частину кожного гліфа на сторінках 0x01/0x10/0x11, бо гра бере
# з атласа смужку [X, X + ширина·16] саме від X запису (FUN_1402e7060).
PAGE_ORG = {0x00: (0, 0), 0x01: (512, 0), 0x10: (0, 512), 0x11: (512, 512)}
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

def render(ch, font_path, size, base, colour, thresh, xscale=1.0, off=(0, 0)):
    cell, bb, clipped = cell_image(ch, font_path, size, 0, base, CELL_W, CELL_H,
                                   style='plain', thr=32, thresh=thresh, xscale=xscale, off=off)
    out = np.array(cell)
    out[..., 0] = out[..., 1] = out[..., 2] = colour
    return out, bb, clipped


def orig_crispness(bgra, tbl):
    """Та сама міра на ігровій латиниці — щоб було з чим порівняти."""
    v = []
    for r in LATIN_REC.values():
        a = get_cell(bgra, tbl, r)[..., 3].astype(np.float32) / 255.0
        solid = int((a >= 0.85).sum())
        if solid > 20:
            v.append(int(((a > 0.15) & (a < 0.85)).sum()) / solid)
    return float(np.mean(v)) if v else 0.0


def crispness(cell):
    """Скільки напівпрозорих пікселів припадає на суцільні.

    Ігровий шрифт намальовано по пікселях: прямий штрих — це рівно 4 суцільні
    пікселі, край різкий. Коли гліф стоїть у дробовій фазі, кожен стовбур
    дістає напівпрозорий край, а тонка перекладина взагалі розмазується між
    рядками (ми бачили альфу 0.22 замість 1.00). Менше — чіткіше.
    """
    a = cell[..., 3].astype(np.float32) / 255.0
    solid = int((a >= 0.85).sum())
    mid = int(((a > 0.15) & (a < 0.85)).sum())
    return mid / max(1, solid)


def fit_phase_y(font_path, size, base, colour, thresh, xscale, letters):
    """Одна вертикальна фаза на весь шрифт.

    По вертикалі фаза мусить бути СПІЛЬНОЮ: інакше літери сядуть на базову
    лінію з різницею до 3/4 пікселя і рядок почне стрибати. Беремо ту, що дає
    найчіткіші гліфи в середньому.
    """
    best, best_sc = 0, None
    for dy in range(SS):
        sc = []
        for ch in letters:
            out, _, clipped = render(ch, font_path, size, base, colour, thresh, xscale, (0, dy))
            if not clipped:
                sc.append(crispness(out))
        m = float(np.mean(sc)) if sc else 1e9
        if best_sc is None or m < best_sc:
            best, best_sc = dy, m
    return best, best_sc


def render_best(ch, font_path, size, base, colour, thresh, xscale, dy, stem_target):
    """Фаза + вага штриха для кожної літери окремо.

    Кегль і гамму підібрано по прямих штрихах («I»), але діагоналі («м», «ж»,
    «ш») за тієї самої гамми виходять тоншими й м'якшими — діагональ не лягає
    на піксельну сітку за визначенням. Тому для кожної літери дозволяємо
    трохи знизити гамму (потовщити), поки це РОБИТЬ ЇЇ ЧІТКІШОЮ і не робить
    штрих товщим за ігровий.
    """
    base_out = render_crisp(ch, font_path, size, base, colour, thresh, xscale, dy)
    best = (crispness(base_out[0]), base_out, thresh)
    for k in range(1, 7):
        th = thresh - k * 5
        out = render_crisp(ch, font_path, size, base, colour, th, xscale, dy)
        if stem_width(out[0]) > stem_target + 1:      # не жирніше за ігровий шрифт
            break
        sc = crispness(out[0])
        if sc < best[0] - 0.01:                        # лише відчутний виграш
            best = (sc, out, th)
    return best[1][0], best[1][1], best[1][2], best[2]


def render_crisp(ch, font_path, size, base, colour, thresh, xscale=1.0, dy=0):
    """Горизонтальну фазу підбираємо для кожної літери окремо.

    По горизонталі це безпечно: комірку однаково обрізають по лівому краю
    чорнила, тож зсув не рухає літеру на екрані — лише ловить фазу, за якої
    стовбури лягають на піксельну сітку.
    """
    best = None
    for dx in range(SS):
        out, bb, clipped = render(ch, font_path, size, base, colour, thresh, xscale, (dx, dy))
        if clipped:
            continue
        sc = crispness(out)
        if best is None or sc < best[0]:
            best = (sc, out, bb, clipped)
    if best is None:
        return render(ch, font_path, size, base, colour, thresh, xscale, (0, dy))
    return best[1], best[2], best[3]


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
    ap.add_argument('--layout', choices=['flat', 'game'], default='flat',
                    help='game: писати у <out>/original/exchange/ і '
                         '<out>/remastered/menu/<мова>/sysfont.bin/ (як у kh1_first.hed_out)')
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

    phase_y, phase_sc = fit_phase_y(a.font, size, meas['base'], meas['colour'], thresh, xscale, UA)
    print('вертикальна фаза %d/%d -> напівпрозорих на суцільний %.3f '
          '(в оригінальній латиниці %.3f)' % (phase_y, SS, phase_sc, orig_crispness(bgra, tbl)))

    mapping, clipped_any, widths, fattened = {}, [], [], []
    for ch, i in zip(UA, recs):
        cell, bb, clipped, th_used = render_best(ch, a.font, size, meas['base'], meas['colour'],
                                                 thresh, xscale, phase_y, meas['stem'])
        if th_used != thresh:
            fattened.append('%s:%g' % (ch, th_used))
        cell = shift_right(cell, meas['left'])
        if clipped:
            clipped_any.append(ch)
        w = advance_bytes(cell, pad)
        put_cell(bgra, tbl, i, cell)
        tbl[i * REC_SIZE + 6] = w
        mapping[ch] = i + BYTE_BIAS
        widths.append(w)
    if fattened:
        print('потовщено діагональні літери (літера:гамма): %s' % ' '.join(fattened))
    print('намальовано %d літер, ширина від %d до %d%s'
          % (len(UA), min(widths), max(widths),
             (', ОБРІЗАНІ: ' + ''.join(clipped_any)) if clipped_any else ''))

    # Розкладка гри: таблиця метрик лежить в original/exchange, а атлас — у
    # remastered/menu/<мова>/sysfont.bin/. Назви теки мови й контейнера беремо
    # з шляху вхідного DDS, щоб це працювало не лише для «uk».
    if a.layout == 'game':
        container = os.path.basename(os.path.dirname(a.dds))          # sysfont.bin
        locale = os.path.basename(os.path.dirname(os.path.dirname(a.dds)))  # uk
        tbl_dir = os.path.join(a.out, 'original', 'exchange')
        dds_dir = os.path.join(a.out, 'remastered', 'menu', locale, container)
    else:
        tbl_dir = dds_dir = a.out
    os.makedirs(a.out, exist_ok=True)
    os.makedirs(tbl_dir, exist_ok=True)
    os.makedirs(dds_dir, exist_ok=True)
    open(os.path.join(tbl_dir, os.path.basename(a.tbl)), 'wb').write(bytes(tbl))
    write_dds(os.path.join(dds_dir, os.path.basename(a.dds)), header, bgra)
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
    # звіт для вкладки «Шрифти UA» — окремим файлом, щоб не затерти ua_glyphs.json
    # шрифту діалогів (обидва генератори пишуть в ту саму теку build)
    report = {'sysfont': {
        'count': len(UA), 'size': round(size, 2), 'xscale': round(xscale, 3),
        'png': [ATLAS, ATLAS],
        'squeezed': clipped_any,
        'added': [{'ch': ch, 'rec': i, 'byte': '%02X' % (i + BYTE_BIAS), 'width': w}
                  for ch, i, w in zip(UA, recs, widths)],
    }}
    open(os.path.join(a.out, 'ua_sysglyphs.json'), 'w', encoding='utf-8').write(
        json.dumps(report, ensure_ascii=False, indent=1) + '\n')

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
