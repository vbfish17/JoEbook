#!/usr/bin/env python3
"""统一翻译函数 — Gemma 4 E4B IT MLX (本地主力模型)"""
import json, urllib.request, re

# Gemma 4 E4B: 通用指令模型, 用自然语言 prompt
PROMPT = '''\
Translate the following text from English to Simplified Chinese.
Rules:
- Output ONLY the Chinese translation.
- No explanations, no alternatives, no Pinyin, no commentary.
- If the text is a proper noun (name, brand), keep it as-is.
- If the text is a number/code, keep it as-is.

Text to translate:
{text}'''

def translate_one(text, base_url='http://127.0.0.1:1234/v1',
                  model='gemma-4-e4b-it-mlx',
                  context_texts=None):
    stripped = text.strip()
    if len(stripped) < 10 and context_texts and len(context_texts) > 1:
        full = ' '.join(t for t in context_texts if t.strip())
        if len(full) > len(stripped): stripped = full

    prompt = PROMPT.format(text=stripped)
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.0,
        'top_k': 1,
        'max_tokens': 200,
    }).encode()
    try:
        resp = json.loads(urllib.request.urlopen(urllib.request.Request(
            f'{base_url}/chat/completions', data=body,
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer not-required'}
        )).read().decode())
        reply = resp['choices'][0]['message']['content'].strip()
        if not reply: return text
        if 'Here are a few options' in reply or 'Please provide' in reply: return text
        return reply or text
    except Exception: return text


def translate_group(texts, base_url='http://127.0.0.1:1234/v1',
                    model='gemma-4-e4b-it-mlx'):
    merged = ' '.join(t for t in texts if t.strip())
    return translate_one(merged, base_url=base_url, model=model) if merged.strip() else ''


def should_skip(text):
    clean = text.replace('-','').replace(' ','').replace('.','').replace('~','')
    return clean.isdigit() and len(clean) <= 6
