# -*- coding: utf-8 -*-
"""comctd.py — @CTD із Kingdom Hearts Re:Chain of Memories (HD, PC).

Формат (перевірено на всіх 426 файлах UK_*.ctdl):

    заголовок 0x10   "@CTD", u16 layoutCount, u16 messageCount,
                     u32 offsetTable, u32 textBase
    макети   0x30 × layoutCount   — не чіпаємо, копіюємо як є
    таблиця  u32 × messageCount   — зсув рядка ВІД textBase
    текст    рядки з NUL-термінатором, вирівняні на 4

Кодування — те саме сімейство Shift-JIS, що й у Birth by Sleep.
"""
import struct

MAGIC = b'@CTD'
HDR, LAY = 0x10, 0x30


def read(path):
    b = open(path, 'rb').read()
    return parse(b, path)


def parse(b, path=None):
    magic, nlay, nmsg, off, txt = struct.unpack_from('<4sHHII', b, 0)
    assert magic == MAGIC, (path, magic)
    lays = [b[HDR + i * LAY:HDR + (i + 1) * LAY] for i in range(nlay)]
    offs = [struct.unpack_from('<I', b, off + 4 * i)[0] for i in range(nmsg)]
    msgs = [b[txt + o:b.index(b'\0', txt + o)] for o in offs]
    # кожен рядок займає align4(len+1); після останнього — 4 нулі,
    # інколи ще й сміття 0xCD від пакувальника — зберігаємо як є
    end = txt + sum((len(m) + 4) // 4 * 4 for m in msgs)
    return dict(layouts=lays, messages=msgs, textBase=txt, offTable=off,
                size=len(b), tail=b[end:], path=path, raw=b)


def write(doc):
    lays, msgs = doc['layouts'], doc['messages']
    off = HDR + len(lays) * LAY
    txt = doc['textBase']                      # зберігаємо вирівнювання оригіналу
    need = off + 4 * len(msgs)
    if txt < need:
        txt = (need + 15) // 16 * 16
    blob, offs = bytearray(), []
    for m in msgs:                             # без дедуплікації — як в оригіналі
        offs.append(len(blob))
        blob += m + b'\0'
        while len(blob) % 4:
            blob.append(0)
    out = bytearray(txt) + blob
    struct.pack_into('<4sHHII', out, 0, MAGIC, len(lays), len(msgs), off, txt)
    for i, l in enumerate(lays):
        out[HDR + i * LAY:HDR + (i + 1) * LAY] = l
    for i, o in enumerate(offs):
        struct.pack_into('<I', out, off + 4 * i, o)
    tail = doc.get('tail') or b'\0\0\0\0'
    return bytes(out) + tail
