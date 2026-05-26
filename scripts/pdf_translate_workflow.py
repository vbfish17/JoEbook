#!/usr/bin/env python3
"""
PDF 高保真翻译工作流

步骤 1: pdf_direct_translate_v3.py
  - 从源 PDF 逐 span 提取文本
  - 逐 span 调用本地 gemma-4-e4b-mlx API 翻译
  - 白底矩形精确覆盖原文 + 黑色译文 insert_text 原位输出
  - 输出: xxx_zh_translated.pdf

步骤 2: fix_glossary.py
  - 读取已翻译 PDF，仅对含中文的 span 应用专业术语表修正
  - 关键修正: 代理/特工→智能体、全称术语→标准中文
  - 缩写(RAG/MCP等)保留英文
  - 输出: xxx_zh_glossary.pdf

核心技术决策:
  - 使用 insert_text (非 insert_textbox) 避免多 span 字体损坏
  - 字体: fontfile=Arial Unicode, 一次性尾保存
  - 颜色: 白底 + 黑字 (保证任何背景下可见)
  - 术语: 先翻译后修正, 不直接替换
"""

import fitz, json, urllib.request, re, time, subprocess
from pathlib import Path

# ============================================================
# 配置
# ============================================================
SOURCE_PDF = None  # 由命令行传入
FONT_FILE = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
MODEL = 'gemma-4-e4b-it-mlx'
API_BASE = 'http://127.0.0.1:1234/v1'

# ============================================================
# 步骤 1: API 翻译
# ============================================================
def translate(text):
    if len(text.strip()) < 3: return text
    if re.match(r'^[-\d\s.,%$€£¥₩₽₹₱₿]+$', text.strip()): return text
    prompt = f'Translate to Chinese. Only output the translation.\n\n{text}'
    body = json.dumps({'model': MODEL, 'messages': [{'role': 'user', 'content': prompt}],
                        'temperature': 0.0, 'max_tokens': 200}).encode()
    for _ in range(2):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(
                f'{API_BASE}/chat/completions', data=body,
                headers={'Content-Type': 'application/json'})).read().decode())
            return r['choices'][0]['message']['content'].strip() or text
        except:
            time.sleep(1)
    return text


def translate_pdf(input_pdf, output_pdf):
    """全文翻译 + 白底黑字覆盖"""
    doc = fitz.open(input_pdf)
    
    # Phase A: 提取所有 span 并翻译
    all_spans = []
    for pi in range(doc.page_count):
        for blk in doc[pi].get_text('dict').get('blocks', []):
            if blk.get('type') != 0: continue
            for line in blk.get('lines', []):
                for sp in line.get('spans', []):
                    t = sp.get('text', '').strip()
                    if not t: continue
                    if re.match(r'^[-\d\s.,%$€£¥]+$', t): continue
                    all_spans.append({'text': t, 'bbox': sp.get('bbox'),
                                      'size': sp.get('size'), 'page': pi})
    print(f'{len(all_spans)} spans extracted')
    
    translations = []
    for i, sp in enumerate(all_spans):
        translations.append(translate(sp['text']))
        if (i + 1) % 200 == 0:
            print(f'  {i+1}/{len(all_spans)} translated')
    
    # Phase B: 覆盖
    doc2 = fitz.open(input_pdf)
    for pi in range(doc2.page_count):
        doc2[pi].insert_font(fontfile=FONT_FILE, fontname='F0')
    
    done = 0
    for i, sp in enumerate(all_spans):
        trans = translations[i]
        if trans == sp['text']: continue
        page = doc2[sp['page']]
        b = sp['bbox']; x0, y0, x1, y1 = b
        page.draw_rect(fitz.Rect(x0-2, y0-1, x1+2, y1+1), color=(1,1,1), fill=(1,1,1), width=0, overlay=True)
        page.insert_text((x0, y1-1), trans, fontname='F0', fontsize=sp['size'] or 9, color=(0,0,0))
        done += 1
    
    doc2.save(output_pdf, deflate=True, garbage=3)
    print(f'{done} spans overlaid → {output_pdf}')
    return output_pdf


