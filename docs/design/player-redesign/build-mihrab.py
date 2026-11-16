import re
import os
D=os.path.dirname(os.path.abspath(__file__))+'/'
s=open(D+'player-styles.html').read()
head=s[:s.index('<!-- Стили вариантов F1–F3')]
head=head.replace('Стили кнопок плеера (вариант E3, три подачи F1–F3). Рендер: node render-styles.mjs',
 'Михраб — три доработки варианта F3 (G1–G3). Рендер: node render-mihrab.mjs',1)
tail=s[s.index('<script>'):]
head=head.replace('<div class="hdr"><div class="ttl">Плеер</div><div class="circ"><svg width="22" height="22"><use href="#contrast"/></svg></div></div>',
 '<div class="hdr"><div class="ttl">Плеер</div><div style="display:flex;gap:8px"><div class="circ" style="font-size:14px;font-weight:600">1×</div><div class="circ"><svg width="20" height="20"><use href="#list"/></svg></div><div class="circ"><svg width="22" height="22"><use href="#contrast"/></svg></div></div></div>',1)
assert 'circ" style="font-size:14px' in head
import re as _re
head,n=_re.subn(r'<span class="cap" style="font-size:10px">Чтец</span>','<span class="cap" style="font-size:10px">Чтец · <span style="color:var(--brand)">✓</span> скачано</span>',head,1)
assert n==1

def arch(w,h,label=True,play=52):
    # Вся арка — одна кнопка «Слушать». Контур масштабируется, обводка — без искажения.
    return f'''<div class="arch" style="width:{w}px;height:{h}px">
   <svg width="{w}" height="{h}" viewBox="0 0 196 226" preserveAspectRatio="none" style="position:absolute;inset:0;stroke:none;overflow:visible">
    <path d="M1 225V104C1 52 48 22 98 1c50 21 97 51 97 103v121z" fill="url(#gold)" stroke="rgba(255,240,215,.55)" stroke-width="1" vector-effect="non-scaling-stroke"/>
    <path d="M13 225V108C13 64 54 37 98 15c44 22 85 49 85 93v117" fill="none" stroke="rgba(23,18,10,.22)" stroke-width="1" vector-effect="non-scaling-stroke"/>
   </svg>
   <div class="archin"><svg width="{play}" height="{play}"><use href="#play"/></svg>{'<span>Слушать</span>' if label else ''}</div>
  </div>'''

def seg_ayah(cls='gold'):
    return f'<div class="opt {cls}"><span>1</span><span>2</span><span class="on">3</span><span>5</span><span>∞</span></div>'
def seg_sura(on='next'):
    o=lambda k:' class="on"' if k==on else ''
    return (f'<div class="opt"><span{o("stop")}><svg width="17" height="17"><use href="#noentry"/></svg>Стоп</span>'
            f'<span{o("next")}><svg width="17" height="17"><use href="#arrowR"/></svg>Дальше</span>'
            f'<span{o("again")}><svg width="17" height="17"><use href="#rep1"/></svg>Заново</span></div>')

def reprows(hint=True):
    h='<div class="hint2">Сура закончится — включится следующая, Саба</div>' if hint else ''
    return f''' <div style="padding:0 16px">
  <div class="rowlbl"><svg width="14" height="14"><use href="#rep1"/></svg>Повтор аята</div>
  {seg_ayah()}
  <div class="rowlbl" style="margin-top:10px"><svg width="14" height="14"><use href="#book"/></svg>Повтор суры</div>
  {seg_sura()}
  {h}
 </div>'''

pills=''' <div style="display:flex;gap:8px;padding:0 16px;margin-top:12px"><div class="pill" style="height:36px;font-size:13px">1×</div><div class="pill" style="height:36px;font-size:13px"><svg width="16" height="16"><use href="#check"/></svg>Скачано</div><div class="pill" style="height:36px;font-size:13px;margin-left:auto"><svg width="16" height="16"><use href="#list"/></svg>Все суры</div></div>'''

