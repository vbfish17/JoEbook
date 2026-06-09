/**
 * JoEbook Multi-Agent Translation Pipeline — Core Type Definitions (v2.0)
 *
 * Aligned with the updated spec: PlannerOutput / ExecutorOutput / ReviewerOutput
 * naming, LLMConfig abstraction, configurable per-role model selection,
 * full auto-execution, single-block retry, and timeout support.
 */

// ── Block & Document Types ──────────────────────────────

export type BlockId = string;

export type BlockConstraint = 'Concise' | 'PreserveLayout' | 'ExpandAllowed';

export type BlockNodeType = 'paragraph' | 'heading' | 'table' | 'list' | 'code' | 'caption' | 'label' | 'button' | 'textbox';

export interface DocumentBlock {
  blockId: BlockId;
  text: string;
  nodeType: BlockNodeType;
  constraint?: BlockConstraint;
  bbox?: { width: number; height: number; x: number; y: number };
  style?: Record<string, string>;
  domPath: string;
  pageIndex?: number;
}

export interface DocumentAST {
  documentId: string;
  fileName: string;
  fileType: string;
  sourceLang: string;
  targetLang: string;
  domain: 'academic' | 'business' | 'general';
  blocks: DocumentBlock[];
  metadata?: Record<string, unknown>;
}

// ── LLM Configuration (v2.0 — model-agnostic, user-configurable) ──

export type LLMProvider = 'openai' | 'ollama' | 'llamacpp' | 'mlx' | 'custom';

export interface LLMConfig {
  provider: LLMProvider;
  endpoint: string;            // e.g. http://localhost:11434/v1
  apiKey?: string;
  modelName: string;
  contextLength?: number;
  temperature?: number;
  maxTokens?: number;
}

// ── Planner Output (v2.0 naming) ─────────────────────────

export interface GlossaryEntry {
  source: string;
  target: string;
  category: string;
  confirmed?: boolean;
  frequency?: number;
}

/**
 * v2.0 spec: PlannerOutput — the canonical output of the Planning agent.
 * Also kept as TranslationPlan for backward compat within orchestrator.
 */
export interface PlannerOutput {
  glossary: Record<string, { target: string; category: string }>;
  style_prompt: string;
  block_constraints: Record<BlockId, BlockConstraint>;
  routing_hints?: Record<string, string>;
}

/**
 * Internal TranslationPlan (extended from PlannerOutput for orchestrator use).
 * Adds flat glossary array + expansion ratio + timestamp for pipeline internals.
 */
export interface TranslationPlan {
  glossary: GlossaryEntry[];
  styleGuide: string;          // maps to style_prompt in PlannerOutput
  blockConstraints: Record<BlockId, BlockConstraint>;
  estimatedExpansionRatio: number;
  routingHints?: Record<string, string>;
  createdAt: string;
}

// ── Executor Output (v2.0 naming) ────────────────────────

/**
 * v2.0 spec: ExecutorOutput — canonical output of an Executor agent.
 */
export interface ExecutorOutput {
  block_id: string;
  original_text: string;
  translated_text: string;
  preserved_tags: string[];
  confidence_score: number;    // 0~1
  dom_path: string;
}

/**
 * Internal TranslatedBlock (extended from ExecutorOutput for pipeline use).
 * Keeps camelCase naming for TypeScript consistency within existing code.
 */
export interface TranslatedBlock {
  blockId: BlockId;
  originalText: string;
  translatedText: string;
  preservedTags: string[];
  confidence: number;          // 0~1 (maps to confidence_score)
  domPath: string;
  constraint: BlockConstraint;
  retryCount?: number;
}

// ── Reviewer Output (v2.0 naming) ────────────────────────

export type IssueType = 'term_mismatch' | 'tag_lost' | 'semantic_drift' | 'layout_overflow';
export type IssueSeverity = 'low' | 'medium' | 'high';
export type PatchAction = 'academic_polish' | 'native_rewrite' | 'fit_to_bbox';

