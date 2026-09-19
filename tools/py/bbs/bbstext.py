#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bbstext.py — увесь англійський текст Birth by Sleep в один .txt і назад.

    python3 bbstext.py unpack "D:\\...\\Image\\dt" text_all.txt
    python3 bbstext.py check  text_ua.txt "D:\\...\\Image\\dt"
    python3 bbstext.py pack   text_ua.txt "D:\\...\\Image\\dt" out_dt

Формат такий самий, як у наборі для Dream Drop Distance:

    ### bbs_fourth.hed_out\\original\\message\\en\\event\\rg\\CTrg100.ctd
    #12
    Гей! Так ти цього хотів?

`###` — шлях до файлу гри, `#N` — номер запису в ньому. Переклад пишеться
замість англійського тексту.
"""
import os, re, sys, glob, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bbsctd
try:
    from font_ids import FONT_IDS       # ID усіх гліфів, що є у FontEn.arc
except Exception:
    FONT_IDS = None

HDR = '### '
NUM = re.compile(r'^#(\d+)$')

# --- кирилиця: «переселена» на коди наявної катакани (див. cyrmap.py) ---
from cyrmap import CODES as _UA_CODES
CYR = {ch: bytes([c >> 8, c & 0xFF]) for ch, c in _UA_CODES.items()}
CYR_REV = {v: k for k, v in CYR.items()}

INV0 = {c: 0x20 + i for i, c in enumerate(bbsctd.M0)}
INV99 = {c: 0x80 + i for i, c in enumerate(bbsctd.M99)}
CMD_REV = {v: k for k, v in bbsctd.CMD.items()}


def _sjis_decode(pair):
    """Двобайтова послідовність -> символ, або None."""
    if pair in CYR_REV:
        return CYR_REV[pair]
    try:
        ch = pair.decode('cp932')
    except Exception:
        return None
    return ch if len(ch) == 1 else None


def _sjis_encode(ch):
    """Символ -> двобайтова послідовність, або None."""
    if ch in CYR:
        return CYR[ch]
    try:
        b = ch.encode('cp932')
    except Exception:
        return None
    if len(b) != 2 or b[0] == 0x99:   # 0x99 у грі означає латиницю, не кандзі
        return None
    return b


def decode(data):
    """Байти -> читабельний рядок (кирилиця з 0x84 теж)."""
    out, i, n = [], 0, len(data)
    while i < n:
        c = data[i]
        i += 1
        if c < 0x20:
            out.append('\n' if c == 0x0A else '{U+%04X}' % c); continue
        if c < 0x7F:
            ch = bbsctd.M0[c - 0x20]
            out.append('{{' if ch == '{' else ch); continue
        if c in bbsctd.CMD and i < n:
            p = data[i]; i += 1
            out.append('{%s %s}' % (bbsctd.CMD[c], bbsctd.ICON[c].get(p) or '%02x' % p)); continue
        if c in bbsctd.LEAD and i < n:
            p = data[i]; i += 1
            pair = bytes([c, p])
            if c == 0x99:            # цю сторінку гра віддала латинській діакритиці
                k = p - 0x80
                if 0 <= k < len(bbsctd.M99):
                    out.append(bbsctd.M99[k]); continue
                out.append('{sjis %02x%02x}' % (c, p)); continue
            ch = _sjis_decode(pair)
            if ch is not None and _sjis_encode(ch) == pair:
                out.append(ch); continue
            out.append('{sjis %02x%02x}' % (c, p)); continue
        out.append('{b %02x}' % c)
    return ''.join(out)


def encode(s):
    """Читабельний рядок -> байти."""
    out, i, n = bytearray(), 0, len(s)
    while i < n:
        ch = s[i]
        if ch == '{':
            if s.startswith('{{', i):
                out.append(INV0['{']); i += 2; continue
            j = s.find('}', i)
            if j < 0:
                raise ValueError('незакрита {: %r' % s[i:i + 24])
            body = s[i + 1:j]; i = j + 1
            parts = body.split(' ', 1)
            name = parts[0]; arg = parts[1] if len(parts) > 1 else ''
            if name in CMD_REV:
                lead = CMD_REV[name]
                rev = {v: k for k, v in bbsctd.ICON[lead].items()}
                if arg in rev:
                    out += bytes([lead, rev[arg]])
                else:
                    out += bytes([lead, int(arg, 16)])
            elif name in ('81', '99'):
                out += bytes([int(name, 16), int(arg or body[2:], 16)])
            elif name == 'sjis':
                out += bytes.fromhex(arg)
            elif name == 'b':
                out.append(int(arg, 16))
            elif name.startswith('U+'):
                out.append(int(name[2:], 16))
            else:
                raise ValueError('невідома вставка {%s}' % body)
            continue
        i += 1
        if ch == '\n':
            out.append(0x0A); continue
        if ch in INV0:
            out.append(INV0[ch]); continue
        pair = _sjis_encode(ch)
        if pair is not None:
            out += pair; continue
        if ch in INV99:
            out += bytes([0x99, INV99[ch]]); continue
        raise ValueError('символ %r (U+%04X) гра не вміє показати' % (ch, ord(ch)))
    return bytes(out)


def missing_glyphs(raw):
    """Символи, для яких у шрифті немає гліфа (звіряється з font_ids.py —
    тримай його синхронним із пропатченим FontEn.arc)."""
    if FONT_IDS is None:
        return set()
    out, i, n = set(), 0, len(raw)
    while i < n:
        c = raw[i]; i += 1
        if c < 0x20 or c in bbsctd.CMD:
            if c in bbsctd.CMD:
                i += 1
            continue
        if c < 0x7F:
            continue                    # ASCII рушій мапить сам
        if c in bbsctd.LEAD and i < n:
            p = raw[i]; i += 1
            cid = (c << 8) | p
            if cid not in FONT_IDS:
                out.add('%04X' % cid)
    return out


def translatable(t):
    if not t:
        return False
    bare = re.sub(r'\{[^}]*\}', '', t).strip()
    return bool(bare) and bool(re.search(r'[^\W\d_]', bare, re.UNICODE))


def find_ctd(root):
    out = []
    for p in glob.glob(os.path.join(root, '**', '*.ctd'), recursive=True):
        parts = os.path.relpath(p, root).replace('\\', '/').split('/')
        if 'en' in parts and 'message' in parts:
            out.append(p)
    return sorted(out)


def cmd_unpack(a):
    files = find_ctd(a.root)
    if not files:
        sys.exit('не знайдено .ctd у message\\en всередині %s' % a.root)
    n = skipped = 0
    with open(a.out, 'w', encoding='utf-8', newline='\n') as fh:
        for fi, p in enumerate(files):
            if fi:
                fh.write('\n')
            d = bbsctd.read(p)
            fh.write(HDR + os.path.relpath(p, a.root).replace('/', '\\') + '\n')
            for i, m in enumerate(d['messages']):
                t = decode(m['raw'])
                if not a.all and not translatable(t):
                    skipped += 1
                    continue
                fh.write('#%d\n%s\n' % (i, t))
                n += 1
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
            flush(); buf = []
            ident = int(NUM.match(ln).group(1))
        else:
            if cur is None or ident is None:
                if ln.strip():
                    raise SystemExit('рядок %d: текст без маркера "#N":\n  %s' % (no, ln))
                continue
            buf.append(ln)
    flush(True)
    return [(k, files[k]) for k in order]


def apply_txt(txt, root):
    res, problems, warnings = {}, [], []
    for relp, items in parse_txt(txt):
        src = os.path.join(root, relp.replace('\\', os.sep))
        if not os.path.exists(src):
            problems.append('немає оригіналу: %s' % relp); continue
        d = bbsctd.read(src)
        changed = 0
        for idx, text in items:
            if not 0 <= idx < len(d['messages']):
                problems.append('%s: #%d немає в оригіналі' % (relp, idx)); continue
            try:
                raw = encode(text)
            except Exception as ex:
                problems.append('%s #%d: %s' % (relp, idx, ex)); continue
            miss = missing_glyphs(raw)
            if miss:
                warnings.append('%s #%d: у шрифті немає гліфа для %s'
                                % (relp, idx, ', '.join('0x' + m for m in sorted(miss))))
            if raw != d['messages'][idx]['raw']:
                d['messages'][idx]['raw'] = raw
                changed += 1
        try:
            blob = bbsctd.write(d)
        except Exception as ex:
            problems.append('%s: %s' % (relp, ex)); continue
        res[relp] = (blob, changed, len(d['messages']))
    return res, problems, warnings


def cmd_pack(a):
    res, problems, warnings = apply_txt(a.txt, a.root)
    tot = ch = 0
    for relp, (blob, changed, n) in sorted(res.items()):
        dst = os.path.join(a.out, relp.replace('\\', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(blob)
        tot += n; ch += changed
        if changed:
            print('  %-60s %4d/%-4d %7d Б' % (relp, changed, n, len(blob)))
    print('зібрано %d файлів, перекладено %d із %d рядків -> %s' % (len(res), ch, tot, a.out))
    _report(problems, warnings)
    return 1 if problems else 0


def _report(problems, warnings):
    if problems:
        print('ПРОБЛЕМИ (%d) — ці рядки не зібрано:' % len(problems))
        for p in problems[:40]:
            print('  -', p)
        if len(problems) > 40:
            print('  ... ще %d' % (len(problems) - 40))
    if warnings:
        print('попереджень (%d): символи без гліфа у шрифті — вони є і в оригіналі гри'
              % len(warnings))
        for w in warnings[:5]:
            print('  ~', w)
        if len(warnings) > 5:
            print('  ... ще %d' % (len(warnings) - 5))


def cmd_check(a):
    res, problems, warnings = apply_txt(a.txt, a.root)
    print('перевірено %d файлів' % len(res))
    _report(problems, warnings)
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
    a = ap.parse_args()
    sys.exit(a.func(a) or 0)
