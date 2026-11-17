#!/usr/bin/env python3
"""Field Guide Studio picture renderer (config-driven).

Derived from the Motion V2 package's motion_v2.py via the v2-repaired and v3 copies;
those files are left unmodified. Nothing about an episode is hard-coded here:
titles, labels, graphics, art, timings, captions, sizes and fonts all come from
<run>/job.json, <run>/timing.json and <run>/captions.srt, which
engineering/drop_in_voice.py writes. Needs Pillow and ffmpeg. Writes only inside <run>.
"""
import argparse, json, math, os, re, subprocess, time, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

RUN=None; JOB={}; BEATS=[]; CUES=[]; FPS=30; LENGTH=0.0; ART=None
TITLES=[]; EYEBROWS=[]; DETAILS=[]; ACCENTS=[]; PANEL_IMAGES=[]; GRAPHICS=[]
SIZE={}; LABELS={}; CAP={}; TRANS=(0.56,0.075); SEAM="feather"; FONT_FILES={}
def init(run_dir):
    """Load one run. Call before frame()/run_encoder()."""
    global RUN,JOB,BEATS,CUES,FPS,LENGTH,ART,TITLES,EYEBROWS,DETAILS,ACCENTS,PANEL_IMAGES,GRAPHICS,SIZE,LABELS,CAP,TRANS,SEAM,FONT_FILES
    RUN=Path(run_dir).resolve(); JOB=json.loads((RUN/"job.json").read_text())
    ex=JOB["export"]; ep=JOB["episode"]
    BEATS=json.loads((RUN/"timing.json").read_text())["beats"]
    assert len(BEATS)==len(ep["beats"]), "timing.json and the episode disagree on the number of beats"
    CUES=read_subs(RUN/"captions.srt")
    FPS=ex["fps"]; LENGTH=sum(b["durationSec"] for b in BEATS); ART=Path(JOB["assets_dir"])
    TITLES=[tuple(b["picture"]["title"]) for b in ep["beats"]]
    EYEBROWS=[b["picture"]["eyebrow"] for b in ep["beats"]]
    DETAILS=[b["picture"]["detail"] for b in ep["beats"]]
    ACCENTS=[tuple(b["picture"]["accent"]) for b in ep["beats"]]
    PANEL_IMAGES=[list(b["picture"]["art"]) for b in ep["beats"]]
    GRAPHICS=[b["picture"]["graphic"] for b in ep["beats"]]
    SIZE={k:tuple(v) for k,v in ex["sizes"].items()}
    LABELS=JOB["labels"]; CAP=ex["captions"]
    TRANS=(ex["timing"]["transition_start"],ex["timing"]["transition_len"])
    SEAM=ex.get("vertical_panel_seam","feather")
    FONT_FILES={"reg":os.path.expanduser(ex["fonts"]["regular"]),"bold":os.path.expanduser(ex["fonts"]["bold"]),"black":os.path.expanduser(ex["fonts"]["bold"])}
    for p in FONT_FILES.values():
        if not os.path.exists(p): raise RuntimeError(f"font file not found: {p}")
    FONTS.clear(); BASE.clear(); PARALLAX_MASK.clear()
def font_path(which): return FONT_FILES[which]
FONTS={}
def fnt(px,which="reg"):
    key=(px,which)
    if key not in FONTS: FONTS[key]=ImageFont.truetype(font_path(which),px)
    return FONTS[key]
def ease(v):
    v=max(0.,min(1.,v))
    return v*v*(3-2*v)
def outf(v):
    return 1-ease(v)
def clamp(x,low,high): return max(low,min(high,x))
def hx(v): return "#"+''.join(f"{int(x):02x}" for x in v)
def at_time(t):
    for i,b in enumerate(BEATS):
        if b["startSec"]<=t<b["startSec"]+b["durationSec"]+0.0001:return i,t-b["startSec"]
    return len(BEATS)-1,BEATS[-1]["durationSec"]
