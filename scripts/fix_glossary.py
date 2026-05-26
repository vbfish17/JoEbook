#!/usr/bin/env python3
"""基于专业术语表修正译文 — 缩写保留英文，全称翻译为中文"""
import re, fitz
from pathlib import Path

PDF_IN = '/Volumes/MyDrive/参考资料/人工智能/AI智能体/building-effective-enterprise-agents_zh_translated.pdf'
PDF_OUT = '/Volumes/MyDrive/参考资料/人工智能/AI智能体/building-effective-enterprise-agents_zh_glossary.pdf'
FONT = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

# ── 专业术语表（英文→中文, 缩写保留英文）──
GLOSSARY = {
    # 核心设计
    'Outcomes-not-outputs': '重结果，而非过程产出',
    'Agent Suitability Framework': '智能体适用性评估框架',
    'Double Diamond Methodology': '双钻设计方法论',
    'Agent Design Card': '智能体设计卡',
    'Agent Architecture Design Language': '智能体架构设计语言',
    'Brownfield Integrations': '棕地集成',
    'Low-code vs Pro-code': '低代码与专业代码',
    'Model Context Protocol': '模型上下文协议',
    'Agent-to-Agent Protocol': '智能体对智能体协议',
    # 智能体形态
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
    # 数据与记忆
    'Retrieval-Augmented Generation': '检索增强生成',
    'Short-term Memory': '短期记忆',
    'Long-term Memory': '长期记忆',
    'Semantic Memory': '语义记忆',
    'Procedural Memory': '程序记忆',
    'Episodic Memory': '情境记忆',
    'Semantic Search': '语义搜索',
    'Hybrid Search': '混合搜索',
    'Model Routing': '模型路由',
    # 评估与运维
    'Golden Dataset': '黄金数据集',
    'Ground Truth': '基准真相',
    'LLM-as-judge': '大模型作为裁判',
    'F1 score': 'F1分值',
    'Trace logs': '链路追踪日志',
    'Telemetry': '遥测数据',
    'Acceptance Environment': '测试验收环境',
    # 安全与风险
    'Silent Failure': '静默失败',
    'Task Drift': '任务漂移',
    'Cross-Prompt Injection Attacks': '跨站提示词注入攻击',
    'PII masking': '个人隐私敏感信息脱敏遮蔽',
    'Inference-layer guardrails': '推理层安全护栏',
    'Security Operations Center': '安全运营中心',
    'Security Information & Event': '安全信息和事件管理',
    'Secure Access Service Edge': '安全访问服务边缘',
    # 通用修正
    'agent': '智能体',
    'agents': '智能体',
    'Agent': '智能体',
    'Agents': '智能体',
    '代理': '智能体',
    '特工': '智能体',
    '代理人': '智能体',
}

ABBREVIATIONS = {'ADC','AADL','RAG','MCP','A2A','LLMOps','FinOps','STM','LTM',
                 'HITL','HOTL','HOOTL','XPIA','PII','SOC','SIEM','SASE','UAT',
                 'SOTA','LLM','RBAC','EDR','XDR','SIEM','PoC'}

def fix_text(text):
    """应用术语修正,保留缩写"""
    t = text
    # 1. 全称匹配
    for eng, chn in GLOSSARY.items():
        if len(eng) > 3 and eng in t:
            t = t.replace(eng, chn)
    # 2. 中文替换
    for bad in ['代理','特工']:
        if bad in t:
            t = t.replace(bad, '智能体')
    # 3. 清理
    t = re.sub(r'智能体智能体', '智能体', t)
    return t.strip()

# ── Main ──
doc = fitz.open(PDF_IN)
fixed = 0

for pi in range(doc.page_count):
    page = doc[pi]
    blocks = page.get_text('dict').get('blocks', [])
    page.insert_font(fontfile=FONT, fontname='F0')

    for blk in blocks:
        if blk.get('type') != 0: continue
        for line in blk.get('lines', []):
            for sp in line.get('spans', []):
                t = sp.get('text', '')
                if not t.strip(): continue
                # 只修正已有中文的 span（跳过纯英文/数字）
                has_cn = any('\u4e00' <= c <= '\u9fff' for c in t)
                if not has_cn: continue
                
                new_t = fix_text(t)
                if new_t == t or not new_t: continue

                b = sp.get('bbox')
                x0, y0, x1, y1 = b
                sz = sp.get('size') or 9

                page.draw_rect(fitz.Rect(x0-2,y0-1,x1+2,y1+1), color=(1,1,1), fill=(1,1,1), width=0, overlay=True)
                page.insert_text((x0,y1-1), new_t, fontname='F0', fontsize=sz, color=(0,0,0))
                fixed += 1

doc.save(PDF_OUT, deflate=True, garbage=3)
print(f'Fixed {fixed} spans → {PDF_OUT}')
