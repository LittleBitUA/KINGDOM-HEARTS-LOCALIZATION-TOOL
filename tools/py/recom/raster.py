"""Glyph rasteriser that reproduces the KH3D look: white fill + black outline.

Pillow's own ``stroke_width`` renders the stroke and the fill with slightly
different origins, which leaves one side of a glyph without an outline. The
outline is therefore built here by dilating the glyph mask, so fill and outline
are always in perfect register.
"""
import numpy as np
from PIL import Image, ImageFont, ImageDraw

SS = 4          # supersampling factor
_FONTS = {}


def _font(path, px):
    k = (path, round(px, 3))
    if k not in _FONTS:
        _FONTS[k] = ImageFont.truetype(path, px)
    return _FONTS[k]


def _disc(r):
    k = int(np.ceil(r))
    return [(dx, dy) for dx in range(-k, k + 1) for dy in range(-k, k + 1)
            if dx * dx + dy * dy <= r * r + 1e-9]


try:
    from scipy.ndimage import grey_dilation as _sp_dilate
except Exception:
    _sp_dilate = None


def _footprint(r):
    k = int(np.ceil(r))
    y, x = np.mgrid[-k:k + 1, -k:k + 1]
    return (x * x + y * y <= r * r + 1e-9)


def _dilate(a, offs):
    out = np.zeros_like(a)
    H, W = a.shape
    for dx, dy in offs:
        xs0, xs1 = max(0, dx), min(W, W + dx)
        xd0, xd1 = max(0, -dx), min(W, W - dx)
        ys0, ys1 = max(0, dy), min(H, H + dy)
        yd0, yd1 = max(0, -dy), min(H, H - dy)
        np.maximum(out[ys0:ys1, xs0:xs1], a[yd0:yd1, xd0:xd1],
                   out=out[ys0:ys1, xs0:xs1])
    return out


def _squeeze(a, xscale):
    """Стиснути маску по горизонталі (для широких літер на кшталт Щ, Ш, Ю)."""
    if xscale >= 0.999:
        return a
    H, W = a.shape
    nw = max(1, int(round(W * xscale)))
    small = np.asarray(Image.fromarray(a).resize((nw, H), Image.LANCZOS))
    out = np.zeros((H, W), np.uint8)
    out[:, :nw] = small
    return out


def glyph_rgba(ch, font_path, size, radius, base, cell_w, cell_h, pad=16, xscale=1.0):
    """Render `ch` into a (cell_h + 2*pad, cell_w + 2*pad) RGBA array.

    The pen sits at x = pad, baseline y = pad + base.
    """
    fnt = _font(font_path, size * SS)
    W, H = (cell_w + 2 * pad) * SS, (cell_h + 2 * pad) * SS
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).text((pad * SS, (pad + base) * SS), ch, 255, font=fnt, anchor='ls')
    a = _squeeze(np.array(m), xscale)
    if a.max() == 0:
        raise ValueError('font has no glyph for %r' % ch)
    if _sp_dilate is not None:
        d = _sp_dilate(a, footprint=_footprint(radius * SS))
    else:
        d = _dilate(a, _disc(radius * SS))
    fill = np.asarray(Image.fromarray(a).resize((W // SS, H // SS), Image.LANCZOS)).astype(np.int32)
    alpha = np.asarray(Image.fromarray(d).resize((W // SS, H // SS), Image.LANCZOS)).astype(np.int32)
    fill = np.clip(fill, 0, 255)
    alpha = np.clip(alpha, 0, 255)
    out = np.zeros((H // SS, W // SS, 4), np.uint8)
    out[..., 0] = out[..., 1] = out[..., 2] = fill
    out[..., 3] = alpha
    return out


def plain_rgba(ch, font_path, size, base, cell_w, cell_h, pad=16, thresh=110, xscale=1.0, ramp=0.45):
    """White glyph, antialiased, no outline — the style cmdfont/helpfont use.

    Those sheets are pure white RGB with the shape carried entirely by the alpha
    channel. `thresh` acts as a gamma (x100) on the coverage: <100 fattens the
    strokes, >100 thins them.
    """
    fnt = _font(font_path, size * SS)
    W, H = (cell_w + 2 * pad) * SS, (cell_h + 2 * pad) * SS
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).text((pad * SS, (pad + base) * SS), ch, 255, font=fnt, anchor='ls')
    a = _squeeze(np.asarray(m), xscale)
    if a.max() == 0:
        raise ValueError('font has no glyph for %r' % ch)
    small = np.asarray(Image.fromarray(a).resize((W // SS, H // SS), Image.BOX)).astype(np.float64)
    # linear ramp centred on `thresh`: `ramp` — its half-width (0.45 → crisp, як
    # намальовані вручну bitmap-гліфи; ~0.85 → м'які краї, як у рідному sysfont
    # Re:CoM, де діагоналі ж/и/у мають повноцінне згладжування)
    lo, hi = max(0.0, thresh * (1 - ramp)), min(255.0, thresh * (1 + ramp))
    alpha = np.clip((small - lo) / max(1.0, hi - lo), 0, 1) * 255.0
    alpha = (alpha + 0.5).astype(np.uint8)
    out = np.zeros((H // SS, W // SS, 4), np.uint8)
    out[..., :3] = 255
    out[..., 3] = alpha
    return out


def cell_image(ch, font_path, size, radius, base, cell_w, cell_h, pad=16, thr=32,
               style='outline', thresh=110, xscale=1.0, ramp=0.45):
    """RGBA cell with the ink left-aligned at x=0, plus its ink bbox."""
    if style == 'plain':
        rgba = plain_rgba(ch, font_path, size, base, cell_w, cell_h, pad, thresh, xscale, ramp)
    else:
        rgba = glyph_rgba(ch, font_path, size, radius, base, cell_w, cell_h, pad, xscale)
    A = rgba[..., 3]
    ys, xs = np.where(A > thr)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    src = rgba[pad:pad + cell_h, x0:x0 + cell_w]
    cell = np.zeros((cell_h, cell_w, 4), np.uint8)
    cell[:src.shape[0], :src.shape[1]] = src
    ca = cell[..., 3]
    cys, cxs = np.where(ca > thr)
    bbox = (0, int(cys.min()), int(cxs.max()) + 1, int(cys.max()) + 1)
    clipped = (x1 - x0 > cell_w) or (y0 < pad) or (y1 > pad + cell_h)
    return Image.fromarray(cell, 'RGBA'), bbox, clipped
