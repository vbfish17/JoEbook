import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from string import Template

import fitz
from pdf2zh.high_level import translate_stream
from pdf2zh.doclayout import OnnxModel, ModelInstance

SYSTEM_CJK_FONT_MAP = {
    'zh': '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    'ja': '/System/Library/Fonts/Hiragino Sans GB.ttc',
    'ko': '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
}


def normalize_lang(value: str) -> str:
    text = (value or '').strip().lower()
    mapping = {
        'english': 'en',
        'en': 'en',
        'chinese': 'zh',
        'chinese (simplified)': 'zh',
        'chinese (traditional)': 'zh',
        'zh': 'zh',
        'japanese': 'ja',
        'ja': 'ja',
        'korean': 'ko',
        'ko': 'ko',
        'auto': 'en',
    }
    return mapping.get(text, value)


def clean_translated_text(text: str) -> str:
    normalized = unicodedata.normalize('NFKC', text or '')
    normalized = normalized.replace('\r\n', '\n').replace('\r', '\n')

    lines = normalized.split('\n')
    merged_lines = []
    idx = 0
    while idx < len(lines):
        current = lines[idx]
        if (
            idx + 1 < len(lines)
            and current
            and len(current.strip()) == 1
            and re.match(r'^[\u4e00-\u9fff]$', current.strip())
            and lines[idx + 1]
            and re.match(r'^[\u4e00-\u9fff]', lines[idx + 1].strip())
        ):
            merged_lines.append(current.strip() + lines[idx + 1].lstrip())
            idx += 2
            continue
        merged_lines.append(current)
        idx += 1

    normalized = '\n'.join(merged_lines)
    normalized = re.sub(r'(?<=[A-Za-z0-9])\n(?=[A-Za-z0-9])', ' ', normalized)
    normalized = re.sub(r'\n{3,}', '\n\n', normalized)
    # Strip trailing pinyin (e.g. "季度业务回顾 (Jìdù yèwù huígù)")
    normalized = re.sub(r'\s*\([^)]*[a-zA-Z].*\)$', '', normalized)
    return normalized.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--lang-in', required=True)
    parser.add_argument('--lang-out', required=True)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--api-key', default='not-required')
    parser.add_argument('--output-pdf', required=True)
    parser.add_argument('--output-dual-pdf', required=True)
    parser.add_argument('--output-text', required=True)
    parser.add_argument('--json-out', required=True)
    args = parser.parse_args()

    src = Path(args.input)
    pdf_bytes = src.read_bytes()

    ModelInstance.value = OnnxModel.load_available()
    lang_in = normalize_lang(args.lang_in)
    lang_out = normalize_lang(args.lang_out)

    envs = {
        'OPENAILIKED_BASE_URL': args.base_url,
        'OPENAILIKED_API_KEY': args.api_key,
        'OPENAILIKED_MODEL': args.model,
    }
    system_font = SYSTEM_CJK_FONT_MAP.get(lang_out)
    if system_font:
        envs['NOTO_FONT_PATH'] = system_font
    prompt = Template(
        'Translate to $lang_out. Only output the translation.\n\n$text'
    )

    mono, dual = translate_stream(
        pdf_bytes,
        lang_in=lang_in,
        lang_out=lang_out,
        service='openailiked',
        thread=1,
        model=ModelInstance.value,
        envs=envs,
        prompt=prompt,
    )

    out_pdf = Path(args.output_pdf)
    out_pdf.write_bytes(mono)
    out_dual_pdf = Path(args.output_dual_pdf)
    out_dual_pdf.write_bytes(dual)

    doc = fitz.open(stream=mono, filetype='pdf')
    mono_text_raw = '\n\n'.join(page.get_text().strip() for page in doc)
    mono_text = clean_translated_text(mono_text_raw)
    Path(args.output_text).write_text(mono_text, encoding='utf-8')

    dual_doc = fitz.open(stream=dual, filetype='pdf')
    dual_text_raw = '\n\n'.join(page.get_text().strip() for page in dual_doc)
    dual_text = clean_translated_text(dual_text_raw)

    result = {
        'pdf_path': str(out_pdf),
        'dual_pdf_path': str(out_dual_pdf),
        'text_path': str(args.output_text),
        'pdf_size': len(mono),
        'dual_pdf_size': len(dual),
        'text_chars': len(mono_text),
        'mono_text_preview': mono_text[:500],
        'dual_text_preview': dual_text[:500],
        'lang_in': lang_in,
        'lang_out': lang_out,
    }
    Path(args.json_out).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
