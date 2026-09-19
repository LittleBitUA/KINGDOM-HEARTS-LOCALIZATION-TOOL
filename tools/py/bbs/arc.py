import struct, os
class Arc:
    def __init__(self, data):
        self.raw=data
        assert struct.unpack_from('<I',data,0)[0]&0xFFFFFF == 0x435241, data[:4]
        self.version, self.count = struct.unpack_from('<hh',data,4)
        self.u8, self.uc = struct.unpack_from('<ii',data,8)
        self.entries=[]
        for i in range(self.count):
            o=0x10+i*0x20
            dp,off,ln,unused = struct.unpack_from('<IiiI',data,o)
            name=data[o+0x10:o+0x20].split(b'\0')[0].decode('utf-8','replace')
            self.entries.append(dict(i=i,dirhash=dp,off=off,len=ln,unused=unused,name=name,
                                     link=dp!=0, data=None if dp else data[off:off+ln]))
    def __repr__(self):
        return 'Arc(v=%d,n=%d)'%(self.version,self.count)
