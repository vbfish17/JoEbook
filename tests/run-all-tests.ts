/**
 * Comprehensive JoEbook test suite — no external deps (uses node:assert only).
 * Run: npx tsx tests/run-all-tests.ts
 */
import assert from 'node:assert/strict';

// ── Test runner (inline) ────────────────────

// ── Imports from project ─────────────────────────────
import {
  normalizeTermText,
  detectTermLanguage,
  parseTermComparisonText,
  applyTerminologyToText,
  extractTermCandidates,
  createTermEntry,
  mergeTerms,
} from '../src/termbase';

import { planAgentAllocation, buildRoleApiMap, normalizeRoleApiConfig } from '../src/agentOrchestrator';

import { llmConfigToAgentConfig } from '../src/agents/types';

import { parseOpenAIStream } from '../src/model-gateway/llm-adapter';

import { createInitialTaskState } from '../src/orchestrator/task-state';

// ═══════════════════════════════════════════════════════════
// Test Runner (minimal, no deps)
// ═══════════════════════════════════════════════════════════
// Note: the test-runner is a separate file for cleanliness.
// We inline a minimal runner below for self-containment.

// We'll use a simple pattern: run each describe block, count pass/fail.

let totalPass = 0, totalFail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    totalPass++;
  } catch (err: any) {
    totalFail++;
    failures.push(`${name}: ${err.message}`);
  }
}

function suite(name: string, fn: () => void) {
  console.log(`\n=== ${name} ===`);
  fn();
}

// ═══════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════

// ── normalizeTermText ──────────────────────────────────
suite('normalizeTermText', () => {
  test('trims whitespace', () => {
    assert.equal(normalizeTermText('  hello world  '), 'hello world');
  });
  test('collapses multiple spaces', () => {
    assert.equal(normalizeTermText('hello   world'), 'hello world');
  });
  test('handles empty string', () => {
    assert.equal(normalizeTermText(''), '');
  });
  test('handles null/undefined', () => {
    assert.equal(normalizeTermText(undefined as any), '');
    assert.equal(normalizeTermText(null as any), '');
  });
  test('handles newlines and tabs', () => {
    assert.equal(normalizeTermText('hello\nworld\tfoo'), 'hello world foo');
  });
});

// ── detectTermLanguage ─────────────────────────────────
suite('detectTermLanguage', () => {
  test('detects Chinese', () => assert.equal(detectTermLanguage('你好世界'), 'zh-CN'));
  test('detects English', () => assert.equal(detectTermLanguage('Hello World'), 'en'));
  test('detects Japanese', () => assert.equal(detectTermLanguage('こんにちは'), 'ja'));
  test('detects Korean', () => assert.equal(detectTermLanguage('안녕하세요'), 'ko'));
  test('detects Russian', () => assert.equal(detectTermLanguage('Привет'), 'ru'));
  test('detects Arabic', () => assert.equal(detectTermLanguage('مرحبا'), 'ar'));
  test('returns fallback for empty', () => assert.equal(detectTermLanguage(''), 'Auto'));
  test('Chinese before English when mixed', () => assert.equal(detectTermLanguage('你好 World'), 'zh-CN'));
});

// ── parseTermComparisonText ────────────────────────────
suite('parseTermComparisonText', () => {
  test('=> separator', () => {
    const r = parseTermComparisonText('foo => bar');
    assert.equal(r.length, 1);
    assert.equal(r[0].source, 'foo');
    assert.equal(r[0].target, 'bar');
  });
  test('→ separator', () => {
    const r = parseTermComparisonText('foo → bar');
    assert.equal(r[0].source, 'foo');
  });
  test('tab separator', () => {
    const r = parseTermComparisonText('foo\tbar');
    assert.equal(r[0].source, 'foo');
  });
  test('skips comment lines', () => {
    const r = parseTermComparisonText('# comment\nfoo => bar');
    assert.equal(r.length, 1);
  });
  test('skips source=target', () => {
    const r = parseTermComparisonText('hello => hello');
    assert.equal(r.length, 0);
  });
  test('auto-detect language', () => {
    const r = parseTermComparisonText('AI => 人工智能', { sourceLang: 'Auto', targetLang: 'Auto', domain: 'ai' });
    assert.equal(r[0].sourceLang, 'en');
    assert.equal(r[0].targetLang, 'zh-CN');
  });
  test('multiple lines', () => {
    const r = parseTermComparisonText('cat => 猫\ndog => 狗\nbird => 鸟');
    assert.equal(r.length, 3);
  });
  test('empty source skipped', () => {
    const r = parseTermComparisonText(' => bar');
    assert.equal(r.length, 0);
  });
});

