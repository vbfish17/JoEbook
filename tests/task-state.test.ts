/**
 * Tests for task-state.ts — in-memory KV store for Node.js environment.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialTaskState,
} from '../src/orchestrator/task-state';

describe('createInitialTaskState', () => {
  it('creates state with correct documentId', () => {
    const state = createInitialTaskState('doc-1', 50);
    expect(state.documentId).toBe('doc-1');
  });

  it('initializes with planning phase', () => {
    const state = createInitialTaskState('doc-1', 10);
    expect(state.phase).toBe('planning');
    expect(state.progress.currentPhase).toBe('planning');
  });

  it('sets total blocks correctly', () => {
    const state = createInitialTaskState('doc-1', 42);
    expect(state.progress.totalBlocks).toBe(42);
  });

  it('starts with 0 completed blocks', () => {
    const state = createInitialTaskState('doc-1', 100);
    expect(state.progress.completedBlocks).toBe(0);
  });

  it('has null plan initially', () => {
    const state = createInitialTaskState('doc-1', 10);
    expect(state.plan).toBeNull();
  });

  it('has empty translated blocks array', () => {
    const state = createInitialTaskState('doc-1', 10);
    expect(state.translatedBlocks).toEqual([]);
  });

  it('has empty reports array', () => {
    const state = createInitialTaskState('doc-1', 10);
    expect(state.reports).toEqual([]);
  });

  it('has valid timestamps', () => {
    const state = createInitialTaskState('doc-1', 10);
    expect(state.startedAt).toBeTruthy();
    expect(state.updatedAt).toBeTruthy();
    expect(state.startedAt).toBe(state.updatedAt);
    // Should be ISO format
    expect(new Date(state.startedAt).toISOString()).toBe(state.startedAt);
  });

  it('handles zero total blocks', () => {
    const state = createInitialTaskState('empty-doc', 0);
    expect(state.progress.totalBlocks).toBe(0);
    expect(state.phase).toBe('planning');
  });
});