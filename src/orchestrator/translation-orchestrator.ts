/**
 * JoEbook Translation Orchestrator — Core pipeline controller (v2.0).
 *
 * Key changes from v1:
 * - Default concurrency = 2 (avoid OOM on small-VRAM machines)
 * - Full auto-execution: no user intervention required
 * - Per-block retry on high-severity issues (not full doc re-run)
 * - Configurable timeouts per agent role
 * - Detailed logging (prompt preview, response summary, elapsed time)
 * - Phase renamed: proofreading → reviewing (per v2.0 spec)
 * - Model configs come from frontend ModelProfile system, NOT hardcoded
 */

import { PlannerAgent } from '../agents/planner-agent';
import { ExecutorPool } from '../agents/executor-pool';
import { ProofreaderAgent } from '../agents/proofreader-agent';
import type {
  AgentModelConfig,
  AgentsConfig,
  DocumentAST,
  DocumentBlock,
  TranslationPlan,
  TranslatedBlock,
  ProofreadingReport,
  TaskState,
  PipelinePhase,
  AgentEvent,
  GlossaryEntry,
} from '../agents/types';
import {
  getTaskState,
  saveTaskState,
  getPlan,
  savePlan,
  getReport,
  saveReport,
  createInitialTaskState,
  registerTaskIndex,
} from './task-state';

export interface OrchestratorCallbacks {
  onEvent?: (event: AgentEvent) => void;
  onPhaseChange?: (phase: PipelinePhase, documentId: string) => void;
  onBlockTranslated?: (block: DocumentBlock, result: TranslatedBlock) => void;
  onProgress?: (completed: number, total: number, phase: PipelinePhase) => void;
}

/**
 * Runtime model configs per role — mirrors the frontend's
 * resolveAgentRoleApis() output. Each role gets its own
 * { baseUrl, apiKey, model } derived from the user's ModelProfile
 * selection. The orchestrator builds AgentModelConfig from these.
 */
export interface RoleModelConfigs {
  planner: { apiKey?: string; baseUrl?: string; model?: string };
  executor: { apiKey?: string; baseUrl?: string; model?: string };
  proofreader: { apiKey?: string; baseUrl?: string; model?: string };
}

/**
 * Detect adapter type from baseUrl patterns.
 */
function detectAdapter(baseUrl: string): AgentModelConfig['adapter'] {
  const url = (baseUrl || '').toLowerCase();
  if (url.indexOf(':11434') >= 0) return 'ollama';
  if (url.indexOf(':8080') >= 0) return 'llamacpp';
  if (url.indexOf(':1234') >= 0) return 'mlx';
  return 'openai-compatible';
}

/**
 * Convert a RoleModelConfig (from frontend) into an AgentModelConfig.
 * Falls back to agents.config.json defaults if any field is missing.
 */
function toAgentModelConfig(
  role: 'planner' | 'executor' | 'proofreader',
  roleConfig: { apiKey?: string; baseUrl?: string; model?: string },
  defaults: AgentsConfig,
): AgentModelConfig {
  const def: any = defaults[role] || (defaults.defaults as any || {})[role] || {};
  const baseUrl = roleConfig.baseUrl || def.baseUrl || 'http://localhost:11434/v1';
  return {
    adapter: detectAdapter(baseUrl),
    baseUrl,
    apiKey: roleConfig.apiKey || def.apiKey,
    model: roleConfig.model || def.model || 'qwen2.5:7b',
    temperature: def.temperature,
    maxTokens: def.maxTokens,
  };
}

export class TranslationOrchestrator {
  private config: AgentsConfig;
  private callbacks: OrchestratorCallbacks;
  private activeTasks: Map<string, { abortController: AbortController }> = new Map();

  constructor(config?: Partial<AgentsConfig>, callbacks?: OrchestratorCallbacks) {
    this.config = {
      executorPool: { maxConcurrency: 2, batchSize: 20 }, // v2.0: default 2
      proofreading: { autoRetryOnHighSeverity: true, maxRetries: 2, semanticSimilarityThreshold: 0.75 },
      timeouts: { planner: 60000, executor: 60000, reviewer: 60000 },
      ...config,
    };
    this.callbacks = callbacks || {};
  }

