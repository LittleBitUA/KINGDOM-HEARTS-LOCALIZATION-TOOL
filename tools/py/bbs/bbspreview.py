import sys,os,struct; sys.path.insert(0,'.')
from bbsfont import load, inf_of, cod_of, PNG_INDEX, CODES
from PIL import Image, ImageDraw
def cid(c):
    o=ord(c)
    if c in CODES: return CODES[c]
    if 'A'<=c<='Z': return 0x8260+o-65
    if 'a'<=c<='z': return 0x8281+o-97
    if '0'<=c<='9': return 0x824F+o-48
    return {'!':0x8149,'?':0x8148,'.':0x8144,',':0x8143,"'":0x8166,':':0x8146,'-':0x817C,
            '(':0x8169,')':0x816A,'"':0x8168,'—':0x815C,'«':None,'»':None}.get(c)
def render(name, arc, rem, lines, zoom=1):
    a,by=load(arc)
    cnt,w,h,cw,ch=inf_of(by,name); recs=cod_of(by,name)
    m={}
    for r in recs: m.setdefault(r[0],r)
    im=Image.open(os.path.join(rem,'US_FontEn_arc%d.png'%PNG_INDEX[name])).convert('RGBA')
    S=(im.width//2)//w; half=im.width//2
    rows=[]
    for ln in lines:
        wsum=0
        for c in ln: wsum += (cw//2 if c==' ' else (m[cid(c)][4] if cid(c) in m else cw//2))
        rows.append(wsum)
    W=(max(rows)+4)*S; H=len(lines)*(ch+2)*S
    out=Image.new('RGBA',(W,H),(40,42,56,255))
    y=0
    for ln in lines:
        x=2
        for c in ln:
            k=cid(c)
            if c==' ' or k not in m: x+=cw//2; continue
            _,gx,gy,pal,wd=m[k]
            out.alpha_composite(im.crop((gx*S+pal*half,gy*S,gx*S+pal*half+cw*S,gy*S+ch*S)),(x*S,y))
            x+=wd
        y+=(ch+2)*S
    return out.resize((out.width*zoom,out.height*zoom),Image.NEAREST) if zoom>1 else out
if __name__=='__main__':
    ARC='fontout/original/arc_en/system/FontEn.arc'; REM='fontout/remastered/arc_en/system/FontEn.arc'
    L=['Kingdom Hearts Birth by Sleep','Кінґдом Гартс Бьорт бай Сліп','ЩЕ ЖОДЕН ҐАВРИК НЕ ЗЇВ ЮШКИ','Їжак, ґудзик, мяч 0123456789']
    ims=[]
    for n in ('mesfont','helpfont','menufont','cmdfont'):
        ims.append((n,render(n,ARC,REM,L,2)))
    Wm=max(i.width for _,i in ims)+130; Hm=sum(i.height+14 for _,i in ims)
    c=Image.new('RGBA',(Wm,Hm),(40,42,56,255)); d=ImageDraw.Draw(c); y=0
    for n,i in ims:
        d.text((4,y+i.height//2-6),n,fill=(255,220,120,255)); c.alpha_composite(i,(125,y)); y+=i.height+14
    c.save('ua_preview.png'); print(c.size)
