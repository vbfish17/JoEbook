/**
 * Tests for agentOrchestrator.ts — planAgentAllocation + buildRoleApiMap.
 */
import { describe, it, expect } from 'vitest';
import { planAgentAllocation, buildRoleApiMap, normalizeRoleApiConfig } from '../src/agentOrchestrator';
import type { RoleApiConfig } from '../src/agentOrchestrator';

// ── normalizeRoleApiConfig ────────────────────────────

describe('normalizeRoleApiConfig', () => {
  it('fills default values for undefined config', () => {
    const result = normalizeRoleApiConfig(undefined);
    expect(result).toEqual({ apiKey: '', baseUrl: '', model: '' });
  });

  it('preserves provided values', () => {
    const result = normalizeRoleApiConfig({ apiKey: 'k1', baseUrl: 'http://x', model: 'm1' });
    expect(result).toEqual({ apiKey: 'k1', baseUrl: 'http://x', model: 'm1' });
  });

  it('fills defaults for partial config', () => {
    const result = normalizeRoleApiConfig({ model: 'm1' });
    expect(result).toEqual({ apiKey: '', baseUrl: '', model: 'm1' });
  });
});

// ── buildRoleApiMap ──────────────────────────────────

describe('buildRoleApiMap', () => {
  it('uses defaults when no role overrides', () => {
    const defaultApi: RoleApiConfig = { apiKey: 'dk', baseUrl: 'http://default', model: 'dm' };
    const map = buildRoleApiMap(defaultApi, undefined);
    expect(map.planner.model).toBe('dm');
    expect(map.executor.model).toBe('dm');
    expect(map.proofreader.model).toBe('dm');
    expect(map.planner.apiKey).toBe('dk');
    expect(map.planner.baseUrl).toBe('http://default');
  });

  it('overrides per role', () => {
    const map = buildRoleApiMap(
      { baseUrl: 'http://default/v1', apiKey: 'dk', model: 'dm' },
      { planner: { model: 'planner-model' } }
    );
    expect(map.planner.model).toBe('planner-model');
    expect(map.planner.baseUrl).toBe('http://default/v1');
    expect(map.executor.model).toBe('dm');
  });

  it('handles no default (empty config)', () => {
    const map = buildRoleApiMap(undefined, {
      planner: { baseUrl: 'http://p', model: 'pm' },
      executor: { baseUrl: 'http://e', model: 'em' },
    });
    expect(map.planner.model).toBe('pm');
    expect(map.executor.model).toBe('em');
    expect(map.proofreader.model).toBe('');
  });
});

// ── planAgentAllocation ──────────────────────────────

describe('planAgentAllocation', () => {
  it('returns 0 executors for 0 items', () => {
    const plan = planAgentAllocation({ totalItems: 0 });
    expect(plan.roles.executor.count).toBe(0);
    expect(plan.roles.planner.count).toBe(0);
    expect(plan.roles.proofreader.count).toBe(0);
    expect(plan.summary).toContain('未检测到');
  });

  it('creates correct executor batches for simple case', () => {
    const plan = planAgentAllocation({
      totalItems: 100,
      batchSize: 20,
      maxExecutors: 6,
      enableProofreader: true,
    });
    expect(plan.roles.planner.count).toBe(1);
    expect(plan.roles.proofreader.count).toBe(1);
    expect(plan.executorBatches.length).toBe(5); // ceil(100/20)=5
    expect(plan.executorBatches.reduce((s, b) => s + b.itemCount, 0)).toBe(100);
  });

  it('caps executors at maxExecutors', () => {
    const plan = planAgentAllocation({ totalItems: 1000, batchSize: 1, maxExecutors: 4 });
    expect(plan.executorBatches.length).toBe(4);
  });

  it('with proofreader disabled', () => {
    const plan = planAgentAllocation({
      totalItems: 50,
      enableProofreader: false,
    });
    expect(plan.roles.proofreader.count).toBe(0);
  });

  it('handles fewer items than batch size', () => {
    const plan = planAgentAllocation({ totalItems: 3, batchSize: 20 });
    expect(plan.executorBatches.length).toBe(1);
    expect(plan.executorBatches[0].itemCount).toBe(3);
  });

  it('distributes items evenly across executors', () => {
    const plan = planAgentAllocation({ totalItems: 96, batchSize: 20, maxExecutors: 5 });
    // ceil(96/5) = 20 per executor, so 5 batches: 20+20+20+20+16=96
    expect(plan.executorBatches.length).toBe(5);
    const counts = plan.executorBatches.map(b => b.itemCount);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(96);
  });

  it('handles single item', () => {
    const plan = planAgentAllocation({ totalItems: 1 });
    expect(plan.executorBatches.length).toBe(1);
    expect(plan.executorBatches[0].itemCount).toBe(1);
    expect(plan.roles.planner.count).toBe(1);
  });

  it('handles negative totalItems (safe)', () => {
    const plan = planAgentAllocation({ totalItems: -5 });
    expect(plan.executorBatches.length).toBe(0);
    expect(plan.totalItems).toBe(0);
  });

  it('handles NaN totalItems (safe)', () => {
    const plan = planAgentAllocation({ totalItems: NaN });
    expect(plan.totalItems).toBe(0);
    expect(plan.executorBatches.length).toBe(0);
  });

  it('roleApi is passed to buildRoleApiMap internally', () => {
    const plan = planAgentAllocation({
      totalItems: 10,
      roleApi: {
        planner: { model: 'p1' },
        executor: { model: 'e1' },
      },
    });
    expect(plan.roles.planner.api.model).toBe('p1');
    expect(plan.roles.executor.api.model).toBe('e1');
  });

  it('batch IDs are sequential', () => {
    const plan = planAgentAllocation({ totalItems: 50, maxExecutors: 3 });
    expect(plan.executorBatches[0].id).toBe('executor-1');
    expect(plan.executorBatches[1].id).toBe('executor-2');
    expect(plan.executorBatches[2].id).toBe('executor-3');
  });

  it('start/end indices are correct', () => {
    const plan = planAgentAllocation({ totalItems: 50, maxExecutors: 3 });
    // ceil(50/3) = 17 per
    // batch 0: 0-17, batch 1: 17-34, batch 2: 34-50
    expect(plan.executorBatches[0].startIndex).toBe(0);
    expect(plan.executorBatches[0].endIndex).toBe(17);
    expect(plan.executorBatches[1].startIndex).toBe(17);
    expect(plan.executorBatches[1].endIndex).toBe(34);
    expect(plan.executorBatches[2].startIndex).toBe(34);
    expect(plan.executorBatches[2].endIndex).toBe(50);
  });

  it('summary includes only present roles', () => {
    const plan = planAgentAllocation({ totalItems: 10, enableProofreader: false });
    expect(plan.summary).toContain('规划智能体');
    expect(plan.summary).toContain('执行智能体');
    expect(plan.summary).not.toContain('校对智能体');
  });
});