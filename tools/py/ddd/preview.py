#!/usr/bin/env python3
"""Render text exactly the way the game does: cell lookup + CWDH advances."""
import sys, os, argparse
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from khfont import Bcfnt


def render(bcfnt_path, sheet_path, lines, scale=2, zoom=1, bg=(28, 30, 44, 255)):
    f = Bcfnt(open(bcfnt_path, 'rb').read())
    sheet = Image.open(sheet_path).convert('RGBA')
    S = scale
    lf = f.linefeed * S
    W = 0
    for ln in lines:
        w = 0
        for ch in ln:
            idx = f.cmap.get(ord(ch), f.alterCharIndex)
            w += f.widths[idx][2] * S
        W = max(W, w)
    H = lf * len(lines) + 8 * S
    img = Image.new('RGBA', (W + 8 * S, H), bg)
    y = 2 * S
    for ln in lines:
        x = 4 * S
        for ch in ln:
            idx = f.cmap.get(ord(ch), f.alterCharIndex)
            left, gw, cw = f.widths[idx]
            x0, y0, x1, y1 = f.cell(idx, S)
            g = sheet.crop((x0, y0, x1, y1))
            img.alpha_composite(g, (x + left * S, y))
            x += cw * S
        y += lf
    if zoom != 1:
        img = img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)
    return img


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('bcfnt'); ap.add_argument('sheet'); ap.add_argument('out')
    ap.add_argument('text', nargs='+')
    ap.add_argument('--zoom', type=int, default=1)
    a = ap.parse_args()
    render(a.bcfnt, a.sheet, a.text, zoom=a.zoom).save(a.out)
