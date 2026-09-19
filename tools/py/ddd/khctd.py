#!/usr/bin/env python3
"""
khctd.py — @CTD text container reader/writer for
Kingdom Hearts 3D: Dream Drop Distance HD (KH 2.8).

FORMAT (little endian)
---------------------
header, 0x20 bytes
    0x00  char[4]  "@CTD"
    0x04  u32      version            (always 0x000001F7)
    0x08  u32      baseId             (id of the first entry)
    0x0C  u16      layoutCount
    0x0E  u16      entryCount
    0x10  u32      entryTableOffset   (always 0x20)
    0x14  u32      layoutTableOffset
    0x18  u32      textOffset         (start of the string blob)
    0x1C  u32      reserved (0)

entry table, entryCount * 8 bytes, padded to 0x10
    0x00  u32      messageId
    0x04  u16      textOffsetLow      (low 16 bits of the file offset)
    0x06  u16      layoutIndex << 4 | textOffsetPage
                   -> layout record  = layoutIndex
                   -> string address = textOffsetLow + textOffsetPage * 0x10000

layout table, layoutCount * 20 bytes, padded to 0x10
    per-message text box placement (x, y, w, h, font, flags ...). Opaque here:
    preserved byte for byte, since translation never needs to change it.

string blob
    UTF-16LE, each string NUL(0x0000) terminated, packed back to back.
    0x000A          = line break
    U+E000..U+EFFF  = in-game icons / button glyphs / dynamic values
"""
import os, sys, json, struct, glob, argparse

MAGIC = b'@CTD'
U = lambda b, o: struct.unpack_from('<H', b, o)[0]
L = lambda b, o: struct.unpack_from('<I', b, o)[0]

# Human-readable names for the private-use codepoints that show up in the
# English script. Anything not listed round-trips as {U+XXXX}.
TAGS = {
    0xE028: 'PLAYER', 0xE026: 'PARTY', 0xE023: 'VAL1', 0xE024: 'VAL2', 0xE025: 'VAL3',
    0xE3D0: 'BTN_A', 0xE3D1: 'BTN_B', 0xE3D2: 'BTN_X', 0xE3D3: 'BTN_Y',
    0xE3D4: 'BTN_L', 0xE3D5: 'BTN_R', 0xE3D6: 'BTN_ZL', 0xE3D7: 'BTN_ZR',
    0xE3DC: 'STICK', 0xE3DD: 'CSTICK', 0xE3E7: 'DPAD', 0xE3E8: 'TOUCH',
}
RTAGS = {v: k for k, v in TAGS.items()}


def enc_text(codes):
    out = []
    for c in codes:
        if c == 0x0A:
            out.append('\n')
        elif c == 0x7B:
            out.append('{{')
        elif 0x20 <= c < 0xE000 or c in (0x09,):
            out.append(chr(c))
        elif c in TAGS:
            out.append('{%s}' % TAGS[c])
        else:
            out.append('{U+%04X}' % c)
    return ''.join(out)


def dec_text(s):
    codes, i = [], 0
    while i < len(s):
        ch = s[i]
        if ch == '{':
            if s.startswith('{{', i):
                codes.append(0x7B); i += 2; continue
            j = s.find('}', i)
            if j < 0:
                raise ValueError('unclosed { at %d in %r' % (i, s))
            name = s[i + 1:j]
            if name in RTAGS:
                codes.append(RTAGS[name])
            elif name.startswith('U+'):
                codes.append(int(name[2:], 16))
            else:
                raise ValueError('unknown tag {%s}' % name)
            i = j + 1
            continue
        cp = ord(ch)
        if cp > 0xFFFF:
            raise ValueError('character %r is outside the BMP and cannot be stored' % ch)
        codes.append(cp)
        i += 1
    return codes


