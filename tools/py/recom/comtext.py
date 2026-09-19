# -*- coding: utf-8 -*-
"""comtext.py — увесь англійський текст Re:Chain of Memories в один .txt і назад.

    python3 comtext.py unpack "<...>\\Recom.hed_out" text_all.txt
    python3 comtext.py check  text_ua.txt "<...>\\Recom.hed_out"
    python3 comtext.py pack   text_ua.txt "<...>\\Recom.hed_out" out

Формат такий самий, як у наборах для DDD і BBS:

    ### remastered\\SYS\\0001\\SY0001.CTD\\UK_CT0000.ctdl
    #12
    Гей! Так ти цього хотів?
"""
import os, re, sys, glob, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comctd

HDR = '### '
NUM = re.compile(r'^#(\d+)$')

# однобайтові керівні коди
CMD = {0xF9: 'color', 0xF5: 'icon'}
# двобайтові коди, які реально трапляються в англійському тексті
SJIS = {
    0x8140: '　', 0x815C: '―', 0x8167: '“', 0x8168: '”',
    0x819A: '◆', 0x81A1: '●', 0x81A6: '※', 0x81F4: '∥',
    0x83C3: 'é', 0x8765: '®',
}
# українські літери «переселені» на коди хіраґани — див. cyrmap.py
from cyrmap import CODES as _UA
SJIS.update({v: k for k, v in _UA.items()})
SJIS_REV = {v: k for k, v in SJIS.items()}

# зручності для перекладача: те, що клавіатура дає «красиво», а гра не має.
# Працює лише на вході; назад текст виходить у канонічному вигляді гри.
SOFT = {
    '—': b'\x81\x5c\x81\xf4',   # довге тире гри — це пара ―∥
    '–': b'-', '‒': b'-', '−': b'-',
    '’': b"'", '‘': b"'", '\u02bc': b"'",
    '“': b'\x81\x67', '”': b'\x81\x68',
    '«': b'\x81\x67', '»': b'\x81\x68',
    '…': b'...',
    '\u00a0': b' ',
}
LEAD = {0x81, 0x82, 0x83, 0x84, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8D,
        0x8E, 0x8F, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
        0x99, 0x9A, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F}


def _is_pair(raw, i):
    """Чи це двобайтовий код? Другий байт має бути справжнім хвостом Shift-JIS."""
    if raw[i] not in LEAD or i + 1 >= len(raw):
        return False
    t = raw[i + 1]
    return 0x40 <= t <= 0xFC and t != 0x7F


def decode(raw):
    out, i, n = [], 0, len(raw)
    while i < n:
        c = raw[i]; i += 1
        if c == 0x0A:
            out.append('\n'); continue
        if c in CMD and i < n:
            out.append('{%s %02x}' % (CMD[c], raw[i])); i += 1; continue
        if c == 0x7B:
            out.append('{{'); continue
        if 0x20 <= c < 0x7F:
            out.append(chr(c)); continue
        if _is_pair(raw, i - 1):
            code = (c << 8) | raw[i]; i += 1
            out.append(SJIS.get(code) or '{sjis %04x}' % code); continue
        out.append('{b %02x}' % c)
    return ''.join(out)


def encode(s):
    out, i, n = bytearray(), 0, len(s)
    while i < n:
        ch = s[i]
        if ch == '{':
            if s.startswith('{{', i):
                out.append(0x7B); i += 2; continue
            j = s.find('}', i)
            if j < 0:
                raise ValueError('незакрита {: %r' % s[i:i + 24])
            body = s[i + 1:j]; i = j + 1
            name, _, arg = body.partition(' ')
            if name == 'color':
                out += bytes([0xF9, int(arg, 16)])
            elif name == 'icon':
                out += bytes([0xF5, int(arg, 16)])
            elif name == 'sjis':
                out += bytes.fromhex(arg or body[4:])
            elif name == 'b':
                out.append(int(arg, 16))
            else:
                raise ValueError('невідома вставка {%s}' % body)
            continue
        i += 1
        if ch == '\n':
            out.append(0x0A); continue
        if ch in SJIS_REV:
            c = SJIS_REV[ch]; out += bytes([c >> 8, c & 0xFF]); continue
        o = ord(ch)
        if 0x20 <= o < 0x7F:
            out.append(o); continue
        if ch in SOFT:
            out += SOFT[ch]; continue
        raise ValueError('символ %r (U+%04X) не має коду' % (ch, o))
    return bytes(out)


