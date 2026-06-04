#!/usr/bin/env python3
"""
PDF High-Fidelity Translation Workflow v3
=========================================
Integrated pipeline: page-wise API translation + white-rect overlay + glossary fix.

Key features:
- Per-span precise white rectangle covers original text (bbox + 2px margin)
- Black translated text inserted at exact original position
- Preserves original PDF layout, images, tables, and non-text elements
- API-parameterized: works with any OpenAI-compatible endpoint
- Batch translation by line groups (reduces API calls ~90%)
- Professional glossary post-processing for terminology consistency
- Font auto-detection for CJK text rendering

Architecture:
  Step 1: Extract all text spans with bbox/size metadata (page-wise)
  Step 2: Group spans by line proximity, batch-translate via API
  Step 3: White rect overlap + black text insertion (fit to original bbox)
  Step 4: Glossary-based terminology correction (Chinese text only)

Usage:
  python3 pdf_translate_workflow.py input.pdf \
    --output output.pdf \
    --base-url https://api.openai.com/v1 \
    --model gpt-4o \
    --api-key sk-xxx \
    --lang-in en \
    --lang-out zh \
 --font "/System/Library/Fonts/Supplemental/Arial Unicode.ttf" \\
--skip-glossary
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF


# ─────────────────────────────────────────────
# Color utilities
# ─────────────────────────────────────────────

def int_to_rgb(color_int):
    """PyMuPDF color (signed 32-bit) → (r, g, b) float tuple"""
    if color_int is None:
        return (0, 0, 0)
    if color_int < 0:
        color_int = color_int & 0xFFFFFFFF
    return (
        ((color_int >> 16) & 0xFF) / 255.0,
        ((color_int >> 8) & 0xFF) / 255.0,
        (color_int & 0xFF) / 255.0,
    )


# ─────────────────────────────────────────────
# Font auto-detection
# ─────────────────────────────────────────────

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",  # macOS
    "/System/Library/Fonts/STHeiti Light.ttc",                # macOS fallback
    "/System/Library/Fonts/PingFang.ttc",                     # macOS fallback 2
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", # Linux
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", # Linux alt
    "C:/Windows/Fonts/msyh.ttc",                               # Windows
    "C:/Windows/Fonts/simsun.ttc",                             # Windows fallback
]


def find_cjk_font(custom_path: Optional[str] = None) -> Optional[str]:
    """Find an external CJK-capable font file, or return None to use built-in china-s.

    By default (no --font), uses PyMuPDF built-in 'china-s' which supports
    Simplified Chinese without embedding any external font file, keeping
    PDF size minimal (vs Arial Unicode MS ~23MB embedded per document).

    Only searches for external fonts when --font is explicitly provided.
    """
    if custom_path and os.path.exists(custom_path):
        return custom_path

    # No custom font specified — use built-in china-s (returns None)
    # This avoids embedding the 23MB Arial Unicode MS font file
    return None


# ─────────────────────────────────────────────
# Professional glossary (English → Chinese)
# ─────────────────────────────────────────────

GLOSSARY = {
    # Core design
    "Outcomes-not-outputs": "重结果，而非过程产出",
    "Agent Suitability Framework": "智能体适用性评估框架",
    "Double Diamond Methodology": "双钻设计方法论",
    "Agent Design Card": "智能体设计卡",
    "Agent Architecture Design Language": "智能体架构设计语言",
    "Brownfield Integrations": "棕地集成",
    "Low-code vs Pro-code": "低代码与专业代码",
    "Model Context Protocol": "模型上下文协议",
    "Agent-to-Agent Protocol": "智能体对智能体协议",
    # Agent taxonomy
    "Single Agent": "单智能体",
    "Constrained Agent": "受限智能体",
    "Deep Agent": "深度智能体",
    "Autonomous Agent": "自主智能体",
    "Agent-assisted": "智能体辅助",
    "Human-in-the-loop": "人在回路中",
    "Human-on-the-loop": "人在线监控",
    "Human-out-of-the-loop": "人不在回路中",
    "Enterprise Orchestration": "企业级编排",
    "Domain Orchestration": "领域级编排",
    # Data & memory
    "Retrieval-Augmented Generation": "检索增强生成",
    "Short-term Memory": "短期记忆",
    "Long-term Memory": "长期记忆",
    "Semantic Memory": "语义记忆",
    "Procedural Memory": "程序记忆",
    "Episodic Memory": "情境记忆",
    "Semantic Search": "语义搜索",
    "Hybrid Search": "混合搜索",
    "Model Routing": "模型路由",
    # Evaluation & ops
    "Golden Dataset": "黄金数据集",
    "Ground Truth": "基准真相",
    "LLM-as-judge": "大模型作为裁判",
    "F1 score": "F1分值",
    "Trace logs": "链路追踪日志",
    "Telemetry": "遥测数据",
    "Acceptance Environment": "测试验收环境",
    # Security & risk
    "Silent Failure": "静默失败",
    "Task Drift": "任务漂移",
    "Cross-Prompt Injection Attacks": "跨站提示词注入攻击",
    "PII masking": "个人隐私敏感信息脱敏遮蔽",
    "Inference-layer guardrails": "推理层安全护栏",
    "Security Operations Center": "安全运营中心",
    "Security Information & Event": "安全信息和事件管理",
    "Secure Access Service Edge": "安全访问服务边缘",
}

# Abbreviations to preserve as-is
ABBREVIATIONS = {
    "RAG", "MCP", "A2A", "AI", "LLM", "API",
    "SOP", "SLA", "SOC", "SIEM", "SASE",
    "UAT", "SOTA", "RBAC", "EDR", "XDR",
    "ADC", "AADL", "LLMOps", "FinOps", "STM", "LTM",
    "HITL", "HOTL", "HOOTL", "XPIA", "PII", "PoC",
}


# ─────────────────────────────────────────────
# Text filtering
# ─────────────────────────────────────────────

def is_skip_text(text: str) -> bool:
    """Determine if a text span should be skipped (numbers/symbols only)."""
    t = text.strip()
    if not t or len(t) < 2:
        return True
    # Pure digits, symbols, currency, punctuation
    if re.match(r'^[\-\d\s.,%$€£¥₩₽₹₱₿+\-/\\*#@()\[\]{}]+$', t):
        return True
    return False


def has_chinese(text: str) -> bool:
    """Check if text contains any CJK characters."""
    return any('\u4e00' <= c <= '\u9fff' for c in text)


# ─────────────────────────────────────────────
# API translation
# ─────────────────────────────────────────────

class APITranslator:
    """OpenAI-compatible API translator with retry and batch support."""

    def __init__(self, base_url: str, model: str, api_key: str,
                 lang_in: str = "en", lang_out: str = "zh",
                 timeout: int = 60, max_retries: int = 2):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.lang_in = lang_in
        self.lang_out = lang_out
        self.timeout = timeout
        self.max_retries = max_retries

    def _api_call(self, messages: list, max_tokens: int = 2000) -> str:
        """Single API call with retries."""
        body = json.dumps({
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }).encode()

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        last_error = None
        for attempt in range(self.max_retries + 1):
            try:
                req = urllib.request.Request(
                    f"{self.base_url}/chat/completions",
                    data=body, headers=headers, method="POST"
                )
                resp = urllib.request.urlopen(req, timeout=self.timeout)
                raw = json.loads(resp.read().decode())
                return raw["choices"][0]["message"]["content"].strip()
            except Exception as e:
                last_error = str(e)
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)
        raise RuntimeError(f"API call failed after {self.max_retries + 1} attempts: {last_error}")

    def translate_batch(self, texts: list, target_lang: str = "Chinese") -> list:
        """Batch-translate a list of texts, returns translations in same order."""
        if not texts:
            return []

        results = []
        to_translate = []
        to_translate_indices = []

        for i, t in enumerate(texts):
            t = t.strip()
            if is_skip_text(t):
                results.append(t)
            else:
                results.append(None)
                to_translate.append(t)
                to_translate_indices.append(i)

        if not to_translate:
            return results

        # Build batch prompt
        prompt_lines = [f"[{idx}] {t}" for idx, t in enumerate(to_translate)]
        full_text = "\n".join(prompt_lines)

        prompt = (
            f"Translate each item below to {target_lang}. "
            f"Output each translation on a separate line with the same [N] prefix. "
            f"Only output the translations, no explanations.\n\n"
            f"{full_text}"
        )

        try:
            reply = self._api_call(
                [{"role": "user", "content": prompt}],
                max_tokens=300 * len(to_translate)
            )
            print(f"  [API] batch {len(to_translate)} items, reply length {len(reply)}", flush=True)
        except Exception as e:
            print(f"  [API ERROR] {e}", flush=True)
            # Fallback: return originals
            for i, r in enumerate(results):
                if r is None:
                    results[i] = texts[i]
            return results

        # Parse [N] prefixed translations
        trans_map = {}
        for line in reply.split("\n"):
            m = re.match(r"^\[(\d+)\]\s*(.+)", line.strip())
            if m:
                idx = int(m.group(1))
                trans_map[idx] = m.group(2).strip()

        # Fill results
        for ti, orig_idx in enumerate(to_translate_indices):
            results[orig_idx] = trans_map.get(ti, texts[orig_idx])

        # Safety: fill any remaining None
        for i, r in enumerate(results):
            if r is None:
                results[i] = texts[i]

        return results


# ─────────────────────────────────────────────
# Step 1: Page-wise translation + white-rect overlay
# ─────────────────────────────────────────────

def translate_pdf_pagewise(input_pdf: str, output_pdf: str,
                           translator: APITranslator,
                           font_path: str,
                           batch_size: int = 10) -> tuple:
    """
    Extract spans page by page, batch-translate, two-pass overlay.

    Two-pass overlay strategy (prevents translated text from being covered
    by overlapping white rectangles from adjacent spans):
      Pass 1: Draw ALL white rectangles (erase original text)
      Pass 2: Insert ALL translated text on top of the white layer

    Returns: (total_spans, overlaid_count)
    """
    doc = fitz.open(input_pdf)
    total_pages = doc.page_count
    total_spans = 0
    overlaid = 0

    # Phase 1: Extract all span metadata (page-wise)
    page_spans = []
    for pi in range(total_pages):
        spans = []
        for blk in doc[pi].get_text("dict").get("blocks", []):
            if blk.get("type") != 0: # skip non-text blocks
                continue
            for line in blk.get("lines", []):
                for sp in line.get("spans", []):
                    t = sp.get("text", "").strip()
                    if not t or is_skip_text(t):
                        continue
                    spans.append({
                        "text": t,
                        "bbox": sp.get("bbox"),
                        "size": sp.get("size", 9),
                        "color": sp.get("color", 0),
                        "font": sp.get("font", ""),
                        "flags": sp.get("flags", 0),
                    })
        page_spans.append(spans)
        total_spans += len(spans)

    print(f"Total: {total_pages} pages, {total_spans} text spans", flush=True)
    doc.close()

    # Phase 2: Translate per page, two-pass overlay
    out_doc = fitz.open(input_pdf)
    # Choose font: use external font if available, otherwise PyMuPDF built-in china-s
    # china-s is a built-in Simplified Chinese font that doesn't embed ~23MB font file
    cjk_fontname = "china-s"
    if font_path:
        cjk_fontname = "F0"

    for pi in range(total_pages):
        spans = page_spans[pi]
        if not spans:
            print(f"  Page {pi+1}/{total_pages}: 0 spans, skipped", flush=True)
            continue

        # Inject external CJK font for this page (only if using external font)
        if font_path:
            out_doc[pi].insert_font(fontfile=font_path, fontname="F0")

        # Group spans by line proximity (y-coordinate)
        sorted_spans = sorted(spans, key=lambda s: (s["bbox"][1], s["bbox"][0]))
        groups = []
        cur_group = [sorted_spans[0]]
        for s in sorted_spans[1:]:
            prev = cur_group[-1]
            y_gap = abs(s["bbox"][1] - prev["bbox"][1])
            avg_size = max(prev["size"], 6)
            if y_gap < avg_size * 1.2:
                cur_group.append(s)
            else:
                groups.append(cur_group)
                cur_group = [s]
        if cur_group:
            groups.append(cur_group)

        # Translate all groups first, collect overlay actions
        overlay_actions = []  # list of (span, translated_text)
        for g_idx, group in enumerate(groups):
            if len(group) > batch_size:
                sub_groups = [group[i:i+batch_size]
                              for i in range(0, len(group), batch_size)]
                for sg in sub_groups:
                    texts = [s["text"] for s in sg]
                    translated = translator.translate_batch(texts)
                    for s, t_text in zip(sg, translated):
                        if t_text == s["text"]:
                            continue
                        overlay_actions.append((s, t_text))
            else:
                texts = [s["text"] for s in group]
                translated = translator.translate_batch(texts)
                for s, t_text in zip(group, translated):
                    if t_text == s["text"]:
                        continue
                    overlay_actions.append((s, t_text))

        # === Two-pass overlay: ensures all text is above all white rects ===
        page_obj = out_doc[pi]
        page_overlay = 0

        # Pass 1: Draw ALL white rectangles (erase original text)
        for span, t_text in overlay_actions:
            b = span["bbox"]
            x0, y0, x1, y1 = b
            try:
                page_obj.draw_rect(
                    fitz.Rect(x0 - 2, y0 - 1, x1 + 2, y1 + 1),
                    color=(1, 1, 1), fill=(1, 1, 1),
                    width=0, overlay=True,
                )
            except Exception as e:
                print(f"    [WARN] draw_rect failed: {e}", flush=True)

        # Pass 2: Insert ALL translated text on top of the white layer
        for span, t_text in overlay_actions:
            b = span["bbox"]
            x0, y0, x1, y1 = b
            sz = max(span["size"], 6)
            try:
                # Auto-shrink font if translated text is wider than original bbox
                text_width = _measure_text_width(t_text, sz)
                bbox_width = x1 - x0
                if text_width > bbox_width and bbox_width > 0:
                    shrink_ratio = max(0.6, bbox_width / text_width)
                    sz = sz * shrink_ratio
                # Insert translated text (always on top of all white rects)
                page_obj.insert_text(
                    (x0, y1 - 1), t_text,
                    fontname=cjk_fontname, fontsize=sz, color=(0.0, 0.0, 0.0),
                )
                page_overlay += 1
            except Exception as e:
                print(f"    [WARN] insert_text failed: {e}", flush=True)

        overlaid += page_overlay
        print(f"  Page {pi+1}/{total_pages}: {len(spans)} spans, "
              f"{len(groups)} line groups, {page_overlay} overlaid",
              flush=True)

    out_doc.save(output_pdf, deflate=True, garbage=3)
    out_doc.close()
    print(f"Step 1 done: {overlaid}/{total_spans} text spans overlaid → {output_pdf}",
          flush=True)
    return total_spans, overlaid


def _measure_text_width(text: str, fontsize: float) -> float:
    """Estimate text width for font size auto-shrink.
    Uses CJK character width ≈ fontsize, Latin ≈ fontsize * 0.52."""
    width = 0.0
    for ch in text:
        if '\u4e00' <= ch <= '\u9fff' or '\u3000' <= ch <= '\u303f' or \
           '\uff00' <= ch <= '\uffef':
            width += fontsize  # CJK full-width
        elif ch in 'ilI.,;:|!':
            width += fontsize * 0.3  # narrow Latin
        elif ch in 'mwMW@':
            width += fontsize * 0.7  # wide Latin
        else:
            width += fontsize * 0.52  # average Latin
    return width


# ─────────────────────────────────────────────
# Step 2: Glossary post-processing
# ─────────────────────────────────────────────

def fix_glossary_on_pdf(input_pdf: str, output_pdf: str, font_path: Optional[str] = None) -> int:
    """Apply professional glossary corrections to Chinese text spans.
    Uses two-pass overlay to prevent text overlap from adjacent white rects.
    Uses built-in china-s font by default (no ~23MB font embedding)."""
    doc = fitz.open(input_pdf)
    fixed = 0

    # Choose font: built-in china-s unless external font provided
    cjk_fontname = "china-s"
    if font_path:
        cjk_fontname = "F0"

    # Sort glossary by key length (longer matches first)
    sorted_terms = sorted(GLOSSARY.items(), key=lambda x: -len(x[0]))

    for pi in range(doc.page_count):
        page = doc[pi]
        if font_path:
            page.insert_font(fontfile=font_path, fontname="F0")

        # Collect all glossary fix actions first
        fix_actions = []
        for blk in page.get_text("dict").get("blocks", []):
            if blk.get("type") != 0:
                continue
            for line in blk.get("lines", []):
                for sp in line.get("spans", []):
                    t = sp.get("text", "")
                    if not t.strip():
                        continue
                    # Only fix spans that already contain Chinese
                    if not has_chinese(t):
                        continue

                    new_t = t
                    for eng, chn in sorted_terms:
                        if eng in new_t and eng not in ABBREVIATIONS:
                            new_t = new_t.replace(eng, chn)

                    # Generic agent correction
                    for bad in ["代理", "特工"]:
                        if bad in new_t:
                            new_t = new_t.replace(bad, "智能体")
                    new_t = re.sub(r"智能体智能体", "智能体", new_t)

                    if new_t == t:
                        continue
                    fix_actions.append((sp.get("bbox"), new_t, sp.get("size", 9)))

        # Two-pass overlay: all white rects first, then all text
        for bbox, new_t, sz in fix_actions:
            x0, y0, x1, y1 = bbox
            try:
                page.draw_rect(
                    fitz.Rect(x0 - 2, y0 - 1, x1 + 2, y1 + 1),
                    color=(1, 1, 1), fill=(1, 1, 1),
                    width=0, overlay=True,
                )
            except Exception as e:
                print(f"    [WARN] glossary draw_rect on page {pi}: {e}", flush=True)

        for bbox, new_t, sz in fix_actions:
            x0, y0, x1, y1 = bbox
            # Auto-shrink if needed
            text_width = _measure_text_width(new_t, sz)
            bbox_width = x1 - x0
            if text_width > bbox_width and bbox_width > 0:
                shrink_ratio = max(0.6, bbox_width / text_width)
                sz = sz * shrink_ratio
            try:
                page.insert_text(
                    (x0, y1 - 1), new_t,
                    fontname=cjk_fontname,
                    fontsize=sz,
                    color=(0, 0, 0),
                )
                fixed += 1
            except Exception as e:
                print(f"    [WARN] glossary insert_text on page {pi}: {e}", flush=True)

    doc.save(output_pdf, deflate=True, garbage=3)
    doc.close()
    print(f"Step 2 done: {fixed} glossary corrections → {output_pdf}", flush=True)
    return fixed


# ─────────────────────────────────────────────
# CLI Entry point
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="PDF High-Fidelity Translation Workflow v3"
    )
    parser.add_argument("input", help="Input PDF file path")
    parser.add_argument("--output", "-o", help="Output PDF file path")
    parser.add_argument("--base-url", default="http://127.0.0.1:1234/v1",
                        help="OpenAI-compatible API base URL")
    parser.add_argument("--model", default="gemma-4-e4b-it-mlx",
                        help="Model name")
    parser.add_argument("--api-key", default="not-required",
                        help="API key (skip for local models)")
    parser.add_argument("--lang-in", default="en",
                        help="Source language")
    parser.add_argument("--lang-out", default="zh",
                        help="Target language")
    parser.add_argument("--font", default=None,
                        help="CJK font path (auto-detect if not specified)")
    parser.add_argument("--batch-size", type=int, default=10,
                        help="Spans per API batch")
    parser.add_argument("--skip-glossary", action="store_true",
                        help="Skip the glossary correction step")
    parser.add_argument("--glossary-json", default=None,
                        help="Optional JSON file with custom terminology mappings")
    parser.add_argument("--timeout", type=int, default=60,
                        help="API call timeout in seconds")

    args = parser.parse_args()

    if args.glossary_json:
        try:
            with open(args.glossary_json, 'r', encoding='utf-8') as f:
                custom_terms = json.load(f)
            if isinstance(custom_terms, list):
                for item in custom_terms:
                    if isinstance(item, dict) and item.get('source') and item.get('target'):
                        GLOSSARY[str(item['source'])] = str(item['target'])
            elif isinstance(custom_terms, dict):
                for source, target in custom_terms.items():
                    if source and target:
                        GLOSSARY[str(source)] = str(target)
            print(f"Loaded custom glossary terms: {len(custom_terms) if hasattr(custom_terms, '__len__') else 0}", flush=True)
        except Exception as exc:
            print(f"[WARN] failed to load custom glossary JSON: {exc}", flush=True)

    # Validate input
    src = Path(args.input)
    if not src.exists():
        print(f"Error: input file not found: {src}", file=sys.stderr, flush=True)
        sys.exit(1)

    # Resolve font (None = use built-in china-s, no font embedding needed)
    font_path = find_cjk_font(args.font)
    if font_path:
        print(f"Using CJK font: {font_path}", flush=True)
    else:
        print("Using built-in china-s font (no external font embedding)", flush=True)

    # Output path
    if args.output:
        out_path = Path(args.output)
    else:
        out_path = src.parent / f"{src.stem}_zh_glossary.pdf"

    # Setup translator
    translator = APITranslator(
        base_url=args.base_url,
        model=args.model,
        api_key=args.api_key,
        lang_in=args.lang_in,
        lang_out=args.lang_out,
        timeout=args.timeout,
    )

    # Step 1: Page-wise translation + overlay
    step1_out = src.parent / f"{src.stem}_zh_translated.pdf"
    print("\n=== Step 1: Page-wise Translation ===", flush=True)
    total, overlaid = translate_pdf_pagewise(
        str(src), str(step1_out), translator, font_path, args.batch_size
    )

    if args.skip_glossary:
        import shutil
        shutil.copy(str(step1_out), str(out_path))
        print(f"\n✅ Final (glossary skipped): {out_path}", flush=True)
        return

    # Step 2: Glossary post-processing
    print("\n=== Step 2: Glossary Correction ===", flush=True)
    fixed = fix_glossary_on_pdf(str(step1_out), str(out_path), font_path)

    print(f"\n✅ Done: {total} spans extracted, {overlaid} overlaid, "
          f"{fixed} glossary fixes → {out_path}", flush=True)

    # Write JSON result metadata
    result_json = out_path.parent / f"{out_path.stem}_result.json"
    meta = {
        "total_spans": total,
        "overlaid_count": overlaid,
        "glossary_fixes": fixed,
        "pdf_size": out_path.stat().st_size,
        "text_chars": total,  # approximate
    }
    with open(result_json, "w") as f:
        json.dump(meta, f, ensure_ascii=False)
    print(f"Result metadata: {result_json}", flush=True)


if __name__ == "__main__":
    main()