def read(path):
    b = open(path, 'rb').read()
    assert b[:4] == MAGIC, '%s is not a @CTD file' % path
    ver, baseId = L(b, 4), L(b, 8)
    nlay, nent = U(b, 12), U(b, 14)
    eo, lo, to = L(b, 16), L(b, 20), L(b, 24)
    entries = []
    for i in range(nent):
        o = eo + i * 8
        mid = L(b, o)
        raw, fld = U(b, o + 4), U(b, o + 6)
        addr = raw + (fld & 0xF) * 0x10000
        e = addr
        codes = []
        while True:
            c = U(b, e); e += 2
            if c == 0:
                break
            codes.append(c)
        entries.append(dict(id='0x%08X' % mid, layout=fld >> 4, text=enc_text(codes)))
    layouts = b[lo:lo + nlay * 20]
    # retail files pad the tail with MSVC filler; keep it for exact round trips
    end = max((a + 2 for a in _ends(b, eo, nent)), default=len(b))
    return dict(version=ver, baseId='0x%08X' % baseId, tailPad=b[end:].hex(),
                layouts=layouts.hex(), entries=entries)


def _ends(b, eo, nent):
    for i in range(nent):
        o = eo + i * 8
        e = U(b, o + 4) + (U(b, o + 6) & 0xF) * 0x10000
        while U(b, e) != 0:
            e += 2
        yield e


def write(doc, dedupe=False):
    ver = doc['version']
    baseId = int(doc['baseId'], 16)
    ents = doc['entries']
    layouts = bytes.fromhex(doc['layouts'])
    nent = len(ents)
    nlay = len(layouts) // 20

    eo = 0x20
    lo = (eo + nent * 8 + 0xF) & ~0xF
    to = (lo + len(layouts) + 0xF) & ~0xF

    # string blob; identical strings are shared
    blob = bytearray()
    pos = {}
    addrs = []
    for e in ents:
        codes = dec_text(e['text'])
        key = tuple(codes)
        if dedupe and key in pos:
            addrs.append(pos[key])
        else:
            a = to + len(blob)
            pos[key] = a
            addrs.append(a)
            for c in codes:
                blob += struct.pack('<H', c)
            blob += b'\0\0'
    total = to + len(blob)
    if total > 0x100000:
        raise ValueError('text block too large (%d bytes); the format can address 1 MiB' % total)

    out = bytearray(to + len(blob))
    out[:4] = MAGIC
    struct.pack_into('<IIHHIIII', out, 4, ver, baseId, nlay, nent, eo, lo, to, 0)
    for i, (e, a) in enumerate(zip(ents, addrs)):
        struct.pack_into('<IHH', out, eo + i * 8, int(e['id'], 16),
                         a & 0xFFFF, (e['layout'] << 4) | (a >> 16))
    out[lo:lo + len(layouts)] = layouts
    out[to:] = blob
    pad = bytes.fromhex(doc.get('tailPad', ''))
    if len(pad) != (-len(out)) % 16:
        pad = b'\xcd' * ((-len(out)) % 16)
    out += pad
    return bytes(out)


# ------------------------------------------------------------------- cli
def cmd_export(a):
    n = 0
    for src in sorted(glob.glob(os.path.join(a.src, '**', '*.ctd'), recursive=True)):
        rel = os.path.relpath(src, a.src)
        dst = os.path.join(a.dst, rel + '.json')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        json.dump(read(src), open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        n += 1
    print('exported %d files -> %s' % (n, a.dst))


def cmd_import(a):
    n = 0
    for src in sorted(glob.glob(os.path.join(a.src, '**', '*.ctd.json'), recursive=True)):
        rel = os.path.relpath(src, a.src)[:-5]
        dst = os.path.join(a.dst, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(write(json.load(open(src, encoding='utf-8'))))
        n += 1
    print('rebuilt %d files -> %s' % (n, a.dst))


def cmd_verify(a):
    ok = bad = 0
    for src in sorted(glob.glob(os.path.join(a.src, '**', '*.ctd'), recursive=True)):
        orig = open(src, 'rb').read()
        rebuilt = write(read(src))
        if rebuilt == orig:
            ok += 1
        else:
            bad += 1
            print('MISMATCH', os.path.relpath(src, a.src), len(orig), len(rebuilt))
    print('byte-identical round trip: %d ok, %d mismatched' % (ok, bad))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='KH3D @CTD text export/import')
    sp = ap.add_subparsers(dest='cmd', required=True)
    for name, fn in (('export', cmd_export), ('import', cmd_import), ('verify', cmd_verify)):
        p = sp.add_parser(name)
        p.add_argument('src')
        if name != 'verify':
            p.add_argument('dst')
        p.set_defaults(func=fn)
    a = ap.parse_args()
    a.func(a)