  /**
   * Run the full translation pipeline for a document — FULLY AUTOMATIC.
   * No user intervention required. Three phases execute sequentially.
   * If a phase fails, auto-retry once before marking as failed.
   * Results are persisted to IndexedDB for crash recovery.
   */
  async run(
    docAST: DocumentAST,
    roleModels: RoleModelConfigs,
    existingGlossary?: GlossaryEntry[],
  ): Promise<{ success: boolean; error?: string; taskState?: TaskState }> {
    const documentId = docAST.documentId;
    const abortController = new AbortController();
    this.activeTasks.set(documentId, { abortController });

    const plannerConfig = toAgentModelConfig('planner', roleModels.planner, this.config);
    const executorConfig = toAgentModelConfig('executor', roleModels.executor, this.config);
    const proofreaderConfig = toAgentModelConfig('proofreader', roleModels.proofreader, this.config);

    console.log('[Orchestrator] Starting pipeline for document:', documentId);
    console.log('[Orchestrator] Planner model:', plannerConfig.model, '@', plannerConfig.baseUrl);
    console.log('[Orchestrator] Executor model:', executorConfig.model, '@', executorConfig.baseUrl);
    console.log('[Orchestrator] Reviewer model:', proofreaderConfig.model, '@', proofreaderConfig.baseUrl);
    console.log('[Orchestrator] Concurrency:', this.config.executorPool.maxConcurrency);

    const planner = new PlannerAgent(plannerConfig);
    const proofreader = new ProofreaderAgent(
      proofreaderConfig,
      undefined,
      this.config.proofreading.semanticSimilarityThreshold,
    );

    try {
      // 1. Recover or create task state
      let state = await getTaskState(documentId);
      if (!state) {
        state = createInitialTaskState(documentId, docAST.blocks.length);
        await registerTaskIndex(documentId);
      }
      await saveTaskState(state);

      // 2. Planning phase (auto, with retry)
      if (state.phase === 'planning') {
        this.emitEvent('phase_change', documentId, { phase: 'planning' });
        if (this.callbacks.onProgress) this.callbacks.onProgress(0, docAST.blocks.length, 'planning');

        let plan = await getPlan(documentId);
        if (!plan) {
          plan = await this.withRetry(
            'planning',
            function() { return planner.plan(docAST, existingGlossary); },
            this.config.timeouts && this.config.timeouts.planner,
          );
          await savePlan(documentId, plan);
          console.log('[Orchestrator] Planning complete. Glossary entries:', plan.glossary.length);
          console.log('[Orchestrator] Style guide (first 100 chars):', plan.styleGuide.substring(0, 100));
        }

        state.plan = plan;
        state.phase = 'executing';
        state.progress.currentPhase = 'executing';
        await saveTaskState(state);
      }

      // 3. Execution phase (auto, parallel, with per-block retry)
      if (state.phase === 'executing') {
        this.emitEvent('phase_change', documentId, { phase: 'executing' });

        const plan = state.plan || await getPlan(documentId);
        if (!plan) {
          throw new Error('Translation plan not found — cannot execute without planning output');
        }

        const enrichedBlocks = docAST.blocks.map(function(b) {
          return {
            ...b,
            constraint: plan.blockConstraints[b.blockId] || b.constraint || 'ExpandAllowed',
          };
        });

        const existingResults = new Map<string, TranslatedBlock>();
        for (const tb of state.translatedBlocks) {
          existingResults.set(tb.blockId, tb);
        }

        const self = this;
        const pool = new ExecutorPool(executorConfig, {
          maxConcurrency: self.config.executorPool.maxConcurrency,
          windowSize: 3,
          sourceLang: docAST.sourceLang,
          targetLang: docAST.targetLang,
          onProgress: function(block, result) {
            if (!state) return;
            state.translatedBlocks.push(result);
            state.progress.completedBlocks = state.translatedBlocks.length;
            saveTaskState(state);
            self.emitEvent('block_translated', documentId, { blockId: block.blockId, result: result });
            if (self.callbacks.onBlockTranslated) self.callbacks.onBlockTranslated(block, result);
            if (self.callbacks.onProgress) self.callbacks.onProgress(state.translatedBlocks.length, enrichedBlocks.length, 'executing');
          },
          onError: function(block, error) {
            console.error('[Orchestrator] Block ' + block.blockId + ' error:', error.message);
          },
        });

        const results = await pool.run(enrichedBlocks, plan, existingResults);
        state.translatedBlocks = results;
        state.phase = 'reviewing'; // v2.0: renamed from 'proofreading'
        state.progress.currentPhase = 'reviewing';
        state.progress.completedBlocks = results.length;
        await saveTaskState(state);

        console.log('[Orchestrator] Execution complete. Blocks translated:', results.length);
      }

      // 4. Reviewing phase (auto, with single-block retry for high-severity)
      if (state.phase === 'reviewing') {
        this.emitEvent('phase_change', documentId, { phase: 'reviewing' });
        if (this.callbacks.onProgress) this.callbacks.onProgress(state.translatedBlocks.length, state.translatedBlocks.length, 'reviewing');

        const plan = state.plan || await getPlan(documentId);
        if (!plan) throw new Error('Plan missing during reviewing');

        const report = await this.withRetry(
          'reviewing',
          function() { return proofreader.checkAll(state!.translatedBlocks, plan); },
          this.config.timeouts && this.config.timeouts.reviewer,
        );
        await saveReport(documentId, report);
        state.reports = [report];

        console.log('[Orchestrator] Reviewing complete. Issues:', report.issues.length, '(high:', report.highSeverityCount, ')');

        // Auto-apply low-risk patches
        this.applyAutoPatches(state, report);

        // Single-block retry for high-severity issues (not full doc)
        if (this.config.proofreading.autoRetryOnHighSeverity && report.highSeverityCount > 0) {
          await this.retryHighSeverityBlocks(state, plan, executorConfig, proofreader);
        }

        state.phase = 'completed';
        state.progress.currentPhase = 'completed';
        await saveTaskState(state);

        console.log('[Orchestrator] Pipeline completed for document:', documentId);
      }

      this.emitEvent('complete', documentId, { phase: 'completed' });
      return { success: true, taskState: state };

    } catch (err: any) {
      console.error('[Orchestrator] Pipeline failed for ' + documentId + ':', err && err.message ? err.message : err);
      const state = await getTaskState(documentId);
      if (state) {
        state.phase = 'failed';
        state.error = err && err.message ? err.message : String(err);
        await saveTaskState(state);
      }
      this.emitEvent('error', documentId, { error: err && err.message ? err.message : String(err) });
      return { success: false, error: err && err.message ? err.message : String(err), taskState: state || undefined };
    } finally {
      this.activeTasks.delete(documentId);
    }
  }

