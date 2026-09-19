import sys,struct,json; sys.path.insert(0,'.')
from bbsfont import load, inf_of, cod_of, PNG_INDEX
from raster import cell_image
from PIL import Image
import numpy as np
ARC='/mnt/user-data/uploads/KINGDOM HEARTS -HD 1.5+2.5 ReMIX-/Image/dt/bbs_first.hed_out/original/arc_en/system/FontEn.arc'
REM='/mnt/user-data/uploads/KINGDOM HEARTS -HD 1.5+2.5 ReMIX-/Image/dt/bbs_first.hed_out/remastered/arc_en/system/FontEn.arc/'
FONT={'comic':'/mnt/user-data/uploads/DropDistanceHD/Fonts/ComicHearts-Regular.otf',
      'menu':'/mnt/user-data/uploads/DropDistanceHD/Fonts/KHMenu-Regular.otf'}
a,by=load(ARC)
SAMPLE='HKAEOoxnmTBSUZaeu023'
def cid(c):
    o=ord(c)
    if 'A'<=c<='Z': return 0x8260+o-65
    if 'a'<=c<='z': return 0x8281+o-97
    if '0'<=c<='9': return 0x824F+o-48
def refs(n):
    cnt,w,h,cw,ch=inf_of(by,n); recs=cod_of(by,n)
    m={}
    for r in recs: m.setdefault(r[0],r)
    im=Image.open(REM+'US_FontEn_arc%d.png'%PNG_INDEX[n]).convert('RGBA'); S=(im.width//2)//w; half=im.width//2
    out={}
    for c in SAMPLE:
        r=m.get(cid(c))
        if not r: continue
        _,x,y,pal,wd=r
        out[c]=np.array(im.crop((x*S+pal*half,y*S,x*S+pal*half+cw*S,y*S+ch*S))).astype(int)
    return out,cw,ch,S
def run(n,fk,style,R,penx,bases,sizes,radii,threshs):
    ref,cw,ch,S=refs(n); fp=FONT[fk]; W,H=cw*R,ch*R
    def score(size,rad,base,th):
        tot=0
        for c,r in ref.items():
            try: cell,bb,cl=cell_image(c,fp,size,rad,base,W,H,style=style,thresh=th)
            except Exception: return 1e9
            sh=Image.new('RGBA',cell.size,(0,0,0,0)); sh.paste(cell,(penx*R,0))
            if R!=S: sh=sh.resize((cw*S,ch*S),Image.NEAREST)
            g=np.array(sh).astype(int)
            tot+=abs(r[...,3]-g[...,3]).mean()+abs(r[...,0]-g[...,0]).mean()
            if cl: tot+=20
        return tot/len(ref)
    cands=[(s,rd,b,t) for s in sizes for rd in radii for b in bases for t in threshs]
    bst=min(cands,key=lambda c:score(*c))
    print('%-9s size=%.1f radius=%.1f base=%d thresh=%d  err=%.2f (%d варіантів)'%(n,bst[0],bst[1],bst[2],bst[3],score(*bst),len(cands)),flush=True)
    return bst
if __name__=='__main__':
    import sys
    CONF={'mesfont':('comic','outline',2,3,range(42,45),[x/10 for x in range(320,380,5)],[1.5,2.0,2.5],[110]),
          'helpfont':('menu','plain',1,1,range(14,17),[x/10 for x in range(115,160,3)],[0],[90,110,130,150]),
          'menufont':('menu','plain',1,1,range(14,17),[x/10 for x in range(90,130,3)],[0],[90,110,130,150]),
          'cmdfont':('menu','plain',1,1,range(11,14),[x/10 for x in range(90,130,3)],[0],[90,110,130,150])}
    n=sys.argv[1]
    r=run(n,*CONF[n])
    try: d=json.load(open('calib.json'))
    except Exception: d={}
    d[n]=r; open('calib.json','w').write(json.dumps(d))
