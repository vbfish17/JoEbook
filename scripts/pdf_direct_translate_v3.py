#!/usr/bin/env python3
"""V3: 逐span API翻译 + 白底黑字覆盖"""
import re, fitz, json, urllib.request, time
from pathlib import Path

DOC = '/Volumes/MyDrive/参考资料/人工智能/AI智能体/building-effective-enterprise-agents.pdf'
OUT = '/Volumes/MyDrive/参考资料/人工智能/AI智能体/building-effective-enterprise-agents_zh_translated.pdf'
FONT = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
MODEL = 'gemma-4-e4b-it-mlx'
BASE = 'http://127.0.0.1:1234/v1'

def translate(text):
    if len(text.strip()) < 3: return text
    if re.match(r'^[-\d\s.,%$€£¥₩₽₹₱₿]+$', text.strip()) and len(text.strip()) < 10:
        return text
    prompt = f'Translate to Chinese. Only output the translation.\n\n{text}'
    body = json.dumps({'model':MODEL,'messages':[{'role':'user','content':prompt}],
        'temperature':0.0,'max_tokens':200}).encode()
    for _ in range(2):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(
                f'{BASE}/chat/completions',data=body,
                headers={'Content-Type':'application/json'})).read().decode())
            return r['choices'][0]['message']['content'].strip() or text
        except: time.sleep(1)
    return text

# ── Step 1: Extract all spans ──
doc = fitz.open(DOC)
all_spans = []
for pi in range(doc.page_count):
    page = doc[pi]
    blocks = page.get_text('dict').get('blocks',[])
    for blk in blocks:
        if blk.get('type') != 0: continue
        for line in blk.get('lines',[]):
            for sp in line.get('spans',[]):
                t = sp.get('text','').strip()
                if not t: continue
                if re.match(r'^[-\d\s.,%$€£¥₩₽₹₱₿]+$', t) and len(t) < 10: continue
                all_spans.append({
                    'text':t, 'bbox':sp.get('bbox'), 'size':sp.get('size'), 'page':pi,
                })
print(f'{len(all_spans)} spans extracted')

# ── Step 2: Translate all spans ──
translations = []
for i, sp in enumerate(all_spans):
    trans = translate(sp['text'])
    translations.append(trans)
    if (i+1) % 200 == 0: print(f'  {i+1}/{len(all_spans)} translated')

# ── Step 3: Overlay ──
doc2 = fitz.open(DOC)
done = 0
for pi in range(doc2.page_count):
    doc2[pi].insert_font(fontfile=FONT, fontname='F0')

for i, sp in enumerate(all_spans):
    trans = translations[i]
    if trans == sp['text']: continue
    page = doc2[sp['page']]
    b = sp['bbox']; x0,y0,x1,y1 = b; sz = sp['size'] or 9
    page.draw_rect(fitz.Rect(x0-2,y0-1,x1+2,y1+1), color=(1,1,1), fill=(1,1,1), width=0, overlay=True)
    page.insert_text((x0,y1-1), trans, fontname='F0', fontsize=sz, color=(0,0,0))
    done += 1

doc2.save(OUT, deflate=True, garbage=3)
print(f'{done} spans overlaid → {OUT}')