def timestamp_ms(s):
    hh=int(s//3600); mm=int((s%3600)//60); ss=int(s%60); ms=round((s-int(s))*1000)
    return 3600*hh+60*mm+ss+ms/1000
def read_subs(path):
    s=path.read_text()
    cues=[]
    for block in re.split(r"\n\s*\n",s.strip()):
        lines=block.splitlines()
        if len(lines)<3:continue
        try:
            a,b=re.split(r"\s+-->\s+",lines[1])
            def ts(x):
                h,m,sec=x.split(":"); return int(h)*3600+int(m)*60+float(sec.replace(",","."))
            cues.append((ts(a),ts(b)," ".join(lines[2:])))
        except Exception:continue
    return cues
BASE={}
PARALLAX_MASK={}
def make_bg(w,h,i,k,mode):
    key=(w,h,i,k,mode)
    if key in BASE:return BASE[key]
    im=Image.open(ART/PANEL_IMAGES[i][k]).convert("RGB")
    W=int(w*1.36)+4; H=int(h*1.22)+4
    if mode=="land":
        # Preserve photographic aspect by soft cover-scale rather than stretching.
        iw,ih=im.size; scale=max(W/iw,H/ih)
        bg=im.resize((math.ceil(iw*scale),math.ceil(ih*scale)),Image.Resampling.LANCZOS)
        if bg.width<W: raise RuntimeError("bg width")
        left=(bg.width-W)//2; top=(bg.height-H)//2
        bg=bg.crop((left,top,left+W,top+H))
    else:
        # A multi-panel illustrated editorial frame; each panel moves separately.
        sw=w+int(w*.45); hh=int(H*.55)
        other=Image.open(ART/PANEL_IMAGES[i][1-k]).convert("RGB")
        def strip(im,sh):
            iw,ih=im.size; scale=max(sw/iw,sh/ih)
            bb=im.resize((math.ceil(iw*scale),math.ceil(ih*scale)),Image.Resampling.LANCZOS)
            x=(bb.width-sw)//2;y=(bb.height-sh)//2
            return bb.crop((x,y,x+sw,y+sh))
        a=strip(im,hh);bb=strip(other,H-hh)
        bg=Image.new("RGB",(sw,H))
        if SEAM=="feather":
            # The two panels melt into each other over 14% of the height, so no
            # line can travel behind the headline as the camera moves.
            f=int(H*.07)
            def strip2(im,sh):
                iw,ih=im.size; scale=max(sw/iw,sh/ih)
                x2=im.resize((math.ceil(iw*scale),math.ceil(ih*scale)),Image.Resampling.LANCZOS)
                x=(x2.width-sw)//2;y=(x2.height-sh)//2
                return x2.crop((x,y,x+sw,y+sh))
            a=strip2(im,hh+f); bb=strip2(other,H-hh+f)
            bg.paste(a,(0,0))
            mask=Image.new("L",(1,H-hh+f),255); md=ImageDraw.Draw(mask)
            for y in range(2*f): md.point((0,y),fill=int(255*ease(y/(2*f))))
            bg.paste(bb,(0,hh-f),mask.resize((sw,H-hh+f)))
        else:
            bg.paste(a,(0,0)); bg.paste(bb,(0,hh))
            d=ImageDraw.Draw(bg)
            d.rectangle((0,hh-3,sw,hh+2),fill=(25,47,59))
        # central crop leaves room for horizontal camera movement
        bg=bg.crop(((sw-W)//2,0,(sw+W)//2,H))
    BASE[key]=bg
    return bg
def background(w,h,i,elapsed,mode):
    dur=BEATS[i]["durationSec"]
    phase=clamp(elapsed/dur,0,1)
    sw=TRANS[0]
    switch=ease((phase-sw)/TRANS[1])
    def camera(which):
        src=make_bg(w,h,i,which,mode)
        margin=src.width-w
        m2=src.height-h
        pp=phase if which==0 else (phase-sw)/max(.01,1-sw)
        x=int(clamp((.13+.64*ease(pp) + (.08*math.sin(1.7*pp+i))),0,1)*margin)
        yy=int(clamp(.18+.55*ease(pp)+.08*math.sin(2*pp+i),0,1)*m2)
        back=src.crop((x,yy,x+w,yy+h))
        # Distinct camera displacement for a soft lower-depth plane.
        # This is a procedural 2.5-D approximation, not semantic image segmentation.
        dx=round(15*math.sin(pp*1.7+i*.8))
        dy=round(4*math.sin(pp*2.0+i))
        xx=int(clamp(x+dx,0,margin))
        yyy=int(clamp(yy+dy,0,m2))
        foreground=src.crop((xx,yyy,xx+w,yyy+h))
        mask_key=(w,h)
        if mask_key not in PARALLAX_MASK:
            grad=Image.new("L",(1,h))
            gd=ImageDraw.Draw(grad)
            for y in range(h):
                a=int(105*ease((y/h-.61)/.35))
                gd.point((0,y),fill=a)
            PARALLAX_MASK[mask_key]=grad.resize((w,h))
        back.paste(foreground,(0,0),PARALLAX_MASK[mask_key])
        return back
    bg=camera(0)
    if switch>0:
        second=camera(1)
        if switch>=1: bg=second
        elif True:
            # v3: cross-dissolve in both formats (the 16:9 wipe line crossed the "19" graphic).
            bg=Image.blend(bg,second,switch)
        else:
            # Directional wipe with a narrow luminous moving dividing line (no longer used).
            x=int(w*(1-switch))
            bg.paste(second.crop((0,0,w-x,h)),(x,0))
            d=ImageDraw.Draw(bg)
            d.rectangle((x-4,0,x+3,h),fill=ACCENTS[i])
    return bg
def matte(im,mode):
    w,h=im.size
    # static cinema matte gradient; keep scene imagery visible on right.
    overlay=Image.new("RGBA",(w,h),(0,0,0,0))
    a=ImageDraw.Draw(overlay)
    # 48 vertical bands for lightweight spatial color grading.
    for y in range(0,h,8):
        yrat=y/h
        alpha=int(clamp(8+95*(yrat**2.2)+35*(1-yrat)**5,0,170))
        a.rectangle((0,y,w,y+9),fill=(4,13,25,alpha))
    for x in range(0,w,14):
        alpha=int((1-x/w)**2.6*(145 if mode=="land" else 45))
        a.rectangle((x,0,x+14,h),fill=(4,12,23,alpha))
    return Image.alpha_composite(im.convert("RGBA"),overlay)
def line(d,coords,color,width=2):
    d.line([(round(x),round(y)) for x,y in coords],fill=color,width=max(1,round(width)),joint="curve")
def rr(d,xy,rad,fill,outline=None,width=1):
    d.rounded_rectangle(tuple(map(int,xy)),radius=rad,fill=fill,outline=outline,width=width)
def txt(d,pos,msg,size,fill,weight="reg",anchor=None,stroke_width=0,stroke_fill=None):
    d.text((round(pos[0]),round(pos[1])),msg,font=fnt(max(8,round(size)),weight),fill=fill,anchor=anchor,stroke_width=stroke_width,stroke_fill=stroke_fill)
def reveal_text(dst,xy,s,color,fs,weight,progress,anchor=None):
    # Slide kinetic typography from off-axis, fade via alpha raster.
    if progress<=0:return
    x,y=xy
    face=fnt(max(8,round(fs)),weight)
    bx=face.getbbox(s,anchor=anchor)
    text_w=max(1,round(bx[2]-bx[0]+20)); text_h=max(1,round(bx[3]-bx[1]+30))
    layer=Image.new("RGBA",(text_w,text_h),(0,0,0,0))
    ld=ImageDraw.Draw(layer)
    ld.text((10-bx[0],12-bx[1]),s,font=face,fill=(*color,round(255*ease(progress))))
    shift=int((1-ease(progress))*35)
    # reveal width mask
    rwidth=round(text_w*min(1,max(0,progress*1.5)))
    if rwidth<=0:return
    piece=layer.crop((0,0,rwidth,text_h))
    dst.alpha_composite(piece,(round(x),round(y+shift)))
def tracked(d,i,w,h,t,mode,accent):
    """Per-scene, story-relevant procedural visualization, not footage."""
    vertical=mode=="vertical"
    cx=w*(.78 if not vertical else .50)
    cy=h*(.46 if not vertical else .318)
    radius=min(w,h)*(.205 if not vertical else .20)
    ls=1.0 if not vertical else 1.3   # keep small labels readable at the smaller radius
    glow=(*accent,180)
    fade=ease(t/1.25)
    g=GRAPHICS[i]; kind=g["type"]
    # optical instruments vary by story beat; layered and dynamic.
    if kind=="lens":
        # investigative lens with orbiting scan mark and evidence dots
        for k in range(3):
            r=radius*(.45+k*.30)
            d.arc((cx-r,cy-r,cx+r,cy+r),start=10+t*17+k*65,end=124+t*17+k*65,fill=(*accent,round(170*fade)),width=2)
        angle=t*1.05
        x=cx+math.cos(angle)*radius;y=cy+math.sin(angle)*radius
        d.ellipse((x-5,y-5,x+5,y+5),fill=accent)
        line(d,[(cx-radius,cy),(cx+radius,cy)],(*accent,95),1)
        line(d,[(cx,cy-radius),(cx,cy+radius)],(*accent,95),1)
        txt(d,(cx,cy),f"{i+1:02d} / {len(BEATS):02d}",min(w,h)*.026,(*accent,230),"bold","mm")
    elif kind=="date_dial":
        # animated count and orbital ticks around release date
        for k in range(24):
            angle=(k/24)*2*math.pi - math.pi/2
            r=radius*(.80 if k%3==0 else .89)
            ex=cx+math.cos(angle)*r; ey=cy+math.sin(angle)*r
            ex2=cx+math.cos(angle)*(r+radius*.11); ey2=cy+math.sin(angle)*(r+radius*.11)
            col=accent if k<min(24,int(t*3)) else (180,213,225,70)
            line(d,[(ex,ey),(ex2,ey2)],col,3 if k%3==0 else 1)
        txt(d,(cx,cy),g["big"],radius*.69,(250,251,250,240),"black","mm")
        txt(d,(cx,cy+radius*.44),g["small"],radius*.145*ls,(*accent,235),"bold","mm")
    elif kind=="pair":
        # connected protagonists without depicting copyrighted characters
        dist=radius*.84
        for sign,label in [(-1,g["left"]),(1,g["right"])]:
            xx=cx+sign*dist
            for k in range(2):
                r=radius*(.31+.06*k+.025*math.sin(t*2+k))
                d.arc((xx-r,cy-r,xx+r,cy+r),10,350,fill=(*accent,150 if k==0 else 65),width=2)
            d.ellipse((xx-5,cy-5,xx+5,cy+5),fill=accent)
            txt(d,(xx,cy+radius*.48),label,radius*.16*ls,(245,248,248,235),"bold","mm")
        dr=ease((t-.65)/1.25)
        line(d,[(cx-dist*.67,cy),(cx-dist*.67+dist*1.34*dr,cy)],(*accent,215),3)
        d.ellipse((cx-5,cy-5,cx+5,cy+5),fill=(249,216,142,240))
    elif kind=="route":
        # explicitly abstract diagram: no geography claims
        nodes=[(-.75,.42),(-.45,-.25),(.05,.17),(.55,-.55),(.78,.25)]
        points=[(cx+xx*radius,cy+yy*radius) for xx,yy in nodes]
        reveal=ease((t-.4)/1.8)*4
        for k in range(min(4,int(reveal)+1)):
            if k>=4:break
            frac=min(1,reveal-k)
            x0,y0=points[k];x1,y1=points[k+1]
            line(d,[(x0,y0),(x0+(x1-x0)*frac,y0+(y1-y0)*frac)],(*accent,200),4)
        for k,(x,y) in enumerate(points):
            r=5+(3 if k%2==0 else 0)
            d.ellipse((x-r,y-r,x+r,y+r),fill=(12,38,49,200),outline=accent,width=2)
        txt(d,(cx,cy+radius*.8),g["label"],radius*.105*ls,(255,233,190,210),"bold","mm")
    elif kind=="network":
        # narrative conspiracy network. Not actual game mission layout.
        points=[(cx+radius*math.cos(k*2.399),cy+radius*.74*math.sin(k*2.399)) for k in range(6)]
        cnt=clamp((t-.1)/2.6,0,1)*len(points)
        for k,p in enumerate(points):
            if k>=cnt:continue
            for j in range(k):
                if (j+k)%2==0:
                    line(d,[p,points[j]],(*accent,75),1)
            x,y=p;r=4+2*math.sin(t*2.4+k)
            d.ellipse((x-r,y-r,x+r,y+r),fill=accent)
        txt(d,(cx,cy),g["label"],radius*.17*ls,(250,249,246,235),"bold","mm")
    elif kind=="ticks":
        # 30 FPS target not measured guarantee.
        ticks=30
        startx=cx-radius*1.08;step=2*radius/ticks
        for k in range(ticks):
            x=startx+k*step
            height=radius*(.19+(.33 if k%5==0 else .04))
            col=(*accent,205) if k<=int((t*8)%31) else (240,245,250,65)
            line(d,[(x,cy+height),(x,cy-height)],col,2)
        txt(d,(cx,cy-radius*.78),g["big"],radius*.60,(251,249,244,235),"black","mm")
        txt(d,(cx,cy+radius*.78),g["label"],radius*.105*ls,(252,240,217,220),"bold","mm")
    elif kind=="progress":
        # update indicator represents eligibility, not literal download progress.
        bx=cx-radius; by=cy-radius*.10
        rr(d,(bx,by,bx+radius*2,by+radius*.22),radius*.09,(11,34,47,185),(*accent,180),2)
        v=ease((t-.35)/1.85)
        rr(d,(bx+5,by+5,bx+5+v*(radius*2-10),by+radius*.22-5),radius*.04,(*accent,200))
        txt(d,(cx,cy-radius*.56),g["top"],radius*.14*ls,(249,250,247,220),"bold","mm")
        txt(d,(cx,cy+radius*.57),g["bottom"],radius*.16*ls,(249,250,247,240),"bold","mm")
    elif kind=="versus":
        # verified vs theory: evidence separator to foreground
        mid=cx
        r=radius*.8
        left=(mid-r*1.2,cy-r*.45,mid-r*.15,cy+r*.45)
        right=(mid+r*.15,cy-r*.45,mid+r*1.2,cy+r*.45)
        rr(d,left,12,(4,44,51,158),(*accent,200),2)
        rr(d,right,12,(61,26,45,145),(251,172,188,175),2)
        txt(d,((left[0]+left[2])/2,cy),g["left"],radius*.24,(235,255,253,240),"black","mm")
        txt(d,((right[0]+right[2])/2,cy),g["right"],radius*.22,(255,214,219,230),"black","mm")
        line(d,[(mid,cy-r*.76),(mid,cy+r*.76)],(*accent,230),3)
def wrap_balanced(text,face,maxw):
    """Fewest lines that fit maxw; among those, the most even split."""
    words=text.split()
    if face.getlength(text)<=maxw: return [text]
    best=None
    for k in range(1,len(words)):
        a=" ".join(words[:k]); b=" ".join(words[k:])
        if face.getlength(a)<=maxw and face.getlength(b)<=maxw:
            cost=abs(face.getlength(a)-face.getlength(b))
            if best is None or cost<best[0]: best=(cost,[a,b])
    if best: return best[1]
    rows=[];curr=""
    for word in words:
        if not curr: curr=word
        elif face.getlength(curr+" "+word)<=maxw: curr+=" "+word
        else: rows.append(curr);curr=word
    if curr: rows.append(curr)
    return rows
def caption_box(w,h,mode):
    """(left,right,top) of the caption box, from export config."""
    c=CAP[mode]; return (w*c["left"],w*c["right"],h*c["top"])
def captions(d,w,h,t,mode):
    selected=next((s for a,b,s in CUES if a<=t<b),None)
    if selected is None:return
    vertical=mode=="vertical"
    cap_fs=round(h*CAP[mode]["font_scale"])
    left,right,top=caption_box(w,h,mode)
    pad=round(w*.022)
    rows=wrap_balanced(selected,fnt(cap_fs,"bold"),right-left-2*pad)
    line_h=cap_fs*1.34
    block_h=len(rows)*line_h+round(h*.019)
    rr(d,(left,top,right,top+block_h),round(h*.0095),(1,14,24,207))
    for j,row in enumerate(rows):
        txt(d,((left+right)/2,top+round(h*.0095)+j*line_h),row,cap_fs,(251,253,254,255),"bold","mt")
def K(w,h): return min(w,h)/720
def frame(i,elapsed,tglobal,mode):
    vertical=mode=="vertical"
    w,h=SIZE[mode]
    color=ACCENTS[i]
    base=matte(background(w,h,i,elapsed,mode),mode)
    # All semi-transparent ink MUST be drawn to a separate RGBA layer;
    # drawing directly onto RGBA base replaces pixels and destroys transparency.
    ink=Image.new("RGBA",(w,h),(0,0,0,0))
    d=ImageDraw.Draw(ink)
    shimmer=(tglobal*30)%w
    # Directional lens shutter opens over the first 320 ms of each chapter.
    if elapsed<.35:
        sh=outf(elapsed/.35)
        dx=w*sh
        d.polygon([(w-dx,0),(w,0),(w,h),(w-dx*.68,h)],fill=(4,22,33,int(sh*170)))
        line(d,[(w-dx,0),(w-dx*.68,h)],(*color,int(sh*225)),max(2,int(w*.004)))
    d.polygon([(shimmer-180,0),(shimmer-80,0),(shimmer+120,h),(shimmer+20,h)],fill=(*color,8))
    hpad=int(w*.055)
    brand=LABELS["brand"]; brand_fs=max(8,round(h*(.014 if vertical else .017)))
    # v2-repaired: the badge is sized to its text (it used to end mid-word).
    rr(d,(hpad,h*.041,hpad+fnt(brand_fs,"bold").getlength(brand)+round(24*K(w,h)),h*.073),int(h*.011),(5,22,33,175))
    txt(d,(hpad+round(12*K(w,h)),h*.046),"LEONIDA  /  FIELD NOTES",h*(.014 if vertical else .017),(235,251,249,220),"bold")
    txt(d,(w-hpad,h*.044),LABELS["top_right"],h*(.011 if vertical else .015),(242,249,245,218),"reg","rt")
    d.rectangle((hpad,h*.094,w-hpad,h*.096),fill=(236,240,237,55))
    p=clamp((tglobal/LENGTH),0,1)
    d.rectangle((hpad,h*.094,hpad+(w-2*hpad)*p,h*.099),fill=(*color,240))
    d.line((hpad,h*.19,hpad+w*.12*ease(elapsed/.65),h*.19),fill=(*color,220),width=max(2,int(h*.003)))
    txt(d,(hpad,h*.15),EYEBROWS[i],h*(.023 if vertical else .027),(*color,255),"bold")
    txt(d,(w-hpad,h*.15),f"{i+1:02d}  /  {len(BEATS):02d}",h*(.027 if vertical else .035),(228,250,251,220),"bold","rt")
    tracked(d,i,w,h,elapsed,mode,color)
    base=Image.alpha_composite(base,ink)
    x=hpad; start=h*(.445 if vertical else .405)
    available=w*.88 if vertical else w*.62
    lines=TITLES[i]
    fs=int(h*(.076 if vertical else .099))
    # Real font-measured width, not character-count approximation.
    # Prevents the vertical 16:9/9:16 headline clipping observed in visual QA.
    while fs>20 and max(fnt(fs,"black").getlength(v) for v in lines)>available:
        fs-=1
    lh=fs*1.17
    for n,headline in enumerate(lines):
        pr=clamp((elapsed-.16-.22*n)/.6,0,1)
        reveal_text(base,(x,start+n*lh),headline,(248,252,251),fs,"black",pr)
    upper=Image.new("RGBA",(w,h),(0,0,0,0))
    d=ImageDraw.Draw(upper)
    y=start+lh*2+round(24*K(w,h))
    lx=x+w*.17*ease((elapsed-.8)/.7)
    line(d,[(x,y),(lx,y)],(*color,240),max(2,int(h*.003)))
    note=DETAILS[i]
    if elapsed>1.0:
        txt(d,(x,y+round(18*K(w,h))),note,h*(.015 if vertical else .018),(231,246,246,228),"bold")
    d.arc((w*.78,h*.85,w*.91,h*.98),195+elapsed*24,306+elapsed*24,fill=(*color,94),width=2)
    txt(d,(hpad,h*.967),LABELS["footer"],h*(.011 if vertical else .014),(235,245,244,185),"reg","lb")
    captions(d,w,h,tglobal,mode)
    base=Image.alpha_composite(base,upper)
    return base.convert("RGB")

def run_encoder(path,mode,seconds=None):
    w,h=SIZE[mode]; v=JOB["export"]["video"]
    total_frames=round((min(seconds,LENGTH) if seconds else LENGTH)*FPS)
    cmd=["ffmpeg","-y","-hide_banner","-loglevel","error",
         "-f","rawvideo","-pixel_format","rgb24","-video_size",f"{w}x{h}",
         "-framerate",str(FPS),"-i","pipe:0","-an",
         "-c:v",v["codec"],"-preset",v["preset"],"-crf",str(v["crf"]),"-pix_fmt","yuv420p","-r",str(FPS),
         "-movflags","+faststart",str(path)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    started=time.monotonic()
    try:
        for f in range(total_frames):
            tt=f/FPS;i,elapsed=at_time(tt)
            proc.stdin.write(frame(i,elapsed,tt,mode).tobytes())
            if f and f%300==0: print("PROGRESS",mode,f,"/",total_frames,round(time.monotonic()-started,1),"s",flush=True)
        proc.stdin.close()
        msg=proc.stderr.read().decode(errors="replace"); rc=proc.wait()
        if rc: raise RuntimeError(f"ffmpeg failed {rc}:\n{msg[-3000:]}")
    except:
        try:proc.stdin.close()
        except:pass
        proc.kill(); raise
    print("RENDERED",path,path.stat().st_size,round(time.monotonic()-started,2),"s",flush=True)

def main():
    p=argparse.ArgumentParser(description="Render one run's picture (no audio). Use engineering/drop_in_voice.py for the whole pipeline.")
    p.add_argument("--run",required=True,help="run folder containing job.json, timing.json and captions.srt")
    p.add_argument("--mode",choices=["land","vertical"],default="land")
    p.add_argument("--seconds",type=float,help="render only the first N seconds (proof)")
    p.add_argument("--still",type=float,nargs="*",help="write JPEG stills at these times instead of a video")
    args=p.parse_args(); init(args.run)
    tag="9x16" if args.mode=="vertical" else "16x9"
    if args.still:
        (RUN/"checks").mkdir(exist_ok=True)
        for t in args.still:
            i,elapsed=at_time(t); target=RUN/"checks"/f"still-{tag}-{t:05.1f}.jpg"
            frame(i,elapsed,t,args.mode).save(target,quality=92); print("STILL",target)
        return
    (RUN/"video").mkdir(exist_ok=True)
    run_encoder(RUN/"video"/f"_picture-{tag}.mp4",args.mode,args.seconds)
if __name__=="__main__": main()