def translatable(t):
    bare = re.sub(r'\{[^}]*\}', '', t).strip()
    return bool(bare) and bool(re.search(r'[A-Za-z]', bare))


def find_files(root):
    return sorted(glob.glob(os.path.join(root, 'remastered', '**', 'UK_*.ctdl'),
                            recursive=True))


def collect_unique(root):
    """Упорядкований список унікальних рядків.

    Порядок детермінований (файли за іменем, повідомлення за номером), тому
    ті самі номери виходять і під час витягання, і під час пакування — окрема
    таблиця відповідності не потрібна.
    Повертає: список (текст, перший_файл), словник текст -> номер,
    словник текст -> [(файл, номер повідомлення), ...]
    """
    order, ids, where = [], {}, {}
    for p in find_files(root):
        rel = os.path.relpath(p, root).replace('/', '\\')
        for i, m in enumerate(comctd.parse(open(p, 'rb').read(), p)['messages']):
            t = decode(m)
            if t not in ids:
                ids[t] = len(order); order.append((t, rel)); where[t] = []
            where[t].append((rel, i))
    return order, ids, where


def cmd_uniq(a):
    order, ids, where = collect_unique(a.root)
    n = skipped = 0
    prev = None
    with open(a.out, 'w', encoding='utf-8', newline='\n') as fh:
        for k, (t, rel) in enumerate(order):
            if not a.all and not translatable(t):
                skipped += 1; continue
            if rel != prev:
                if prev is not None:
                    fh.write('\n')
                fh.write(HDR + rel + '\n'); prev = rel
            fh.write('#%d\n%s\n' % (k, t)); n += 1
    tot = sum(len(v) for v in where.values())
    print('унікальних рядків %d із %d (у %.1f разу менше) -> %s (пропущено %d неперекладних)'
          % (n, tot, tot / max(n, 1), a.out, skipped))