  /**
   * Interactive polish: call the proofreader to rewrite a block.
   */
  async polishBlock(
    block: TranslatedBlock,
    action: 'academic_polish' | 'native_rewrite' | 'fit_to_bbox',
    plan: TranslationPlan,
    proofreaderRoleConfig: { apiKey?: string; baseUrl?: string; model?: string },
    context?: string,
  ): Promise<string> {
    const pConfig = toAgentModelConfig('proofreader', proofreaderRoleConfig, this.config);
    const proofreader = new ProofreaderAgent(pConfig, undefined, this.config.proofreading.semanticSimilarityThreshold);
    return proofreader.polish(block, action, plan, context);
  }

  abort(documentId: string): void {
    const task = this.activeTasks.get(documentId);
    if (task) {
      task.abortController.abort();
      this.activeTasks.delete(documentId);
      console.log('[Orchestrator] Aborted task:', documentId);
    }
  }

  async getState(documentId: string): Promise<TaskState | null> {
    return getTaskState(documentId);
  }

  // ── Private Helpers ────────────────────────────────────

  /**
   * Wrap an async operation with timeout + single retry on failure.
   */
  private async withRetry<T>(
    phase: string,
    fn: () => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    const timeout = timeoutMs || 60000;
    try {
      return await this.withTimeout(fn, timeout, phase);
    } catch (firstErr: any) {
      console.warn('[Orchestrator] ' + phase + ' failed (first attempt), retrying... Error:', firstErr && firstErr.message ? firstErr.message : firstErr);
      try {
        return await this.withTimeout(fn, timeout, phase);
      } catch (secondErr: any) {
        console.error('[Orchestrator] ' + phase + ' failed (second attempt):', secondErr && secondErr.message ? secondErr.message : secondErr);
        throw secondErr;
      }
    }
  }

