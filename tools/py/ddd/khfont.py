#!/usr/bin/env python3
"""
khfont.py — BCFNT (Nintendo 3DS CTR font) reader/writer for
Kingdom Hearts 3D: Dream Drop Distance HD (KH 2.8).

Handles:
  * FINF / TGLP / CWDH / CMAP parsing and full file rebuild
  * 3DS A4 texture (de)swizzling for the sheet embedded in the .bcfnt
  * glyph cell coordinate maths (original and "remastered" 2x textures)
"""
import struct
import numpy as np

# ---------------------------------------------------------------- 3DS texture

_MORTON = np.zeros((8, 8), dtype=np.int32)
for _y in range(8):
    for _x in range(8):
        _i = 0
        for _b in range(3):
            _i |= ((_x >> _b) & 1) << (2 * _b)
            _i |= ((_y >> _b) & 1) << (2 * _b + 1)
        _MORTON[_y, _x] = _i


def a4_decode(data, w, h):
    nib = np.zeros(w * h, dtype=np.uint8)
    b = np.frombuffer(data[:w * h // 2], dtype=np.uint8)
    nib[0::2] = b & 0x0F
    nib[1::2] = b >> 4
    out = np.zeros((h, w), dtype=np.uint8)
    lin = nib.reshape(h // 8, w // 8, 64)
    for ty in range(h // 8):
        for tx in range(w // 8):
            out[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = lin[ty, tx][_MORTON]
    return (out.astype(np.uint16) * 255 // 15).astype(np.uint8)


def a4_encode(img, w, h):
    q = ((img.astype(np.uint16) * 15 + 127) // 255).astype(np.uint8)
    lin = np.zeros((h // 8, w // 8, 64), dtype=np.uint8)
    for ty in range(h // 8):
        for tx in range(w // 8):
            lin[ty, tx][_MORTON] = q[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8]
    nib = lin.reshape(-1)
    return (nib[0::2] | (nib[1::2] << 4)).astype(np.uint8).tobytes()


# ---------------------------------------------------------------- BCFNT model

class Bcfnt:
    """Mutable BCFNT model. Widths are (left, glyphWidth, charWidth) triples."""

    def __init__(self, data: bytes):
        self.raw = data
        b = data
        assert b[:4] == b'CFNT', 'not a CFNT/BCFNT file'
        self.bom, self.hdrsize = struct.unpack_from('<HH', b, 4)
        self.version, self.filesize, self.nblocks = struct.unpack_from('<III', b, 8)

        o = self.hdrsize
        assert b[o:o + 4] == b'FINF'
        self.finf_size = struct.unpack_from('<I', b, o + 4)[0]
        p = o + 8
        (self.fonttype, self.linefeed, self.alterCharIndex,
         self.dw_left, self.dw_glyph, self.dw_char, self.encoding) = struct.unpack_from('<BBHbBBB', b, p)
        tglp_off, cwdh_off, cmap_off = struct.unpack_from('<III', b, p + 8)
        self.height, self.width, self.ascent, self._finf_pad = struct.unpack_from('<BBBB', b, p + 20)

        # ---- TGLP
        t = tglp_off - 8
        assert b[t:t + 4] == b'TGLP'
        self.tglp_size = struct.unpack_from('<I', b, t + 4)[0]
        q = t + 8
        (self.cellWidth, self.cellHeight, self.baselinePos, self.maxCharWidth) = struct.unpack_from('<BBBB', b, q)
        self.sheetSize, self.nSheets, self.fmt = struct.unpack_from('<IHH', b, q + 4)
        (self.nColumns, self.nRows, self.sheetWidth, self.sheetHeight) = struct.unpack_from('<HHHH', b, q + 12)
        self.sheetDataOffset = struct.unpack_from('<I', b, q + 20)[0]
        self.sheets = [b[self.sheetDataOffset + i * self.sheetSize:
                         self.sheetDataOffset + (i + 1) * self.sheetSize] for i in range(self.nSheets)]
        self._prefix = b[:self.sheetDataOffset]          # header + FINF + TGLP header (+padding)
        self._tail = b[self.filesize:]                   # padding some files carry past filesize

        # ---- CWDH chain
        self.widths = []
        self.cwdh_start = None
        off = cwdh_off
        while off:
            c = off - 8
            assert b[c:c + 4] == b'CWDH'
            start, end, nxt = struct.unpack_from('<HHI', b, c + 8)
            if self.cwdh_start is None:
                self.cwdh_start = start
            wp = c + 16
            for _ in range(end - start + 1):
                self.widths.append(struct.unpack_from('<bBB', b, wp))
                wp += 3
            off = nxt

        # ---- CMAP chain
        self.cmap = {}      # code -> glyph index
        self._cmap_raw = []   # original blocks, preserved verbatim
        off = cmap_off
        while off:
            c = off - 8
            assert b[c:c + 4] == b'CMAP'
            blk_size = struct.unpack_from('<I', b, c + 4)[0]
            cb, ce, mtype, _pad, nxt = struct.unpack_from('<HHHHI', b, c + 8)
            self._cmap_raw.append(bytearray(b[c:c + blk_size]))
            d = c + 20
            if mtype == 0:
                base = struct.unpack_from('<H', b, d)[0]
                for i, code in enumerate(range(cb, ce + 1)):
                    self.cmap[code] = base + i
            elif mtype == 1:
                for i, code in enumerate(range(cb, ce + 1)):
                    idx = struct.unpack_from('<H', b, d + 2 * i)[0]
                    if idx != 0xFFFF:
                        self.cmap[code] = idx
            elif mtype == 2:
                n = struct.unpack_from('<H', b, d)[0]
                for i in range(n):
                    code, idx = struct.unpack_from('<HH', b, d + 2 + 4 * i)
                    if idx != 0xFFFF:
                        self.cmap[code] = idx
            else:
                raise ValueError('unknown CMAP type %d' % mtype)
            off = nxt
        self._orig_codes = set(self.cmap)

    # ------------------------------------------------------------- geometry
    @property
    def glyphCount(self):
        return len(self.widths)

    @property
    def cellsPerSheet(self):
        return self.nColumns * self.nRows

    def cell(self, idx, scale=1):
        """(x0, y0, x1, y1) of glyph cell in texture pixels (sheet-local)."""
        i = idx % self.cellsPerSheet
        col, row = i % self.nColumns, i // self.nColumns
        x = col * (self.cellWidth + 1) + 1
        y = row * (self.cellHeight + 1) + 1
        return (x * scale, y * scale, (x + self.cellWidth) * scale, (y + self.cellHeight) * scale)

    def sheet_of(self, idx):
        return idx // self.cellsPerSheet

    def free_cells(self):
        """glyph indices with no bitmap assigned yet, within sheet capacity"""
        return range(self.glyphCount, self.cellsPerSheet * self.nSheets)

    # -------------------------------------------------------------- writing
    def _cwdh(self):
        n = len(self.widths)
        body = b''.join(struct.pack('<bBB', *w) for w in self.widths)
        size = 16 + len(body)
        pad = (-size) % 4
        return struct.pack('<4sIHHI', b'CWDH', size + pad, 0, n - 1, 0) + body + b'\0' * pad

    @staticmethod
    def _cmap_table(cb, ce, table):
        body = b''.join(struct.pack('<H', v) for v in table)
        size = 20 + len(body)
        pad = (-size) % 4
        return struct.pack('<4sIHHHHI', b'CMAP', size + pad, cb, ce, 1, 0, 0) + body + b'\0' * pad

    @staticmethod
    def _cmap_scan(pairs, cb=None, ce=None):
        pairs = sorted(pairs)
        body = struct.pack('<H', len(pairs)) + b''.join(struct.pack('<HH', c, i) for c, i in pairs)
        size = 20 + len(body)
        pad = (-size) % 4
        cb = pairs[0][0] if cb is None else cb
        ce = pairs[-1][0] if ce is None else ce
        return struct.pack('<4sIHHHHI', b'CMAP', size + pad, cb, ce, 2, 0, 0) + body + b'\0' * pad

    @staticmethod
    def _cmap_direct(cb, ce, base):
        body = struct.pack('<H', base)
        size = 20 + len(body)
        pad = (-size) % 4
        return struct.pack('<4sIHHHHI', b'CMAP', size + pad, cb, ce, 0, 0, 0) + body + b'\0' * pad

    def _build_cmap_blocks(self):
        """Emit the cmap as: dense tables for contiguous runs, scan for the rest."""
        codes = sorted(self.cmap)
        blocks, i = [], 0
        while i < len(codes):
            j = i
            while j + 1 < len(codes) and codes[j + 1] - codes[j] <= 8:
                j += 1
            run = codes[i:j + 1]
            cb, ce = run[0], run[-1]
            span = ce - cb + 1
            if span >= 4 and span * 2 <= (len(run) * 4 + 2):
                tbl = [self.cmap.get(c, 0xFFFF) for c in range(cb, ce + 1)]
                blocks.append(self._cmap_table(cb, ce, tbl))
            elif span == len(run) and all(self.cmap[c] == self.cmap[cb] + k for k, c in enumerate(run)):
                blocks.append(self._cmap_direct(cb, ce, self.cmap[cb]))
            else:
                tbl = [self.cmap.get(c, 0xFFFF) for c in range(cb, ce + 1)]
                if len(tbl) * 2 <= len(run) * 4 + 2:
                    blocks.append(self._cmap_table(cb, ce, tbl))
                else:
                    blocks.append(self._cmap_scan([(c, self.cmap[c]) for c in run]))
            i = j + 1
        return blocks

    def _cmap_chain(self):
        """Original blocks, with new codepoints merged in.

        The retail files end their CMAP chain with a type-2 "scan" block whose
        declared range is 0x0000-0xFFFF. The engine stops at the first block
        whose range contains the code, so anything appended AFTER that block is
        unreachable and falls back to alterCharIndex ("?"). New mappings are
        therefore merged into that catch-all block instead of being appended.
        """
        new = sorted(c for c in self.cmap if c not in self._orig_codes)
        blocks = [bytearray(b) for b in self._cmap_raw]
        if not new:
            return blocks
        catch = None
        for i, blk in enumerate(blocks):
            cb, ce, mt = struct.unpack_from('<HHH', blk, 8)
            if mt == 2 and cb == 0 and ce == 0xFFFF:
                catch = i
        if catch is not None:
            blk = blocks[catch]
            n = struct.unpack_from('<H', blk, 20)[0]
            pairs = [struct.unpack_from('<HH', blk, 22 + 4 * k) for k in range(n)]
            pairs += [(c, self.cmap[c]) for c in new]
            blocks[catch] = bytearray(self._cmap_scan(pairs, 0x0000, 0xFFFF))
            # belt and braces: a dense table placed BEFORE the catch-all, so the
            # lookup succeeds whether the engine stops at the first matching
            # block or walks the whole chain
            lo, hi = new[0], new[-1]
            if hi - lo + 1 <= 512:
                tbl = self._cmap_table(lo, hi, [self.cmap.get(c, 0xFFFF) for c in range(lo, hi + 1)])
                blocks.insert(catch, bytearray(tbl))
            return blocks
        # no catch-all: safe to append a dedicated block
        return blocks + [bytearray(self._cmap_scan([(c, self.cmap[c]) for c in new]))]

    def build(self) -> bytes:
        prefix = bytearray(self._prefix)
        # patch TGLP fields that may have changed
        t = struct.unpack_from('<I', prefix, self.hdrsize + 8 + 8)[0] - 8
        struct.pack_into('<BBBB', prefix, t + 8, self.cellWidth, self.cellHeight,
                         self.baselinePos, self.maxCharWidth)
        struct.pack_into('<IHH', prefix, t + 12, self.sheetSize, self.nSheets, self.fmt)
        struct.pack_into('<HHHH', prefix, t + 20, self.nColumns, self.nRows,
                         self.sheetWidth, self.sheetHeight)

        body = bytearray(prefix)
        for s in self.sheets:
            body += s

        cwdh_start = len(body)
        cwdh = bytearray(self._cwdh())
        body += cwdh

        cmap_blocks = self._cmap_chain()
        cmap_start = len(body)
        offs = []
        for blk in cmap_blocks:
            offs.append(len(body))
            body += blk
        # link the chain
        for k, o in enumerate(offs):
            nxt = offs[k + 1] + 8 if k + 1 < len(offs) else 0
            struct.pack_into('<I', body, o + 16, nxt)
        struct.pack_into('<I', body, cwdh_start + 12, 0)   # single CWDH block

        # patch FINF offsets
        p = self.hdrsize + 8
        struct.pack_into('<III', body, p + 8, t + 8, cwdh_start + 8, cmap_start + 8)
        # patch CFNT header
        nblocks = 2 + 1 + len(cmap_blocks)   # FINF + TGLP + CWDH + CMAPs
        struct.pack_into('<II', body, 12, len(body), nblocks)
        return bytes(body) + self._tail