def cmd_packuniq(a):
    order, ids, where = collect_unique(a.root)
    trans = {}
    for _, items in parse_txt(a.txt):
        for k, t in items:
            if not 0 <= k < len(order):
                sys.exit('номер #%d поза межами (унікальних %d)' % (k, len(order)))
            trans[k] = t
    # розгортаємо переклад на всі входження
    byfile = {}
    for k, t in trans.items():
        for rel, i in where[order[k][0]]:
            byfile.setdefault(rel, []).append((i, t))
    res, problems, ch, tot = {}, [], 0, 0
    for rel, items in byfile.items():
        src = os.path.join(a.root, rel.replace('\\', os.sep))
        d = comctd.parse(open(src, 'rb').read(), src)
        for i, t in items:
            try:
                raw = encode(t)
            except Exception as ex:
                problems.append('%s #%d: %s' % (rel, i, ex)); continue
            if raw != d['messages'][i]:
                d['messages'][i] = raw; ch += 1
        dst = os.path.join(a.out, rel.replace('\\', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(comctd.write(d))
        tot += len(d['messages'])
    print('зібрано %d файлів, підставлено %d входжень із %d унікальних рядків -> %s'
          % (len(byfile), ch, len(trans), a.out))
    _report(problems)
    return 1 if problems else 0


def cmd_unpack(a):
    files = find_files(a.root)
    if not files:
        sys.exit('не знайдено UK_*.ctdl у %s' % a.root)
    n = skipped = 0
    with open(a.out, 'w', encoding='utf-8', newline='\n') as fh:
        for fi, p in enumerate(files):
            d = comctd.parse(open(p, 'rb').read(), p)
            rel = os.path.relpath(p, a.root).replace('/', '\\')
            wrote = False
            for i, m in enumerate(d['messages']):
                t = decode(m)
                if not a.all and not translatable(t):
                    skipped += 1; continue
                if not wrote:
                    if fi:
                        fh.write('\n')
                    fh.write(HDR + rel + '\n'); wrote = True
                fh.write('#%d\n%s\n' % (i, t)); n += 1
    print('витягнуто %d рядків із %d файлів -> %s (пропущено %d неперекладних)'
          % (n, len(files), a.out, skipped))


def parse_txt(path):
    with open(path, encoding='utf-8-sig') as fh:
        lines = fh.read().replace('\r\n', '\n').replace('\r', '\n').split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    files, order, cur, ident, buf = {}, [], None, None, []

    def flush(boundary=False):
        if ident is not None:
            if boundary and buf and buf[-1] == '':
                buf.pop()
            files[cur].append((ident, '\n'.join(buf)))

    for no, ln in enumerate(lines, 1):
        if ln.startswith(HDR):
            flush(True); ident, buf = None, []
            cur = ln[len(HDR):].strip().replace('/', '\\')
            if cur not in files:
                files[cur] = []; order.append(cur)
        elif NUM.match(ln):
            flush(); buf = []; ident = int(NUM.match(ln).group(1))
        else:
            if cur is None or ident is None:
                if ln.strip():
                    raise SystemExit('рядок %d: текст без маркера "#N"' % no)
                continue
            buf.append(ln)
    flush(True)
    return [(k, files[k]) for k in order]


def apply_txt(txt, root):
    res, problems = {}, []
    for relp, items in parse_txt(txt):
        src = os.path.join(root, relp.replace('\\', os.sep))
        if not os.path.exists(src):
            problems.append('немає оригіналу: %s' % relp); continue
        d = comctd.parse(open(src, 'rb').read(), src)
        changed = 0
        for idx, text in items:
            if not 0 <= idx < len(d['messages']):
                problems.append('%s: #%d немає в оригіналі' % (relp, idx)); continue
            try:
                raw = encode(text)
            except Exception as ex:
                problems.append('%s #%d: %s' % (relp, idx, ex)); continue
            if raw != d['messages'][idx]:
                d['messages'][idx] = raw; changed += 1
        try:
            blob = comctd.write(d)
        except Exception as ex:
            problems.append('%s: %s' % (relp, ex)); continue
        res[relp] = (blob, changed, len(d['messages']))
    return res, problems


def cmd_pack(a):
    res, problems = apply_txt(a.txt, a.root)
    tot = ch = 0
    for relp, (blob, changed, n) in sorted(res.items()):
        dst = os.path.join(a.out, relp.replace('\\', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(blob)
        tot += n; ch += changed
    print('зібрано %d файлів, перекладено %d із %d рядків -> %s'
          % (len(res), ch, tot, a.out))
    _report(problems)
    return 1 if problems else 0


def _report(problems):
    if problems:
        print('ПРОБЛЕМИ (%d):' % len(problems))
        for p in problems[:40]:
            print('  -', p)
        if len(problems) > 40:
            print('  ... ще %d' % (len(problems) - 40))


def cmd_check(a):
    res, problems = apply_txt(a.txt, a.root)
    print('перевірено %d файлів' % len(res))
    _report(problems)
    if not problems:
        print('усе гаразд')
    return 1 if problems else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('unpack'); p.add_argument('root'); p.add_argument('out')
    p.add_argument('--all', action='store_true'); p.set_defaults(func=cmd_unpack)
    p = sp.add_parser('pack'); p.add_argument('txt'); p.add_argument('root'); p.add_argument('out')
    p.set_defaults(func=cmd_pack)
    p = sp.add_parser('check'); p.add_argument('txt'); p.add_argument('root')
    p.set_defaults(func=cmd_check)
    p = sp.add_parser('uniq'); p.add_argument('root'); p.add_argument('out')
    p.add_argument('--all', action='store_true'); p.set_defaults(func=cmd_uniq)
    p = sp.add_parser('packuniq'); p.add_argument('txt'); p.add_argument('root')
    p.add_argument('out'); p.set_defaults(func=cmd_packuniq)
    a = ap.parse_args()
    sys.exit(a.func(a) or 0)
