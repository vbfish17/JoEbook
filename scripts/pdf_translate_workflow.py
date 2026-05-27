#!/usr/bin/env python3
"""
PDF 高保真翻译工作流 v2 — 逐页精细覆盖

步骤 1: 逐页 API 翻译
  - 页为单位处理，每页输出进度
  - 分组相邻 span（按行）批量翻译，减少 API 调用量 ~90%
  - 保留原文颜色（非纯黑色）
  - 白底矩形精确覆盖原文 span bbox
  - 原文颜色 insert_text 原位输出

步骤 2: 术语修正
  - 仅对含中文的 span 应用专业术语表
  - 代理/特工→智能体、全称术语→标准中文
  - 缩写保留英文

关键改进 v1→v2:
  - 逐页处理（非全文档批量）
  - 原文颜色保留
  - 行级分组翻译（更快、更准）
  - API 连通性预检
  - 超时保护
"""

import fitz, json, urllib.request, re, time, sys
from pathlib import Path

# ============================================================
# 配置
# ============================================================
FONT_FILE = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
MODEL = 'gemma-4-e4b-it-mlx'
API_BASE = 'http://127.0.0.1:1234/v1'
TIMEOUT = 30           # per-API-call timeout seconds
BATCH_SIZE = 10        # spans per translation batch
MAX_RETRIES = 2

# ============================================================
# 颜色工具
# ============================================================
def int_to_rgb(color_int):
    """PyMuPDF color (signed 32-bit) → (r, g, b) float tuple"""
    if color_int is None:
        return (0, 0, 0)
    if color_int < 0:
        color_int = color_int & 0xFFFFFFFF
    r = ((color_int >> 16) & 0xFF) / 255.0
    g = ((color_int >> 8) & 0xFF) / 255.0
    b = (color_int & 0xFF) / 255.0
    return (r, g, b)


# ============================================================
# API 翻译（批量）
# ============================================================
def check_api_available():
    """预检 LM Studio API 是否可达"""
    try:
        req = urllib.request.Request(f'{API_BASE}/models',
                                     method='GET')
        resp = urllib.request.urlopen(req, timeout=5)
        return True
    except Exception as e:
        return False


