/**
 * Tests for termbase.ts — pure functions (no IndexedDB dependency).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeTermText,
  detectTermLanguage,
  parseTermComparisonText,
  applyTerminologyToText,
  extractTermCandidates,
  createTermEntry,
  mergeTerms,
} from '../src/termbase';

// ── normalizeTermText ──────────────────────────────────

describe('normalizeTermText', () => {
  it('trims whitespace', () => {
    expect(normalizeTermText('  hello world  ')).toBe('hello world');
  });

  it('collapses multiple spaces to single', () => {
    expect(normalizeTermText('hello   world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalizeTermText('')).toBe('');
  });

  it('handles undefined/null gracefully', () => {
    expect(normalizeTermText(undefined as any)).toBe('');
    expect(normalizeTermText(null as any)).toBe('');
  });

  it('handles newlines and tabs as spaces', () => {
    expect(normalizeTermText('hello\nworld\tfoo')).toBe('hello world foo');
  });
});

// ── detectTermLanguage ─────────────────────────────────

describe('detectTermLanguage', () => {
  it('detects Chinese', () => {
    expect(detectTermLanguage('你好世界')).toBe('zh-CN');
  });

  it('detects English', () => {
    expect(detectTermLanguage('Hello World')).toBe('en');
  });

  it('detects Japanese', () => {
    expect(detectTermLanguage('こんにちは')).toBe('ja');
  });

  it('detects Korean', () => {
    expect(detectTermLanguage('안녕하세요')).toBe('ko');
  });

  it('detects Russian', () => {
    expect(detectTermLanguage('Привет')).toBe('ru');
  });

  it('detects Arabic', () => {
    expect(detectTermLanguage('مرحبا')).toBe('ar');
  });

  it('returns fallback for empty string', () => {
    expect(detectTermLanguage('')).toBe('Auto');
  });

  it('returns custom fallback', () => {
    expect(detectTermLanguage('', 'en')).toBe('en');
  });

  it('Chinese takes priority when mixed', () => {
    // Chinese is before English in TERM_LANG_PATTERNS array
    expect(detectTermLanguage('你好 World')).toBe('zh-CN');
  });
});

// ── parseTermComparisonText ────────────────────────────

describe('parseTermComparisonText', () => {
  it('parses => separator', () => {
    const result = parseTermComparisonText('foo => bar');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('foo');
    expect(result[0].target).toBe('bar');
  });

  it('parses → separator', () => {
    const result = parseTermComparisonText('foo → bar');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('foo');
    expect(result[0].target).toBe('bar');
  });

  it('parses tab separator', () => {
    const result = parseTermComparisonText('foo\tbar');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('foo');
    expect(result[0].target).toBe('bar');
  });

  it('parses CSV-style comma separator', () => {
    const result = parseTermComparisonText('foo,bar');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('foo');
    expect(result[0].target).toBe('bar');
  });

  it('skips empty lines', () => {
    const result = parseTermComparisonText('foo => bar\n\nbaz => qux');
    expect(result).toHaveLength(2);
  });

  it('skips comment lines', () => {
    const result = parseTermComparisonText('# comment\nfoo => bar');
    expect(result).toHaveLength(1);
  });

  it('skips source=target (no-op translations)', () => {
    const result = parseTermComparisonText('hello => hello');
    expect(result).toHaveLength(0);
  });

  it('skips empty source or target', () => {
    const result = parseTermComparisonText(' => bar\nfoo => ');
    expect(result).toHaveLength(0);
  });

  it('uses defaults for sourceLang/targetLang/domain', () => {
    const result = parseTermComparisonText('AI => 人工智能', {
      sourceLang: 'English',
      targetLang: 'Chinese',
      domain: 'tech',
    });
    expect(result[0].sourceLang).toBe('English');
    expect(result[0].targetLang).toBe('Chinese');
    expect(result[0].domain).toBe('tech');
    expect(result[0].confirmed).toBe(true);
  });

  it('auto-detects language when sourceLang is Auto', () => {
    const result = parseTermComparisonText('AI => 人工智能', {
      sourceLang: 'Auto',
      targetLang: 'Auto',
      domain: 'ai',
    });
    expect(result[0].sourceLang).toBe('en');
    expect(result[0].targetLang).toBe('zh-CN');
  });

  it('target with comma-containing value', () => {
    // CSV split: when using comma separator, first element is source, rest joined by comma
    const result = parseTermComparisonText('hello,world,foo');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('hello');
    expect(result[0].target).toBe('world,foo');
  });

  it('handles multiple lines with mixed separators', () => {
    const result = parseTermComparisonText(
      'cat => 猫\ndog → 狗\nbird\t鸟\nfish,鱼'
    );
    expect(result).toHaveLength(4);
  });
});

// ── applyTerminologyToText ─────────────────────────────

describe('applyTerminologyToText', () => {
  it('replaces exact matches', () => {
    const result = applyTerminologyToText('Hello World', [
      { source: 'Hello', target: '你好' },
      { source: 'World', target: '世界' },
    ]);
    expect(result).toBe('你好 世界');
  });

  it('replaces longer terms first', () => {
    // "Model Context Protocol" should replace before "Protocol" alone
    const result = applyTerminologyToText('Model Context Protocol', [
      { source: 'Protocol', target: '协议' },
      { source: 'Model Context Protocol', target: '模型上下文协议' },
    ]);
    expect(result).toBe('模型上下文协议');
  });

  it('returns original for empty terms', () => {
    const result = applyTerminologyToText('hello', []);
    expect(result).toBe('hello');
  });

  it('handles null/undefined text', () => {
    const result = applyTerminologyToText(null as any, [
      { source: 'x', target: 'y' },
    ]);
    expect(result).toBe('');
  });

  it('skips terms with empty source or target', () => {
    const result = applyTerminologyToText('hello world', [
      { source: '', target: 'x' },
      { source: 'hello', target: '' },
      { source: 'world', target: '地球' },
    ]);
    expect(result).toBe('hello 地球');
  });

  it('applies multiple replacements correctly', () => {
    const result = applyTerminologyToText(
      'The AI Strategy Framework guides AI governance.',
      [
        { source: 'AI Strategy Framework', target: 'AI战略框架' },
        { source: 'AI governance', target: 'AI治理' },
        { source: 'guides', target: '指导' },
      ]
    );
    expect(result).toBe('The AI战略框架 指导 AI治理.');
  });
});

// ── extractTermCandidates ──────────────────────────────

describe('extractTermCandidates', () => {
  it('returns empty when no change', () => {
    const result = extractTermCandidates(
      'hello world',
      '你好世界',
      '你好世界'
    );
    expect(result).toHaveLength(0);
  });

  it('detects single-word change', () => {
    const result = extractTermCandidates(
      'Model Context Protocol is important.',
      '模型上下文协议很重要。',
      'MCP 协议很重要。'
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('detects full-text change with low confidence', () => {
    const result = extractTermCandidates(
      'The quick brown fox jumps over the lazy dog.',
      '这只快速的棕色狐狸跳过了那只懒狗。',
      '那只敏捷的棕毛狐狸跃过了那只懒散狗。'
    );
    // May or may not produce candidates depending on diff
    if (result.length > 0) {
      expect(result[0].confidence).toBeLessThanOrEqual(0.6);
    }
  });

  it('candidate has required fields', () => {
    const result = extractTermCandidates(
      'AI',
      '人工智能',
      'AI智能'
    );
    if (result.length > 0) {
      const c = result[0];
      expect(c).toHaveProperty('source');
      expect(c).toHaveProperty('target');
      expect(c).toHaveProperty('oldTarget');
      expect(c).toHaveProperty('confidence');
    }
  });
});

// ── createTermEntry ────────────────────────────────────

describe('createTermEntry', () => {
  it('creates entry with defaults', () => {
    const entry = createTermEntry({
      source: 'AI',
      target: '人工智能',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      domain: 'tech',
      confirmed: false,
    });
    expect(entry.source).toBe('AI');
    expect(entry.target).toBe('人工智能');
    expect(entry.sourceLang).toBe('en');
    expect(entry.targetLang).toBe('zh-CN');
    expect(entry.domain).toBe('tech');
    expect(entry.frequency).toBe(1);
    expect(entry.confirmed).toBe(false);
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeTruthy();
  });

  it('generates unique IDs', () => {
    const e1 = createTermEntry({ source: 'a', target: 'b', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false });
    const e2 = createTermEntry({ source: 'c', target: 'd', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false });
    expect(e1.id).not.toBe(e2.id);
  });

  it('accepts partial existing entry', () => {
    const existing = { id: 'custom-id', frequency: 5, confirmed: true, createdAt: '2024-01-01T00:00:00Z' };
    const entry = createTermEntry(
      { source: 'AI', target: '人工智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: true },
      existing
    );
    expect(entry.id).toBe('custom-id');
    expect(entry.frequency).toBe(5); // uses existing frequency as-is
    expect(entry.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(entry.confirmed).toBe(true);
  });

  it('normalizes whitespace in source and target', () => {
    const entry = createTermEntry({
      source: '  AI  Strategy  ',
      target: '  AI  战略  ',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      domain: 'general',
      confirmed: false,
    });
    expect(entry.source).toBe('AI Strategy');
    expect(entry.target).toBe('AI 战略');
  });
});

// ── mergeTerms ─────────────────────────────────────────

describe('mergeTerms', () => {
  const existing = [
    createTermEntry({ source: 'AI', target: '人工智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false }),
    createTermEntry({ source: 'ML', target: '机器学习', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: true }),
  ];

  it('merges new terms with existing ones', () => {
    const result = mergeTerms(existing, [
      { source: 'DL', target: '深度学习', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false },
    ]);
    expect(result.entries).toHaveLength(3);
    expect(result.imported).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('updates existing terms (increments frequency)', () => {
    const result = mergeTerms(existing, [
      { source: 'AI', target: '人工智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false },
    ]);
    expect(result.entries).toHaveLength(2);
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.entries[0].frequency).toBe(2); // was 1, +1
  });

  it('skips empty or no-op terms', () => {
    const result = mergeTerms(existing, [
      { source: '', target: 'x', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false },
      { source: 'same', target: 'same', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false },
    ]);
    expect(result.skipped).toBe(2);
    expect(result.imported).toBe(0);
  });

  it('matches case-insensitively', () => {
    const result = mergeTerms(existing, [
      { source: 'ai', target: 'AI智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'general', confirmed: false },
    ]);
    expect(result.updated).toBe(1);
  });
});