// ── applyTerminologyToText ─────────────────────────────
suite('applyTerminologyToText', () => {
  test('replaces exact matches', () => {
    const r = applyTerminologyToText('Hello World', [
      { source: 'Hello', target: '你好' },
      { source: 'World', target: '世界' },
    ]);
    assert.equal(r, '你好 世界');
  });
  test('longer terms first', () => {
    const r = applyTerminologyToText('Model Context Protocol', [
      { source: 'Protocol', target: '协议' },
      { source: 'Model Context Protocol', target: '模型上下文协议' },
    ]);
    assert.equal(r, '模型上下文协议');
  });
  test('empty terms returns original', () => {
    assert.equal(applyTerminologyToText('hello', []), 'hello');
  });
  test('null text returns empty', () => {
    assert.equal(applyTerminologyToText(null as any, [{ source: 'x', target: 'y' }]), '');
  });
  test('replaces known term (case-insensitive)', () => {
    const r = applyTerminologyToText('Model Context Protocol enables AI.', [
      { source: 'Model Context Protocol', target: '模型上下文协议' },
      { source: 'AI', target: '人工智能' },
    ]);
    assert.equal(r, '模型上下文协议 enables 人工智能.');
  });
  test('case-insensitive replacement', () => {
    const r = applyTerminologyToText('MODEL CONTEXT PROTOCOL is important.', [
      { source: 'Model Context Protocol', target: '模型上下文协议' },
    ]);
    assert.equal(r, '模型上下文协议 is important.');
  });
});

// ── extractTermCandidates ──────────────────────────────
suite('extractTermCandidates', () => {
  test('no change returns empty', () => {
    const r = extractTermCandidates('hello', '你好', '你好');
    assert.equal(r.length, 0);
  });
  test('single word change detected', () => {
    const r = extractTermCandidates('Model Context Protocol is important', '模型上下文协议很重要', 'MCP 协议很重要');
    assert.ok(r.length >= 1);
  });
});