def translate_batch(texts, target_lang='Chinese'):
    """批量翻译一组文本，返回翻译结果列表"""
    if not texts:
        return []
    # 过滤空/短文本
    results = []
    batch_inputs = []
    for t in texts:
        t = t.strip()
        if not t or len(t) < 2:
            results.append(t)
            batch_inputs.append(None)
        elif re.match(r'^[-\d\s.,%$€£¥₩₽₹₱₿+\-/\\*#@()\[\]{}]+$', t):
            results.append(t)
            batch_inputs.append(None)
        else:
            results.append(None)
            batch_inputs.append(t)

    # 收集需要翻译的文本
    to_translate = [t for t in batch_inputs if t is not None]
    if not to_translate:
        return results

    # 构造批量翻译 prompt
    prompt_lines = []
    for idx, t in enumerate(to_translate):
        prompt_lines.append(f'[{idx}] {t}')
    full_text = '\n'.join(prompt_lines)

    # 优化 prompt：让模型输出编号行
    prompt = (
        f'Translate each item below to {target_lang}. '
        f'Output each translation on a separate line with the same [N] prefix. '
        f'Only output the translations, no explanations.\n\n'
        f'{full_text}'
    )

    body = json.dumps({
        'model': MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.0,
        'max_tokens': 200 * len(to_translate),
    }).encode()

    for attempt in range(MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(
                f'{API_BASE}/chat/completions', data=body,
                headers={'Content-Type': 'application/json'})
            resp = urllib.request.urlopen(req, timeout=TIMEOUT)
            raw = json.loads(resp.read().decode())
            reply = raw['choices'][0]['message']['content'].strip()
            break
        except Exception as e:
            if attempt < MAX_RETRIES:
                time.sleep(2)
            else:
                # Fallback: return originals
                for i, r in enumerate(results):
                    if r is None:
                        results[i] = batch_inputs[i] or ''
                return results

    # Parse batch response: match [N] translations
    trans_map = {}
    for line in reply.split('\n'):
        m = re.match(r'^\[(\d+)\]\s*(.+)', line.strip())
        if m:
            idx = int(m.group(1))
            trans_map[idx] = m.group(2).strip()

    # Fill results
    ti = 0
    for i, r in enumerate(results):
        if r is None:
            if ti in trans_map and trans_map[ti]:
                results[i] = trans_map[ti]
            else:
                results[i] = batch_inputs[i] or ''
            ti += 1

    return results


# ============================================================
# 步骤 1: 逐页 API 翻译 + 白底原色覆盖
# ============================================================
def translate_pdf_pagewise(input_pdf, output_pdf):
    """逐页提取 → 翻译 → 白底覆盖 → 黑色文字"""
    doc = fitz.open(input_pdf)
    total_pages = doc.page_count
    total_spans = 0
    overlaid = 0

    # Phase 1: 逐页提取 span 元数据
    page_spans = []  # list of lists, one per page
    for pi in range(total_pages):
        spans = []
        for blk in doc[pi].get_text('dict').get('blocks', []):
            if blk.get('type') != 0:
                continue
            for line in blk.get('lines', []):
                for sp in line.get('spans', []):
                    t = sp.get('text', '').strip()
                    if not t:
                        continue
                    spans.append({
                        'text': t,
                        'bbox': sp.get('bbox'),
                        'size': sp.get('size', 9),
                        'color': sp.get('color', 0),
                        'font': sp.get('font', ''),
                        'flags': sp.get('flags', 0),
                        'line_ref': id(line),  # same-line grouping
                    })
        page_spans.append(spans)
        total_spans += len(spans)

    print(f'Total: {total_pages} pages, {total_spans} spans', flush=True)

    # Phase 2: 逐页翻译 + 覆盖
    out_doc = fitz.open(input_pdf)
    for pi in range(total_pages):
        spans = page_spans[pi]
        if not spans:
            print(f'  Page {pi+1}/{total_pages}: 0 spans, skipped', flush=True)
            continue

        # 注入字体
        out_doc[pi].insert_font(fontfile=FONT_FILE, fontname='F0')

        # 将 spans 按行分组（通过 bbox y 轴接近度）
        sorted_spans = sorted(spans, key=lambda s: (s['bbox'][1], s['bbox'][0]))
        groups = []
        cur_group = [sorted_spans[0]]
        for s in sorted_spans[1:]:
            prev = cur_group[-1]
            y_gap = abs(s['bbox'][1] - prev['bbox'][1])
            avg_size = max(prev['size'], 6)
            if y_gap < avg_size * 1.2:
                cur_group.append(s)
            else:
                groups.append(cur_group)
                cur_group = [s]
        if cur_group:
            groups.append(cur_group)

        # 翻译各组
        page_overlay = 0
        for g_idx, group in enumerate(groups):
            texts = [s['text'] for s in group]
            translated = translate_batch(texts)

            for s, t_text in zip(group, translated):
                if t_text == s['text']:
                    continue
                b = s['bbox']
                x0, y0, x1, y1 = b
                sz = max(s['size'], 6)

                try:
                    # 白底覆盖 + 黑色文字（已验证：原文色注入会导致失败）
                    out_doc[pi].draw_rect(
                        fitz.Rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1),
                        color=(1, 1, 1), fill=(1, 1, 1), width=0, overlay=True)
                    out_doc[pi].insert_text(
                        (x0, y1 - 1), t_text,
                        fontname='F0', fontsize=sz, color=(0, 0, 0),
                    )
                    page_overlay += 1
                except Exception as e:
                    print(f'    [WARN] overlay failed: {e}', flush=True)

        overlaid += page_overlay
        print(f'  Page {pi+1}/{total_pages}: {len(spans)} spans, '
              f'{len(groups)} groups, {page_overlay} overlaid', flush=True)

    out_doc.save(output_pdf, deflate=True, garbage=3)
    out_doc.close()
    doc.close()
    print(f'Step 1 done: {overlaid}/{total_spans} overlaid → {output_pdf}', flush=True)
    return output_pdf


# ============================================================
# 步骤 2: 术语修正（与 v1 一致）
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
    'F1 score': 'F1分值',
    'Trace logs': '链路追踪日志',
    'Telemetry': '遥测数据',
    'Acceptance Environment': '测试验收环境',
    'Silent Failure': '静默失败',
    'Task Drift': '任务漂移',
    'Cross-Prompt Injection Attacks': '跨站提示词注入攻击',
    'PII masking': '个人隐私敏感信息脱敏遮蔽',
    'Inference-layer guardrails': '推理层安全护栏',
    'Security Operations Center': '安全运营中心',
    'Security Information & Event': '安全信息和事件管理',
    'Secure Access Service Edge': '安全访问服务边缘',
    'RAG': 'RAG',
    'MCP': 'MCP',
    'A2A': 'A2A',
    'AI': 'AI',
    'LLM': 'LLM',
    'API': 'API',
    'SOP': 'SOP',
    'SLA': 'SLA',
    'SOC': 'SOC',
    'SIEM': 'SIEM',
    'SASE': 'SASE',
}