# ============================================================
# 步骤 2: 术语修正
# ============================================================
GLOSSARY = {
    'Outcomes-not-outputs': '重结果，而非过程产出',
    'Agent Suitability Framework': '智能体适用性评估框架',
    'Double Diamond Methodology': '双钻设计方法论',
    'Agent Design Card': '智能体设计卡',
    'Agent Architecture Design Language': '智能体架构设计语言',
    'Brownfield Integrations': '棕地集成',
    'Low-code vs Pro-code': '低代码与专业代码',
    'Model Context Protocol': '模型上下文协议',
    'Agent-to-Agent Protocol': '智能体对智能体协议',
    'Single Agent': '单智能体',
    'Constrained Agent': '受限智能体',
    'Deep Agent': '深度智能体',
    'Autonomous Agent': '自主智能体',
    'Agent-assisted': '智能体辅助',
    'Human-in-the-loop': '人在回路中',
    'Human-on-the-loop': '人在线监控',
    'Human-out-of-the-loop': '人不在回路中',
    'Enterprise Orchestration': '企业级编排',
    'Domain Orchestration': '领域级编排',
    'Retrieval-Augmented Generation': '检索增强生成',
    'Short-term Memory': '短期记忆',
    'Long-term Memory': '长期记忆',
    'Semantic Memory': '语义记忆',
    'Procedural Memory': '程序记忆',
    'Episodic Memory': '情境记忆',
    'Semantic Search': '语义搜索',
    'Hybrid Search': '混合搜索',
    'Model Routing': '模型路由',
    'Golden Dataset': '黄金数据集',
    'Ground Truth': '基准真相',
    'LLM-as-judge': '大模型作为裁判',
    'Silent Failure': '静默失败',
    'Task Drift': '任务漂移',
    'Cross-Prompt Injection Attacks': '跨站提示词注入攻击',
    'PII masking': '个人隐私敏感信息脱敏遮蔽',
    'Inference-layer guardrails': '推理层安全护栏',
    'Security Operations Center': '安全运营中心',
    'Secure Access Service Edge': '安全访问服务边缘',
}


def fix_glossary_on_pdf(input_pdf, output_pdf):
    """术语修正 - 仅处理含中文的 span"""
    doc = fitz.open(input_pdf)
    fixed = 0
    
    for pi in range(doc.page_count):
        page = doc[pi]
        page.insert_font(fontfile=FONT_FILE, fontname='F0')
        for blk in page.get_text('dict').get('blocks', []):
            if blk.get('type') != 0: continue
            for line in blk.get('lines', []):
                for sp in line.get('spans', []):
                    t = sp.get('text', '')
                    if not t.strip(): continue
                    if not any('\u4e00' <= c <= '\u9fff' for c in t): continue
                    
                    new_t = t
                    for eng, chn in GLOSSARY.items():
                        if len(eng) > 3 and eng in new_t:
                            new_t = new_t.replace(eng, chn)
                    for bad in ['代理', '特工']:
                        if bad in new_t:
                            new_t = new_t.replace(bad, '智能体')
                    new_t = re.sub(r'智能体智能体', '智能体', new_t)
                    
                    if new_t == t: continue
                    b = sp.get('bbox'); x0, y0, x1, y1 = b
                    page.draw_rect(fitz.Rect(x0-2, y0-1, x1+2, y1+1), color=(1,1,1), fill=(1,1,1), width=0, overlay=True)
                    page.insert_text((x0, y1-1), new_t, fontname='F0', fontsize=sp.get('size') or 9, color=(0,0,0))
                    fixed += 1
    
    doc.save(output_pdf, deflate=True, garbage=3)
    print(f'Fixed {fixed} spans → {output_pdf}')
    return output_pdf


# ============================================================
def main():
    import argparse
    p = argparse.ArgumentParser(description='PDF 高保真翻译工作流')
    p.add_argument('input', help='源 PDF 路径')
    args = p.parse_args()
    
    src = Path(args.input)
    step1 = src.parent / f'{src.stem}_zh_translated.pdf'
    step2 = src.parent / f'{src.stem}_zh_final.pdf'
    
    print('=== Step 1: Full translation ===')
    translate_pdf(str(src), str(step1))
    
    print('\n=== Step 2: Glossary fix ===')
    fix_glossary_on_pdf(str(step1), str(step2))
    
    print(f'\n✅ Final: {step2}')


if __name__ == '__main__':
    main()
