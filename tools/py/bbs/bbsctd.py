# -*- coding: utf-8 -*-
"""BBS @CTD (version 1) reader/writer — Kingdom Hearts HD 1.5+2.5 ReMIX (PC).

Layout confirmed against real PC files (not the openkh.dev docs, which give a
wrong 0x10 message stride):

    header 0x20   "@CTD", version=1, fileId, layoutCount u16, messageCount u16,
                  messageOffset, layoutOffset, textOffset, reserved
    message 0x0C  id u32, textOffset u32 (absolute), layoutIndex u16, waitFrames u16
    layout  0x20  opaque here — never touched by a translation
    text          NUL-terminated byte strings, packed, no dedup
"""
import struct

MAGIC = b'@CTD'
HDR, MSG, LAY = 0x20, 0x0C, 0x20

# --- character tables -------------------------------------------------------
M0 = (' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[¥]^_`'
      'abcdefghijklmnopqrstuvwxyz{|}~')                     # 0x20..0x7E

# second byte 0x40.. ; '.' = slot with no character
M81 = ('　､｡,.・:;?!.....^¯..........'
       '–-./\\~-|…‥‘’“”()..[]{}'
       '⟨⟩⟪⟫「」『』..'
       '+-±×·÷=≠<>≤≥∞∴'
       '♂♀°′″.¥$¢£%#&*@§'
       '☆★○●◎◇◆□■'
       '△▲▽▼※〒→←↑↓')

# second byte 0x80.. — the page the international build hijacks for Latin
M99 = ('ÀÁÂÄÆÇÈÉÊËÌÍ'
       'ÎÏÑÒÓÔÕÖŒÙÚÛ'
       'Üßàáâäæçèéêë'
       'ìíîïñòóôõöùú'
       'ûüœ¿¡‚„—°«»≤'
       '≥❤¹²³⁴⁵£€§·¢'
       '¨‘’©®™‾ₐ')

CMD = {0xF1: 'icon', 0xF2: 'icon2', 0xF5: 'icon3', 0xF9: 'color'}
ICON = {
    0xF1: {0xae: 'triangle', 0xaf: 'circle', 0xb0: 'square', 0xb1: 'cross',
           0xb2: 'analog', 0xb3: 'r', 0xb4: 'l',
           0xc3: 'dpad', 0xc4: 'dpad-h', 0xc5: 'dpad-v'},
    0xF2: {0xf6: 'unk'},
    0xF5: {0x67: 'unk', 0x76: 'dpad-and-analog'},
    0xF9: {0x41: 'default', 0x58: 'white', 0x59: 'yellow'},
}
LEAD = set(range(0x81, 0xA0)) | set(range(0xE0, 0xF0))


def decode(data):
    out, i, n = [], 0, len(data)
    while i < n:
        c = data[i]; i += 1
        if c < 0x20:
            out.append('\n' if c == 0x0A else '{U+%04X}' % c); continue
        if c < 0x7F:
            out.append(M0[c - 0x20]); continue
        if c in CMD and i < n:
            p = data[i]; i += 1
            nm = ICON[c].get(p)
            out.append('{%s %s}' % (CMD[c], nm or '%02x' % p)); continue
        if c == 0x81 and i < n:
            p = data[i]; i += 1
            k = p - 0x40
            ch = M81[k] if 0 <= k < len(M81) else '.'
            out.append(ch if ch != '.' or p == 0x44 else '{81 %02x}' % p); continue
        if c == 0x99 and i < n:
            p = data[i]; i += 1
            k = p - 0x80
            out.append(M99[k] if 0 <= k < len(M99) else '{99 %02x}' % p); continue
        if c in LEAD and i < n:
            p = data[i]; i += 1
            out.append('{sjis %02x%02x}' % (c, p)); continue
        out.append('{b %02x}' % c)
    return ''.join(out)


def read(path):
    b = open(path, 'rb').read()
    magic, ver, fid, nlay, nmsg, moff, loff, toff, res = struct.unpack_from('<4sIIHHIIIi', b, 0)
    assert magic == MAGIC and ver == 1, (magic, ver)
    msgs = []
    for i in range(nmsg):
        mid, off, li, wf = struct.unpack_from('<IIHH', b, moff + i * MSG)
        e = b.index(b'\0', off)
        msgs.append(dict(id=mid, layout=li, wait=wf, raw=b[off:e]))
    lays = [b[loff + i * LAY:loff + (i + 1) * LAY] for i in range(nlay)]
    end = b.index(b'\0', max((m['id'] and 0) or 0 for m in msgs) or 0) if False else 0
    last = max(struct.unpack_from('<I', b, moff + i * MSG + 4)[0] for i in range(nmsg)) if nmsg else toff
    end = b.index(b'\0', last) + 1 if nmsg else toff
    return dict(fileId=fid, layouts=lays, messages=msgs, size=len(b), raw=b,
                reserved=res, path=path, tailPad=b[end:])


def write(doc):
    msgs, lays = doc['messages'], doc['layouts']
    moff = HDR
    loff = (moff + len(msgs) * MSG + 15) // 16 * 16
    toff = loff + len(lays) * LAY
    blob, offs = bytearray(), []
    for m in msgs:
        offs.append(toff + len(blob))
        blob += m['raw'] + b'\0'
    out = bytearray(toff) + blob
    struct.pack_into('<4sIIHHIIIi', out, 0, MAGIC, 1, doc['fileId'],
                     len(lays), len(msgs), moff, loff, toff, doc.get('reserved', 0))
    for i, (m, o) in enumerate(zip(msgs, offs)):
        struct.pack_into('<IIHH', out, moff + i * MSG, m['id'], o, m['layout'], m['wait'])
    for i, l in enumerate(lays):
        out[loff + i * LAY:loff + (i + 1) * LAY] = l
    pad = doc.get('tailPad', b'')
    if len(pad) != (-len(out)) % 16:
        pad = b'\xcd' * ((-len(out)) % 16)
    return bytes(out) + pad