extra=f'''
<!-- Михраб G1–G3 (16.11, владелец выбрал F3 «Михраб» и попросил: «После суры» → «Повтор суры» с иконками
     стоп / дальше / заново; два-три доработанных варианта, где главное выделено и лишнее не зацепить пальцем). -->
<style>
.arch{{position:relative;filter:drop-shadow(0 14px 26px rgba(0,0,0,.55))}}
.archin{{position:absolute;left:0;right:0;bottom:0;top:30%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#17120a}}
.archin svg{{transform:translateX(2px)}}
.archin span{{font-size:16px;font-weight:600;letter-spacing:.01em}}
.sm{{display:flex;flex-direction:column;align-items:center;gap:5px;color:var(--ink2)}}
.sm .cap{{font-size:11px}}
.rb{{width:60px;height:60px;border-radius:50%;background:var(--fill);border:1px solid var(--line);display:grid;place-items:center;color:var(--ink)}}
.rowlbl{{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);margin-bottom:6px;padding-left:2px}}
.opt{{display:flex;gap:4px;background:rgba(236,236,236,.05);border:1px solid var(--line);border-radius:14px;padding:3px}}
.opt span{{flex:1;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:13px;color:var(--ink2)}}
.opt span.on{{background:rgba(236,236,236,.15);color:var(--ink);font-weight:600}}
.opt.gold span.on{{background:var(--brand-soft);color:var(--brand)}}
.hint2{{font-size:12px;color:var(--ink3);margin-top:6px;padding-left:2px}}
.step{{display:flex;align-items:center;height:52px;border-radius:26px;background:rgba(236,236,236,.05);border:1px solid var(--line);padding:4px}}
.step .b{{height:44px;border-radius:22px;display:flex;align-items:center;gap:8px;padding:0 14px;background:var(--fill2);color:var(--ink);font-size:13px;flex:none}}
.step .mid{{flex:1;text-align:center;line-height:1.15}}
.navc{{width:44px;height:44px;border-radius:50%;background:var(--fill);border:1px solid var(--line);display:grid;place-items:center;color:var(--ink)}}
</style>
<svg width="0" height="0" style="position:absolute">
 <defs><linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ecd7b2"/><stop offset=".55" stop-color="#d8b98a"/><stop offset="1" stop-color="#c29e6c"/></linearGradient></defs>
 <!-- «Стоп» как знак «въезд запрещён»: круг с чертой -->
 <symbol id="noentry" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M7.8 12h8.4"/></symbol>
 <symbol id="arrowR" viewBox="0 0 24 24"><path d="M4.5 12h14"/><path d="M13 6.5l5.5 5.5-5.5 5.5"/></symbol>
</svg>

<!-- ───── G1 «Ниша»: вся арка — кнопка; аяты по бокам с широким зазором; суры парой ниже; повторы — две строки выбора ───── -->
<div class="phone" id="G1">
 <div class="chrome"></div>
 <div class="title"></div>
 <div class="reciterkey"></div>
 <div style="position:relative;height:220px;margin-top:18px">
  <div style="position:absolute;left:106.5px;top:0">{arch(180,220)}</div>
  <div class="sm" style="position:absolute;left:22px;top:90px"><div class="rb"><svg width="22" height="22"><use href="#prevA"/></svg></div><span class="cap">аят 18</span></div>
  <div class="sm" style="position:absolute;right:22px;top:90px"><div class="rb"><svg width="22" height="22"><use href="#nextA"/></svg></div><span class="cap">аят 20</span></div>
 </div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 16px;margin-top:14px">
  <div class="pill" style="height:40px;font-size:13px;justify-content:center;padding:0 10px"><svg width="14" height="14"><use href="#chevL"/></svg><span class="muted">32</span> Ас-Саджда</div>
  <div class="pill" style="height:40px;font-size:13px;justify-content:center;padding:0 10px">Саба <span class="muted">34</span><svg width="14" height="14"><use href="#chevR"/></svg></div>
 </div>
 <div style="margin-top:16px">{reprows(True)}</div>
 <div class="tabs"></div>
</div>

<!-- ───── G2 «Сура в заголовке»: смена суры — у названия, далеко от «Слушать»; у арки только аяты ───── -->
<div class="phone" id="G2">
 <div class="chrome"></div>
 <div style="display:flex;align-items:center;justify-content:space-between;padding:0 16px;margin-top:6px">
  <div class="sm"><div class="navc"><svg width="18" height="18"><use href="#chevL"/></svg></div><span class="cap">сура 32</span></div>
  <div class="c"><div class="ar" style="font-size:44px;line-height:1.25">الأحزاب</div><div style="font-size:19px;font-weight:600">Аль-Ахзаб · <span class="muted" style="font-weight:400">аят 19 из 73</span></div></div>
  <div class="sm"><div class="navc"><svg width="18" height="18"><use href="#chevR"/></svg></div><span class="cap">сура 34</span></div>
 </div>
 <div style="padding:0 20px;margin-top:12px"><div class="ticks"><b style="width:26%"></b></div></div>
 <div class="reciterkey"></div>
 <div style="position:relative;height:246px;margin-top:22px">
  <div style="position:absolute;left:99.5px;top:0">{arch(194,246)}</div>
  <div class="sm" style="position:absolute;left:16px;top:108px"><div class="rb"><svg width="22" height="22"><use href="#prevA"/></svg></div><span class="cap">аят 18</span></div>
  <div class="sm" style="position:absolute;right:16px;top:108px"><div class="rb"><svg width="22" height="22"><use href="#nextA"/></svg></div><span class="cap">аят 20</span></div>
 </div>
 <div style="margin-top:26px">{reprows(True)}</div>
 <div class="tabs"></div>
</div>

<!-- ───── G3 «Ступени»: арка одна в центре; аяты и суры — две полосы-переключателя, середина не нажимается ───── -->
<div class="phone" id="G3">
 <div class="chrome"></div>
 <div class="title"></div>
 <div class="reciterkey"></div>
 <div style="display:flex;justify-content:center;margin-top:16px">{arch(152,160,True,44)}</div>
 <div style="padding:0 16px;margin-top:16px">
  <div class="step"><div class="b"><svg width="18" height="18"><use href="#prevA"/></svg>18</div><div class="mid"><span class="cap" style="font-size:10px">аят</span><span style="font-size:15px;font-weight:600">19</span></div><div class="b">20<svg width="18" height="18"><use href="#nextA"/></svg></div></div>
  <div class="step" style="margin-top:8px;height:46px;background:none"><div class="b" style="height:36px;background:var(--fill);color:var(--ink2)"><svg width="14" height="14"><use href="#chevL"/></svg>Ас-Саджда</div><div class="mid"><span class="cap" style="font-size:10px">сура</span><span style="font-size:13px;color:var(--ink2)">33</span></div><div class="b" style="height:36px;background:var(--fill);color:var(--ink2)">Саба<svg width="14" height="14"><use href="#chevR"/></svg></div></div>
 </div>
 <div style="margin-top:14px">{reprows(False)}</div>
 <div class="tabs"></div>
</div>

'''
open(D+'mihrab.html','w').write(head+extra+tail)
r=open(D+'render-styles.mjs').read().replace('player-styles.html','mihrab.html').replace('["F1","F2","F3"]','["G1","G2","G3"]').replace('`styles-${id}.png`','`mihrab-${id}.png`').replace('стилей кнопок плеера (F1–F3)','вариантов «Михраб» (G1–G3)').replace('node render-reciter.mjs','node render-mihrab.mjs')
open(D+'render-mihrab.mjs','w').write(r)
