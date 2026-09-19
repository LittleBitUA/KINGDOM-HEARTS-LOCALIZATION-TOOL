# -*- coding: utf-8 -*-
"""comfont.py — шрифт Re:Chain of Memories (HD, PC).

`.binl` (magic "FFMW"):

    0x00 "FFMW"
    0x04 u16  версія (1)
    0x06 u16  кількість гліфів
    0x08 u16  зсув таблиці «код -> індекс гліфа»
    0x0A u16  0
    0x0C u32  висота рядка (20 у sysfont, 26 у evtfont)
    0x10 u8[] ширина кожного гліфа (крок каретки), по одному байту

    таблиця: u16 на кожен код, починаючи з 0x20

Атлас `_fo240.png` — сітка комірок, дві половини по 1024 px:

    блок = i // (cols*rows);  j = i % (cols*rows)
    x = блок*1024 + (j % cols) * cell;  y = (j // cols) * cell
"""
import struct
from PIL import Image

PROFILES = {
    'sysfont': dict(cell=40, cols=25, rows=25),
    'evtfont': dict(cell=52, cols=19, rows=39),
}


class Font:
    def __init__(self, binl, png, name):
        b = open(binl, 'rb').read()
        magic, ver, n, mapoff, z, self.line = struct.unpack_from('<4sHHHHI', b, 0)
        assert magic == b'FFMW', magic
        self.raw, self.count, self.mapoff = bytearray(b), n, mapoff
        self.widths = bytearray(b[0x10:0x10 + n])
        self.nmap = (len(b) - mapoff) // 2
        self.im = Image.open(png).convert('RGBA')
        p = PROFILES[name]
        self.cell, self.cols, self.rows = p['cell'], p['cols'], p['rows']
        self.per = self.cols * self.rows

    @staticmethod
    def key(code):
        """Номер запису в таблиці. Однобайтові коди — code-0x20;
        для провідного 0x82 (перевірено на повноширинних ０-９, Ａ-Ｚ, ａ-ｚ)
        крок лінійний: 224 + молодший байт."""
        if code < 0x100:
            return code - 0x20
        if code >> 8 == 0x82:
            return 224 + (code & 0xFF)
        raise KeyError('невідомий спосіб адресації для 0x%04X' % code)

    def glyph(self, code):
        k = self.key(code)
        if not 0 <= k < self.nmap:
            return 0
        return struct.unpack_from('<H', self.raw, self.mapoff + 2 * k)[0]

    def set_glyph(self, code, idx):
        struct.pack_into('<H', self.raw, self.mapoff + 2 * self.key(code), idx)

    def box(self, i):
        blk, j = divmod(i, self.per)
        return (blk * 1024 + (j % self.cols) * self.cell,
                (j // self.cols) * self.cell)

    def cell_img(self, i):
        x, y = self.box(i)
        return self.im.crop((x, y, x + self.cell, y + self.cell))

    def save(self, binl, png):
        self.raw[0x10:0x10 + self.count] = self.widths
        open(binl, 'wb').write(bytes(self.raw))
        self.im.save(png)
