/**
 * JoEbook Task State — Persistence layer for pipeline state using IndexedDB.
 */

import { get, set } from 'idb-keyval';
import type { TaskState, PipelinePhase, TranslationPlan, TranslatedBlock, ProofreadingReport } from '../agents/types';

const TASK_PREFIX = 'joebook-task-';
const PLAN_PREFIX = 'joebook-plan-';
const REPORT_PREFIX = 'joebook-report-';

export async function getTaskState(documentId: string): Promise<TaskState | null> {
  try {
    return await get<TaskState>(`${TASK_PREFIX}${documentId}`) || null;
  } catch {
    return null;
  }
}

export async function saveTaskState(state: TaskState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await set(`${TASK_PREFIX}${state.documentId}`, state);
}

export async function getPlan(documentId: string): Promise<TranslationPlan | null> {
  try {
    return await get<TranslationPlan>(`${PLAN_PREFIX}${documentId}`) || null;
  } catch {
    return null;
  }
}

export async function savePlan(documentId: string, plan: TranslationPlan): Promise<void> {
  await set(`${PLAN_PREFIX}${documentId}`, plan);
}

export async function getReport(documentId: string): Promise<ProofreadingReport | null> {
  try {
    return await get<ProofreadingReport>(`${REPORT_PREFIX}${documentId}`) || null;
  } catch {
    return null;
  }
}

export async function saveReport(documentId: string, report: ProofreadingReport): Promise<void> {
  await set(`${REPORT_PREFIX}${documentId}`, report);
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
  // idb-keyval doesn't support listing keys, so we rely on a known index key
  try {
    const index = await get<string[]>('joebook-task-index') || [];
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
  const index = await get<string[]>('joebook-task-index') || [];
  if (!index.includes(documentId)) {
    index.push(documentId);
    await set('joebook-task-index', index);
  }
}