// ── createTermEntry ────────────────────────────────────
suite('createTermEntry', () => {
  test('creates entry with defaults', () => {
    const e = createTermEntry({
      source: 'AI', target: '人工智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'tech', confirmed: false,
    });
    assert.equal(e.source, 'AI');
    assert.equal(e.frequency, 1);
    assert.ok(e.id);
  });
  test('unique IDs', () => {
    const mk = (s: string) => createTermEntry({ source: s, target: s, sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: false });
    assert.notEqual(mk('a').id, mk('b').id);
  });
  test('accepts existing partial', () => {
    const e = createTermEntry(
      { source: 'AI', target: '人工智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: true },
      { id: 'custom', frequency: 5, createdAt: '2024-01-01', confirmed: false }
    );
    assert.equal(e.id, 'custom');
    assert.equal(e.frequency, 5); // existing frequency is preserved (not auto-incremented in createTermEntry)
    assert.equal(e.createdAt, '2024-01-01');
  });
  test('normalizes whitespace', () => {
    const e = createTermEntry({ source: '  AI  ', target: '  人工智能  ', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: false });
    assert.equal(e.source, 'AI');
  });
});

// ── mergeTerms ─────────────────────────────────────────
suite('mergeTerms', () => {
  const existing = [
    createTermEntry({ source: 'AI', target: '人工智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: false }),
    createTermEntry({ source: 'ML', target: '机器学习', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: true }),
  ];
  test('adds new term', () => {
    const r = mergeTerms(existing, [{ source: 'DL', target: '深度学习', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: false }]);
    assert.equal(r.entries.length, 3);
    assert.equal(r.imported, 1);
  });
  test('updates existing (frequency)', () => {
    const r = mergeTerms(existing, [{ source: 'AI', target: '人工智能', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: false }]);
    assert.equal(r.updated, 1);
    assert.equal(r.entries[0].frequency, 2);
  });
  test('skips empty/same', () => {
    const r = mergeTerms(existing, [
      { source: '', target: 'x', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: false },
      { source: 'same', target: 'same', sourceLang: 'en', targetLang: 'zh-CN', domain: 'g', confirmed: false },
    ]);
    assert.equal(r.skipped, 2);
  });
});

// ── normalizeRoleApiConfig ────────────────────────────
suite('normalizeRoleApiConfig', () => {
  test('fills defaults', () => {
    assert.deepEqual(normalizeRoleApiConfig(undefined), { apiKey: '', baseUrl: '', model: '' });
  });
  test('preserves values', () => {
    assert.deepEqual(normalizeRoleApiConfig({ apiKey: 'k', baseUrl: 'url', model: 'm' }), { apiKey: 'k', baseUrl: 'url', model: 'm' });
  });
});

// ── buildRoleApiMap ──────────────────────────────────
suite('buildRoleApiMap', () => {
  test('defaults propagate', () => {
    const m = buildRoleApiMap({ apiKey: 'dk', baseUrl: 'http://d', model: 'dm' });
    assert.equal(m.planner.model, 'dm');
    assert.equal(m.executor.model, 'dm');
  });
  test('role override', () => {
    const m = buildRoleApiMap({ baseUrl: 'http://d/v1', apiKey: 'dk', model: 'dm' }, { planner: { model: 'pm' } });
    assert.equal(m.planner.model, 'pm');
    assert.equal(m.planner.baseUrl, 'http://d/v1');
    assert.equal(m.executor.model, 'dm');
  });
});

// ── planAgentAllocation ──────────────────────────────
suite('planAgentAllocation', () => {
  test('0 items = 0 executors', () => {
    const p = planAgentAllocation({ totalItems: 0 });
    assert.equal(p.roles.executor.count, 0);
  });
  test('simple case', () => {
    const p = planAgentAllocation({ totalItems: 100, batchSize: 20, maxExecutors: 6, enableProofreader: true });
    assert.equal(p.roles.planner.count, 1);
    assert.equal(p.roles.proofreader.count, 1);
    assert.equal(p.executorBatches.length, 5);
    assert.equal(p.executorBatches.reduce((s, b) => s + b.itemCount, 0), 100);
  });
  test('caps at maxExecutors', () => {
    const p = planAgentAllocation({ totalItems: 1000, batchSize: 1, maxExecutors: 4 });
    assert.equal(p.executorBatches.length, 4);
  });
  test('proofreader disabled', () => {
    const p = planAgentAllocation({ totalItems: 50, enableProofreader: false });
    assert.equal(p.roles.proofreader.count, 0);
  });
  test('fewer items than batch', () => {
    const p = planAgentAllocation({ totalItems: 3, batchSize: 20 });
    assert.equal(p.executorBatches[0].itemCount, 3);
  });
  test('negative totalItems safe', () => {
    const p = planAgentAllocation({ totalItems: -5 });
    assert.equal(p.totalItems, 0);
  });
  test('role API mapping', () => {
    const p = planAgentAllocation({ totalItems: 10, roleApi: { planner: { model: 'p1' }, executor: { model: 'e1' } } });
    assert.equal(p.roles.planner.api.model, 'p1');
    assert.equal(p.roles.executor.api.model, 'e1');
  });
  test('batch IDs sequential', () => {
    const p = planAgentAllocation({ totalItems: 50, maxExecutors: 3 });
    assert.equal(p.executorBatches[0].id, 'executor-1');
    assert.equal(p.executorBatches[1].id, 'executor-2');
  });
  test('start/end indices', () => {
    const p = planAgentAllocation({ totalItems: 50, maxExecutors: 3 });
    assert.equal(p.executorBatches[0].startIndex, 0);
    assert.equal(p.executorBatches[2].endIndex, 50);
  });
});

// ── llmConfigToAgentConfig ────────────────────────────
suite('llmConfigToAgentConfig', () => {
  test('ollama provider', () => {
    const c = llmConfigToAgentConfig({ provider: 'ollama', endpoint: 'http://localhost:11434/v1', modelName: 'qwen' });
    assert.equal(c.adapter, 'ollama');
  });
  test('ollama from URL (port 11434)', () => {
    const c = llmConfigToAgentConfig({ provider: 'custom', endpoint: 'http://x:11434/v1', modelName: 'm' });
    assert.equal(c.adapter, 'ollama');
  });
  test('llamacpp provider', () => {
    const c = llmConfigToAgentConfig({ provider: 'llamacpp', endpoint: 'http://localhost:8080/v1', modelName: 'llama' });
    assert.equal(c.adapter, 'llamacpp');
  });
  test('llamacpp from URL (port 8080)', () => {
    const c = llmConfigToAgentConfig({ provider: 'custom', endpoint: 'http://x:8080/v1', modelName: 'm' });
    assert.equal(c.adapter, 'llamacpp');
  });
  test('mlx provider', () => {
    const c = llmConfigToAgentConfig({ provider: 'mlx', endpoint: 'http://localhost:1234/v1', modelName: 'mlx-qwen' });
    assert.equal(c.adapter, 'mlx');
  });
  test('openai maps to openai-compatible', () => {
    const c = llmConfigToAgentConfig({ provider: 'openai', endpoint: 'https://api.openai.com/v1', modelName: 'gpt-4' });
    assert.equal(c.adapter, 'openai-compatible');
  });
  test('default openai-compatible for unknown', () => {
    const c = llmConfigToAgentConfig({ provider: 'custom', endpoint: 'https://x.com/v1', modelName: 'm' });
    assert.equal(c.adapter, 'openai-compatible');
  });
  test('url case-insensitive', () => {
    const c = llmConfigToAgentConfig({ provider: 'custom', endpoint: 'HTTP://LOCALHOST:11434', modelName: 'm' });
    assert.equal(c.adapter, 'ollama');
  });
  test('passes through apiKey/temperature/maxTokens', () => {
    const c = llmConfigToAgentConfig({ provider: 'openai', endpoint: 'https://x/v1', modelName: 'm', apiKey: 'sk-123', temperature: 0.5, maxTokens: 4096 });
    assert.equal(c.apiKey, 'sk-123');
    assert.equal(c.temperature, 0.5);
    assert.equal(c.maxTokens, 4096);
  });
});

// ── createInitialTaskState ────────────────────────────
suite('createInitialTaskState', () => {
  test('documentId set', () => {
    const s = createInitialTaskState('doc-1', 50);
    assert.equal(s.documentId, 'doc-1');
  });
  test('phase is planning', () => {
    const s = createInitialTaskState('d', 10);
    assert.equal(s.phase, 'planning');
  });
  test('totalBlocks set', () => {
    const s = createInitialTaskState('d', 42);
    assert.equal(s.progress.totalBlocks, 42);
  });
  test('completedBlocks starts at 0', () => {
    const s = createInitialTaskState('d', 100);
    assert.equal(s.progress.completedBlocks, 0);
  });
  test('plan is null', () => {
    assert.equal(createInitialTaskState('d', 10).plan, null);
  });
  test('empty arrays', () => {
    const s = createInitialTaskState('d', 10);
    assert.deepEqual(s.translatedBlocks, []);
    assert.deepEqual(s.reports, []);
  });
  test('valid ISO timestamps', () => {
    const s = createInitialTaskState('d', 10);
    assert.ok(Date.parse(s.startedAt) > 0);
    assert.equal(s.startedAt, s.updatedAt);
  });
});

// ═══════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${totalPass + totalFail} | Pass: ${totalPass} | Fail: ${totalFail}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('All tests passed ✓');
}