  /**
   * Wrap an async operation with a timeout.
   */
  private withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>(function(resolve, reject) {
      const timer = setTimeout(function() {
        reject(new Error(label + ' timed out after ' + ms + 'ms'));
      }, ms);
      fn().then(function(result) {
        clearTimeout(timer);
        resolve(result);
      }).catch(function(err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private applyAutoPatches(state: TaskState, report: ProofreadingReport): void {
    for (const patch of report.patches) {
      if (patch.confidence >= 0.7) {
        const idx = state.translatedBlocks.findIndex(function(tb) { return tb.blockId === patch.blockId; });
        if (idx >= 0) {
          console.log('[Orchestrator] Auto-patching block:', patch.blockId, 'action:', patch.action);
          state.translatedBlocks[idx].translatedText = patch.patchedText;
        }
      }
    }
  }

  /**
   * Retry ONLY the blocks with high-severity issues — not the whole document.
   * After retry, re-run the proofreader on just those blocks.
   */
  private async retryHighSeverityBlocks(
    state: TaskState,
    plan: TranslationPlan,
    executorConfig: AgentModelConfig,
    proofreader: ProofreaderAgent,
  ): Promise<void> {
    const maxRetries = this.config.proofreading.maxRetries;
    const report = state.reports[state.reports.length - 1];
    if (!report) return;

    const highIssues = report.issues.filter(function(i) { return i.severity === 'high'; });
    if (highIssues.length === 0) return;

    const retryBlockIds: Set<string> = new Set();
    for (var i = 0; i < highIssues.length; i++) {
      retryBlockIds.add(highIssues[i].blockId);
    }

    const blocksToRetry = state.translatedBlocks.filter(function(tb) {
      return retryBlockIds.has(tb.blockId) && (tb.retryCount || 0) < maxRetries;
    });

    if (blocksToRetry.length === 0) return;

    console.log('[Orchestrator] Retrying ' + blocksToRetry.length + ' high-severity blocks (single-block retry, not full doc)...');

    const pool = new ExecutorPool(executorConfig, { maxConcurrency: 2, windowSize: 3 });

    const retryDocBlocks: DocumentBlock[] = blocksToRetry.map(function(tb) {
      return {
        blockId: tb.blockId,
        text: tb.originalText,
        nodeType: 'paragraph' as const,
        constraint: tb.constraint,
        domPath: tb.domPath,
      };
    });

    const retryResults = await pool.run(retryDocBlocks, plan);
    for (const result of retryResults) {
      const idx = state.translatedBlocks.findIndex(function(tb) { return tb.blockId === result.blockId; });
      if (idx >= 0) {
        state.translatedBlocks[idx] = {
          ...result,
          retryCount: (state.translatedBlocks[idx].retryCount || 0) + 1,
        };
        console.log('[Orchestrator] Block ' + result.blockId + ' re-translated (retry #' + state.translatedBlocks[idx].retryCount + ')');
      }
    }

    // Re-review only the retried blocks
    const retriedIds = new Set(retryResults.map(function(r) { return r.blockId; }));
    const retriedBlocks = state.translatedBlocks.filter(function(tb) { return retriedIds.has(tb.blockId); });
    try {
      const recheckReport = await proofreader.checkAll(retriedBlocks, plan);
      // Merge new issues (only keep issues for blocks not just retried)
      const oldNonRetryIssues = report.issues.filter(function(i) { return !retriedIds.has(i.blockId); });
      report.issues = oldNonRetryIssues.concat(recheckReport.issues);
      report.highSeverityCount = report.issues.filter(function(i) { return i.severity === 'high'; }).length;
      console.log('[Orchestrator] Re-review done. Remaining high-severity:', report.highSeverityCount);
    } catch (err: any) {
      console.warn('[Orchestrator] Re-review failed:', err && err.message ? err.message : err);
    }
  }

  private emitEvent(type: AgentEvent['type'], documentId: string, data: Record<string, unknown>): void {
    if (this.callbacks.onEvent) {
      this.callbacks.onEvent({ type: type, documentId: documentId, timestamp: new Date().toISOString(), data: data });
    }
  }
}
