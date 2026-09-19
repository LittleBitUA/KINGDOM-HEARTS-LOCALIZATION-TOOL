import numpy as np

def unswizzle(data, width_bytes, height):
    """PSP GE unswizzle: 16-byte x 8-row blocks. width_bytes = row stride in bytes."""
    total = width_bytes * height
    dst = bytearray(total)
    src = bytearray(data) + bytes(max(0, total - len(data)))
    for i in range(0, total, 16):
        d = i % 0x10
        d += (i // 0x10) % 8 * width_bytes
        d += (i // 0x80) % (width_bytes // 16) * 16
        d += (i // (width_bytes * 8)) * width_bytes * 8
        dst[d:d+16] = src[i:i+16]
    return bytes(dst)

def mtx_indices(data, w, h, bpp):
    stride = w * bpp // 8
    raw = unswizzle(data, stride, h)
    a = np.frombuffer(raw, dtype=np.uint8).reshape(h, stride)
    if bpp == 4:
        lo = a & 0x0F
        hi = a >> 4
        out = np.empty((h, w), np.uint8)
        out[:, 0::2] = lo
        out[:, 1::2] = hi
        return out
    return a.copy()

def clu(data, n=16):
    p = np.frombuffer(data, dtype=np.uint8)
    return p[:n*4].reshape(n, 4)     # RGBA

def render(idx, pal):
    h, w = idx.shape
    out = pal[idx]
    return out.astype(np.uint8)


def swizzle(data, width_bytes, height):
    """Зворотне до unswizzle: лінійна текстура -> PSP-порядок."""
    total = width_bytes * height
    src = bytearray(data) + bytes(max(0, total - len(data)))
    dst = bytearray(total)
    for i in range(0, total, 16):
        d = i % 0x10
        d += (i // 0x10) % 8 * width_bytes
        d += (i // 0x80) % (width_bytes // 16) * 16
        d += (i // (width_bytes * 8)) * width_bytes * 8
        dst[i:i+16] = src[d:d+16]
    return bytes(dst)


def pack4(idx):
    """Матриця індексів 0..15 -> 4bpp рядки (молодший нібл = лівий піксель)."""
    import numpy as np
    h, w = idx.shape
    a = idx.astype(np.uint8)
    return (a[:, 0::2] | (a[:, 1::2] << 4)).tobytes()
