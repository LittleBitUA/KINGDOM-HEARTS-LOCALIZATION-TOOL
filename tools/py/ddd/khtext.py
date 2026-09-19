#!/usr/bin/env python3
"""
khtext.py — увесь англійський текст гри в одному .txt і назад.

    # витягти весь текст з англійських (en) директорій
    python3 khtext.py unpack "D:\\...\\Image\\dt" text_all.txt

    # зібрати перекладений .txt назад у .ctd (структура шляхів зберігається)
    python3 khtext.py pack text_all.txt "D:\\...\\Image\\dt" out_dt

    # перевірити, що переклад коректний, нічого не зламано
    python3 khtext.py check text_all.txt "D:\\...\\Image\\dt"

ФОРМАТ text_all.txt (UTF-8):

    ### kh3d_first.hed_out\\original\\message\\en\\event\\rg\\bin\\ctrg300.ctd
    @0x0E968000
    Hey! Is this how you wanted it?
    @0x0E968100
    Two lines
    look like this

Українську пишемо ПОВЕРХ англійського тексту, рядки `###` і `@0x…` не чіпаємо.
Порожній рядок одразу після `@0x…` = порожній текст.
Службові вставки лишаються як є: {PLAYER}, {BTN_A}, {U+E028}; `{{` = сама дужка `{`.
"""
import os, re, sys, glob, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import khctd

HDR = '### '
IDM = '@0x'
NUM = re.compile(r'^#(\d+)$')


def translatable(text):
    """Чи є що перекладати: не порожньо і є хоч одна літера поза {вставками}."""
    if not text:
        return False
    bare = re.sub(r'\{[^}]*\}', '', text).strip()
    return bool(bare) and bool(re.search(r'[^\W\d_]', bare, re.UNICODE))


def find_ctd(root):
    """усі .ctd, що лежать всередині директорії en/"""
    out = []
    for p in glob.glob(os.path.join(root, '**', '*.ctd'), recursive=True):
        parts = os.path.relpath(p, root).replace('\\', '/').split('/')
        if 'en' in parts:
            out.append(p)
    return sorted(out)


def rel(root, p):
    return os.path.relpath(p, root).replace('/', '\\')


def cmd_unpack(a):
    files = find_ctd(a.root)
    if not files:
        sys.exit('не знайдено жодного .ctd всередині директорій en/ у %s' % a.root)
    n = skipped = 0
    with open(a.out, 'w', encoding='utf-8', newline='\n') as fh:
        for fi, p in enumerate(files):
            if fi:
                fh.write('\n')          # порожній рядок-роздільник між файлами
            doc = khctd.read(p)
            fh.write(HDR + rel(a.root, p) + '\n')
            for i, e in enumerate(doc['entries']):
                if not a.all and not translatable(e['text']):
                    skipped += 1
                    continue
                fh.write(('@' + e['id'] if a.ids else '#%d' % i) + '\n')
                fh.write(e['text'] + '\n')
                n += 1
    print('витягнуто %d рядків із %d файлів -> %s%s'
          % (n, len(files), a.out,
             ('  (пропущено %d неперекладних)' % skipped) if skipped else ''))


def parse_txt(path):
    """-> {relpath: [(id, text), ...]} у порядку появи"""
    cur, out = None, {}
    ident, buf = None, []
    with open(path, encoding='utf-8') as fh:
        lines = fh.read().split('\n')
    if lines and lines[-1] == '':
        lines.pop()

    def flush(boundary=False):
        if ident is not None:
            if boundary and buf and buf[-1] == '':
                buf.pop()          # рівно один роздільник перед наступним ###
            out[cur].append((ident, '\n'.join(buf)))

    for ln in lines:
        if ln.startswith(HDR):
            flush(True); ident, buf = None, []
            cur = ln[len(HDR):].strip()
            out.setdefault(cur, [])
        elif NUM.match(ln):
            flush(); buf = []
            ident = int(NUM.match(ln).group(1))
        elif ln.startswith(IDM) and len(ln) >= 4 and all(c in '0123456789abcdefABCDEF' for c in ln[3:]):
            flush(); buf = []
            ident = '0x%08X' % int(ln[3:], 16)
        else:
            if ident is None:
                if ln.strip():
                    raise ValueError('текст поза записом: %r' % ln)
                continue
            buf.append(ln)
    flush(True)
    return out


def apply(txt, root, verbose=True):
    """-> {relpath: (bytes, changed, total)}"""
    data = parse_txt(txt)
    res = {}
    for relp, items in data.items():
        src = os.path.join(root, relp.replace('\\', os.sep))
        if not os.path.exists(src):
            raise FileNotFoundError(src)
        doc = khctd.read(src)
        changed = 0
        by_id = {}
        for ident, text in items:
            by_id.setdefault(ident, []).append(text)
        seen = {}
        for i, e in enumerate(doc['entries']):
            lst = by_id.get(i)
            if lst is None:
                lst = by_id.get(e['id'])
                key = e['id']
            else:
                key = i
            if not lst:
                continue
            k = seen.get(key, 0)
            if k >= len(lst):
                continue
            seen[key] = k + 1
            if lst[k] != e['text']:
                e['text'] = lst[k]
                changed += 1
        res[relp] = (khctd.write(doc), changed, len(doc['entries']))
    return res


def cmd_pack(a):
    res = apply(a.txt, a.root)
    tot = ch = 0
    for relp, (blob, changed, n) in sorted(res.items()):
        dst = os.path.join(a.out, relp.replace('\\', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(blob)
        tot += n; ch += changed
        if changed:
            print('  %-70s %d/%d змінено, %d Б' % (relp, changed, n, len(blob)))
    print('зібрано %d файлів, %d із %d рядків перекладено -> %s' % (len(res), ch, tot, a.out))


def cmd_check(a):
    res = apply(a.txt, a.root)
    bad = 0
    for relp, (blob, changed, n) in sorted(res.items()):
        tmp = '/tmp/_chk.ctd'
        open(tmp, 'wb').write(blob)
        try:
            back = khctd.read(tmp)
        except Exception as ex:
            print('ПОМИЛКА', relp, ex); bad += 1; continue
        src = khctd.read(os.path.join(a.root, relp.replace('\\', os.sep)))
        if len(back['entries']) != len(src['entries']) or back['layouts'] != src['layouts']:
            print('СТРУКТУРА ЗЛАМАНА', relp); bad += 1
    print('перевірено %d файлів, проблемних: %d' % (len(res), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('unpack'); p.add_argument('root'); p.add_argument('out')
    p.add_argument('--all', action='store_true', help='включно з порожніми та службовими рядками')
    p.add_argument('--ids', action='store_true', help='маркери @0xID замість коротких #N')
    p.set_defaults(func=cmd_unpack)
    p = sp.add_parser('pack'); p.add_argument('txt'); p.add_argument('root'); p.add_argument('out'); p.set_defaults(func=cmd_pack)
    p = sp.add_parser('check'); p.add_argument('txt'); p.add_argument('root'); p.set_defaults(func=cmd_check)
    a = ap.parse_args()
    sys.exit(a.func(a) or 0)
