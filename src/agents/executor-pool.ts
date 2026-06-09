/**
 * JoEbook Executor Pool — Concurrent execution of translation blocks.
 *
 * Manages N ExecutorAgent instances with semaphore-based concurrency control.
 * Each worker processes a batch of blocks sequentially, with progress callbacks.
 */

import { ExecutorAgent } from './executor-agent';
import type {
  AgentModelConfig,
  DocumentBlock,
  TranslatedBlock,
  TranslationPlan,
} from './types';

export interface ExecutorPoolOptions {
  maxConcurrency: number;
  windowSize: number;
  sourceLang?: string;
  targetLang?: string;
  onProgress?: (block: DocumentBlock, result: TranslatedBlock) => void;
  onError?: (block: DocumentBlock, error: Error) => void;
}

interface WorkerSlot {
  id: number;
  agent: ExecutorAgent;
  busy: boolean;
}

/**
 * Simple semaphore for controlling concurrency.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    if (this.queue.length > 0) {
      this.running++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export class ExecutorPool {
  private workers: WorkerSlot[] = [];
  private semaphore: Semaphore;
  private options: ExecutorPoolOptions;

  constructor(
    modelConfig: AgentModelConfig,
    options: Partial<ExecutorPoolOptions> = {},
  ) {
    const maxConcurrency = Math.max(1, options.maxConcurrency || 2); // v2.0: default 2 (was 4) to avoid OOM on small-VRAM machines
    this.options = {
      maxConcurrency,
      windowSize: options.windowSize || 3,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      onProgress: options.onProgress,
      onError: options.onError,
    };

    this.semaphore = new Semaphore(maxConcurrency);

    // Pre-create worker slots with shared model config
    for (let i = 0; i < maxConcurrency; i++) {
      this.workers.push({
        id: i,
        agent: new ExecutorAgent(modelConfig),
        busy: false,
      });
    }
  }

  /**
   * Run all blocks through the pool with concurrent execution.
   * Returns results in the same order as input blocks.
   */
  async run(
    blocks: DocumentBlock[],
    plan: TranslationPlan,
    existingResults?: Map<string, TranslatedBlock>,
  ): Promise<TranslatedBlock[]> {
    // Filter out already-completed blocks
    const pendingBlocks = blocks.filter(
      b => !existingResults?.has(b.blockId),
    );

    const resultMap = new Map<string, TranslatedBlock>();
  // Populate with existing results
  if (existingResults) {
    existingResults.forEach(function(result, id) { resultMap.set(id, result); });
  }

    // Process pending blocks concurrently
    const tasks = pendingBlocks.map((block, index) =>
      this.processBlock(block, index, pendingBlocks, plan, resultMap),
    );

    await Promise.all(tasks);

    // Return results in original block order
    return blocks.map(b => resultMap.get(b.blockId)!).filter(Boolean);
  }

  /**
   * Process a single block through an available worker.
   */
  private async processBlock(
    block: DocumentBlock,
    index: number,
    allBlocks: DocumentBlock[],
    plan: TranslationPlan,
    resultMap: Map<string, TranslatedBlock>,
  ): Promise<void> {
    await this.semaphore.acquire();

    try {
      // Build sliding window context from already-completed blocks
      const windowSize = this.options.windowSize;
      const previousBlocks: Array<{ original: string; translated: string }> = [];

      for (let i = Math.max(0, index - windowSize); i < index; i++) {
        const prevBlock = allBlocks[i];
        const prevResult = resultMap.get(prevBlock.blockId);
        if (prevResult) {
          previousBlocks.push({
            original: prevBlock.text,
            translated: prevResult.translatedText,
          });
        }
      }

      // Find an available worker
      const worker = this.workers.find(w => !w.busy) || this.workers[0];
      worker.busy = true;

      try {
        const result = await worker.agent.execute(
          block,
          plan,
          previousBlocks,
          this.options.sourceLang,
          this.options.targetLang,
        );

        resultMap.set(block.blockId, result);

        if (this.options.onProgress) {
          this.options.onProgress(block, result);
        }
      } finally {
        worker.busy = false;
      }
    } catch (err: any) {
      console.error(`[ExecutorPool] Block ${block.blockId} failed:`, err?.message || err);

      // Fallback: use original text
      const fallbackResult: TranslatedBlock = {
        blockId: block.blockId,
        originalText: block.text,
        translatedText: block.text,
        preservedTags: [],
        confidence: 0,
        domPath: block.domPath,
        constraint: block.constraint || 'ExpandAllowed',
        retryCount: 0,
      };
      resultMap.set(block.blockId, fallbackResult);

      if (this.options.onError) {
        this.options.onError(block, err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Get the number of active workers.
   */
  get activeCount(): number {
    return this.workers.filter(w => w.busy).length;
  }

  /**
   * Get the total number of worker slots.
   */
  get size(): number {
    return this.workers.length;
  }
}
