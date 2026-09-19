#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pack_ua.py — запакувати перекладений text_all.txt назад у .ctd.

Оригінальні .ctd беруться як основа: підставляється ЛИШЕ текст, а розкладка
вікон (layout), ID повідомлень і порядок записів лишаються недоторканими.
Зіпсувати структуру файлу через .txt неможливо.

Запуск без аргументів бере шляхи за замовчуванням (див. нижче):

    python pack_ua.py

Або явно:

    python pack_ua.py --txt text_all.txt ^
                      --game "D:\\...\\Image\\dt" ^
                      --out  "...\\build\\kh3d_first\\original\\message\\en"

Ключі:
    --dry     нічого не писати, лише перевірити
    --flat    класти файли просто в --out (за замовчуванням: зберігати
              підтеки після message\\en, напр. event\\rg\\bin\\ctrg300.ctd)
"""
import os, re, sys, argparse, io

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import khctd

# --------------------------------------------------------------- defaults
DEF_TXT = r'C:\Users\dmytryk\Desktop\DropDistanceHD\KH3D_UA_Toolkit\text_all.txt'
DEF_GAME = r'D:\SteamLibrary\steamapps\common\KINGDOM HEARTS HD 2.8 Final Chapter Prologue\Image\dt'
DEF_OUT = r'C:\Users\dmytryk\Desktop\DropDistanceHD\KH3D_UA_Toolkit\build\kh3d_first\original\message\en'

HDR = '### '
IDM = '@0x'
NUM = re.compile(r'^#(\d+)$')
MARK = '\\message\\en\\'


def norm(p):
    return p.replace('/', os.sep).replace('\\', os.sep)


def parse_txt(path):
    """### <шлях> / @0xID / текст  ->  [(relpath, [(id, text), ...]), ...]"""
    with io.open(path, encoding='utf-8-sig') as fh:
        lines = fh.read().replace('\r\n', '\n').replace('\r', '\n').split('\n')
    if lines and lines[-1] == '':
        lines.pop()

    files, order = {}, []
    cur = ident = None
    buf = []

    def flush(boundary=False):
        if ident is not None:
            if boundary and buf and buf[-1] == '':
                buf.pop()                     # рівно один роздільник перед ###
            files[cur].append((ident, '\n'.join(buf)))

    for no, ln in enumerate(lines, 1):
        if ln.startswith(HDR):
            flush(True); ident = None; buf = []
            cur = ln[len(HDR):].strip().replace('/', '\\')
            if cur not in files:
                files[cur] = []; order.append(cur)
        elif NUM.match(ln):
            flush(); buf = []
            ident = int(NUM.match(ln).group(1))
        elif (ln.startswith(IDM) and len(ln) > 3
              and all(c in '0123456789abcdefABCDEF' for c in ln[3:])):
            flush(); buf = []
            ident = '0x%08X' % int(ln[3:], 16)
        else:
            if cur is None:
                if ln.strip():
                    raise SystemExit('рядок %d: текст до першого "### <шлях>"' % no)
                continue
            if ident is None:
                if ln.strip():
                    raise SystemExit('рядок %d: текст без маркера "#N" перед ним:\n  %s' % (no, ln))
                continue
            buf.append(ln)
    flush(True)
    return [(k, files[k]) for k in order]


def out_path(out_dir, relp, flat):
    i = relp.lower().find(MARK)
    tail = relp[i + len(MARK):] if i >= 0 else os.path.basename(relp)
    if flat:
        tail = os.path.basename(tail)
    return os.path.join(out_dir, norm(tail))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--txt', default=DEF_TXT)
    ap.add_argument('--game', default=DEF_GAME)
    ap.add_argument('--out', default=DEF_OUT)
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--flat', action='store_true')
    a = ap.parse_args()

    for p, what in ((a.txt, 'text_all.txt'), (a.game, 'тека гри Image\\dt')):
        if not os.path.exists(p):
            raise SystemExit('не знайдено %s: %s' % (what, p))

    data = parse_txt(a.txt)
    print('%s: %d файлів, %d рядків' % (os.path.basename(a.txt),
                                        len(data), sum(len(v) for _, v in data)))

    written = changed_tot = total = 0
    problems = []
    for relp, items in data:
        src = os.path.join(a.game, norm(relp))
        if not os.path.exists(src):
            problems.append('немає оригіналу: %s' % relp); continue
        doc = khctd.read(src)

        by_id = {}
        for ident, text in items:
            by_id.setdefault(ident, []).append(text)
        seen, changed = {}, 0
        known = set(e['id'] for e in doc['entries']) | set(range(len(doc['entries'])))
        for ident in by_id:
            if ident not in known:
                problems.append('%s: маркер %s немає в оригіналі'
                                % (relp, ('#%d' % ident) if isinstance(ident, int) else ident))
        for i, e in enumerate(doc['entries']):
            lst = by_id.get(i)
            key = i
            if lst is None:
                lst = by_id.get(e['id']); key = e['id']
            if not lst:
                continue
            k = seen.get(key, 0)
            if k >= len(lst):
                continue
            seen[key] = k + 1
            if lst[k] != e['text']:
                e['text'] = lst[k]
                changed += 1
        total += len(doc['entries'])
        changed_tot += changed

        try:
            blob = khctd.write(doc)
        except Exception as ex:
            problems.append('%s: %s' % (relp, ex)); continue

        # контроль: перечитуємо результат і звіряємо зі вхідними даними
        if not verify(blob, doc):
            problems.append('%s: контроль перечитуванням не пройдено' % relp); continue

        dst = out_path(a.out, relp, a.flat)
        if not a.dry:
            d = os.path.dirname(dst)
            if d:
                os.makedirs(d, exist_ok=True)
            with open(dst, 'wb') as fh:
                fh.write(blob)
        written += 1
        if changed:
            print('  %-46s %4d/%-4d  %7d Б' % (os.path.relpath(dst, a.out).replace(os.sep, '\\'),
                                               changed, len(doc['entries']), len(blob)))

    print('')
    print('перекладено рядків: %d з %d' % (changed_tot, total))
    if problems:
        print('ПРОБЛЕМИ (%d):' % len(problems))
        for p in problems[:40]:
            print('  -', p)
        if len(problems) > 40:
            print('  ... ще %d' % (len(problems) - 40))
    if a.dry:
        print('--dry: нічого не записано')
    else:
        print('записано %d файлів -> %s' % (written, a.out))
    return 1 if problems else 0


def verify(blob, doc):
    """Перечитати щойно зібраний файл і звірити з тим, що мало вийти."""
    import tempfile
    fd, p = tempfile.mkstemp(suffix='.ctd')
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(blob)
        chk = khctd.read(p)
    finally:
        try:
            os.remove(p)
        except OSError:
            pass
    for k in ('id', 'text', 'layout'):
        if [e[k] for e in chk['entries']] != [e[k] for e in doc['entries']]:
            return False
    return chk['layouts'] == doc['layouts']


if __name__ == '__main__':
    try:
        rc = main()
    except SystemExit as e:
        print(e); rc = 1
    sys.exit(rc)
