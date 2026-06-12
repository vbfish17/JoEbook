/**
 * JoEbook Task State — Persistence layer for pipeline state.
 *
 * In Electron main process (Node.js), IndexedDB is not available.
 * Falls back to in-memory Map + optional JSON file persistence.
 * In browser context (renderer), uses idb-keyval as before.
 */

import type { TaskState, TranslationPlan, TranslatedBlock, ProofreadingReport } from '../agents/types';

const TASK_PREFIX = 'joebook-task-';
const PLAN_PREFIX = 'joebook-plan-';
const REPORT_PREFIX = 'joebook-report-';

// ── In-Memory Store (Node.js main process fallback) ────
const memStore = new Map<string, any>();

function isNode(): boolean {
  return typeof window === 'undefined' && typeof indexedDB === 'undefined';
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  if (isNode()) {
    return memStore.get(key) as T | undefined;
  }
  try {
    const { get } = await import('idb-keyval');
    return await get<T>(key);
  } catch {
    return memStore.get(key) as T | undefined;
  }
}

async function kvSet(key: string, value: any): Promise<void> {
  if (isNode()) {
    memStore.set(key, value);
    return;
  }
  try {
    const { set } = await import('idb-keyval');
    await set(key, value);
  } catch {
    memStore.set(key, value);
  }
}

// ── Public API ──────────────────────────────────────────

export async function getTaskState(documentId: string): Promise<TaskState | null> {
  try {
    return (await kvGet<TaskState>(TASK_PREFIX + documentId)) || null;
  } catch {
    return null;
  }
}

export async function saveTaskState(state: TaskState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await kvSet(TASK_PREFIX + state.documentId, state);
}

export async function getPlan(documentId: string): Promise<TranslationPlan | null> {
  try {
    return (await kvGet<TranslationPlan>(PLAN_PREFIX + documentId)) || null;
  } catch {
    return null;
  }
}

export async function savePlan(documentId: string, plan: TranslationPlan): Promise<void> {
  await kvSet(PLAN_PREFIX + documentId, plan);
}

export async function getReport(documentId: string): Promise<ProofreadingReport | null> {
  try {
    return (await kvGet<ProofreadingReport>(REPORT_PREFIX + documentId)) || null;
  } catch {
    return null;
  }
}

export async function saveReport(documentId: string, report: ProofreadingReport): Promise<void> {
  await kvSet(REPORT_PREFIX + documentId, report);
}

export function createInitialTaskState(documentId: string, totalBlocks: number): TaskState {
  const now = new Date().toISOString();
  return {
    documentId,
    phase: 'planning',
    plan: null,
    translatedBlocks: [],
    reports: [],
    startedAt: now,
    updatedAt: now,
    progress: {
      totalBlocks,
      completedBlocks: 0,
      currentPhase: 'planning',
    },
  };
}

/**
 * Find all incomplete tasks for recovery on startup.
 */
export async function findIncompleteTasks(): Promise<TaskState[]> {
  try {
    const index = (await kvGet<string[]>('joebook-task-index')) || [];
    const incomplete: TaskState[] = [];
    for (const docId of index) {
      const state = await getTaskState(docId);
      if (state && state.phase !== 'completed' && state.phase !== 'failed') {
        incomplete.push(state);
      }
    }
    return incomplete;
  } catch {
    return [];
  }
}

export async function registerTaskIndex(documentId: string): Promise<void> {
  const index = (await kvGet<string[]>('joebook-task-index')) || [];
  if (index.indexOf(documentId) < 0) {
    index.push(documentId);
    await kvSet('joebook-task-index', index);
  }
}