/**
 * v2.0 spec: ReviewerOutput — per-block output from the Reviewer agent.
 */
export interface ReviewerOutput {
  block_id: string;
  final_text: string;           // the final translation (after auto-fix)
  issues: Array<{
    type: IssueType;
    suggestion: string;
    severity: IssueSeverity;
  }>;
  quality_score: number;        // 1~5
}

// ── Proofreading Report (internal, pipeline-level) ──────

export interface ProofIssue {
  blockId: BlockId;
  type: IssueType;
  description: string;
  suggestion: string;
  severity: IssueSeverity;
}

export interface ProofPatch {
  blockId: BlockId;
  action: PatchAction;
  patchedText: string;
  confidence: number;
}

export interface ProofreadingReport {
  issues: ProofIssue[];
  patches: ProofPatch[];
  summary: string;
  checkedAt: string;
  highSeverityCount: number;
}

// ── Task State ───────────────────────────────────────────

export type PipelinePhase = 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed';

export interface TaskState {
  documentId: string;
  phase: PipelinePhase;
  plan: TranslationPlan | null;
  translatedBlocks: TranslatedBlock[];
  reports: ProofreadingReport[];
  startedAt: string;
  updatedAt: string;
  error?: string;
  progress: {
    totalBlocks: number;
    completedBlocks: number;
    currentPhase: PipelinePhase;
  };
}

// ── Agent Configuration (v2.0 — bridges LLMConfig to internal adapter) ──

/**
 * Internal adapter config — derived from LLMConfig at runtime.
 * The frontend stores LLMConfig per role; the orchestrator converts
 * to AgentModelConfig before instantiating agents.
 */
export interface AgentModelConfig {
  adapter: 'ollama' | 'llamacpp' | 'mlx' | 'openai-compatible';
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentsConfig {
  planner?: AgentModelConfig;
  executor?: AgentModelConfig;
  proofreader?: AgentModelConfig;
  defaults?: Record<string, AgentModelConfig>;
  executorPool: {
    maxConcurrency: number;    // default 2 per v2.0 spec (was 4)
    batchSize: number;
  };
  proofreading: {
    autoRetryOnHighSeverity: boolean;
    maxRetries: number;
    semanticSimilarityThreshold: number;
  };
  timeouts?: {
    planner?: number;          // ms, default 60000
    executor?: number;         // ms, default 60000
    reviewer?: number;         // ms, default 60000
  };
}

// ── Event Protocol (SSE / IPC) ───────────────────────────

export type AgentEventType =
  | 'phase_change'
  | 'block_translated'
  | 'block_reviewed'
  | 'progress_update'
  | 'error'
  | 'complete';

export interface AgentEvent {
  type: AgentEventType;
  documentId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Context Window for Executor ──────────────────────────

export interface ExecutorContext {
  block: DocumentBlock;
  plan: TranslationPlan;
  previousBlocks: Array<{ original: string; translated: string }>;
  windowSize: number;
}

// ── User Edit History ────────────────────────────────────

export interface UserEditRecord {
  blockId: BlockId;
  beforeText: string;
  afterText: string;
  timestamp: string;
}

// ── Helper: Convert LLMConfig → AgentModelConfig ─────────

export function llmConfigToAgentConfig(llm: LLMConfig): AgentModelConfig {
  let adapter: AgentModelConfig['adapter'] = 'openai-compatible';
  const url = (llm.endpoint || '').toLowerCase();

  if (llm.provider === 'ollama' || url.indexOf(':11434') >= 0) adapter = 'ollama';
  else if (llm.provider === 'llamacpp' || url.indexOf(':8080') >= 0) adapter = 'llamacpp';
  else if (llm.provider === 'mlx' || url.indexOf(':1234') >= 0) adapter = 'mlx';
  else if (llm.provider === 'openai') adapter = 'openai-compatible';

  return {
    adapter,
    baseUrl: llm.endpoint,
    apiKey: llm.apiKey,
    model: llm.modelName,
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
  };
}