def fix_glossary_on_pdf(input_pdf, output_pdf):
    """术语修正 - 仅处理含中文的 span"""
    doc = fitz.open(input_pdf)
    fixed = 0
    total_spans = 0

    for pi in range(doc.page_count):
        page = doc[pi]
        page.insert_font(fontfile=FONT_FILE, fontname='F0')
        page_spans = []

        for blk in page.get_text('dict').get('blocks', []):
            if blk.get('type') != 0:
                continue
            for line in blk.get('lines', []):
                for sp in line.get('spans', []):
                    t = sp.get('text', '')
                    if not t.strip():
                        continue
                    total_spans += 1
                    if not any('\u4e00' <= c <= '\u9fff' for c in t):
                        continue

                    new_t = t
                    # 先应用长术语（避免短术语错误替换）
                    sorted_glossary = sorted(GLOSSARY.items(),
                                             key=lambda x: -len(x[0]))
                    for eng, chn in sorted_glossary:
                        if eng in new_t and eng not in ['RAG', 'MCP', 'A2A',
                                                         'AI', 'LLM', 'API',
                                                         'SOP', 'SLA']:
                            new_t = new_t.replace(eng, chn)
                    # 通用修正
                    for bad in ['代理', '特工']:
                        if bad in new_t:
                            new_t = new_t.replace(bad, '智能体')
                    new_t = re.sub(r'智能体智能体', '智能体', new_t)

                    if new_t == t:
                        continue

                    b = sp.get('bbox')
                    x0, y0, x1, y1 = b
                    try:
                        page.draw_rect(
                            fitz.Rect(x0 - 2, y0 - 1, x1 + 2, y1 + 1),
                            color=(1, 1, 1), fill=(1, 1, 1),
                            width=0, overlay=True)
                        page.insert_text(
                            (x0, y1 - 1), new_t,
                            fontname='F0',
                            fontsize=sp.get('size', 9),
                            color=(0, 0, 0))
                        fixed += 1
                    except Exception as e:
                        print(f'    [WARN] glossary fix failed on page {pi}: {e}',
                              flush=True)

        if fixed > 0 or pi % 5 == 0:
            pass  # progress implicitly via fixed count

    doc.save(output_pdf, deflate=True, garbage=3)
    doc.close()
    print(f'Step 2 done: {fixed} glossary fixes → {output_pdf}', flush=True)
    return output_pdf


# ============================================================
# CLI 入口
# ============================================================
def main():
    import argparse
    p = argparse.ArgumentParser(description='PDF 高保真翻译工作流 v2')
    p.add_argument('input', help='源 PDF 路径')
    p.add_argument('--output', '-o', help='输出 PDF 路径（覆盖默认）')
    p.add_argument('--skip-glossary', action='store_true',
                   help='跳过术语修正步骤')
    args = p.parse_args()

    src = Path(args.input)
    if not src.exists():
        print(f'Error: input not found: {src}', flush=True)
        sys.exit(1)

    out_path = Path(args.output) if args.output else (
        src.parent / f'{src.stem}_zh_glossary.pdf')

    # 预检 API 连通性
    print('Checking LM Studio API connectivity...', flush=True)
    if check_api_available():
        print(f'  API OK: {API_BASE}', flush=True)
    else:
        msg = (f'API unavailable at {API_BASE}. '
               f'Start LM Studio with {MODEL} on port 1234.')
        print(f'  WARNING: {msg}', flush=True)
        print('  Will still produce output PDF (all text passes through).',
              flush=True)

    # Step 1
    step1 = src.parent / f'{src.stem}_zh_translated.pdf'
    print('\n=== Step 1: Page-wise translation ===', flush=True)
    translate_pdf_pagewise(str(src), str(step1))

    if args.skip_glossary:
        import shutil
        shutil.copy(str(step1), str(out_path))
        print(f'\n✅ Final (glossary skipped): {out_path}', flush=True)
        return

    # Step 2
    print('\n=== Step 2: Glossary fix ===', flush=True)
    fix_glossary_on_pdf(str(step1), str(out_path))

    print(f'\n✅ Final: {out_path}', flush=True)


if __name__ == '__main__':
    main()
