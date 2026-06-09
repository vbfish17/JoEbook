# JoEbook Multi-Agent Translation Pipeline — Architecture Design (v2.0)

## 1. Overview

The multi-agent pipeline adds a **Planner → Executor → Reviewer** three-stage workflow to JoEbook's existing document translation engine. All agents run fully locally through an abstracted model interface (Ollama/llama.cpp/MLX/OpenAI-compatible). No cloud APIs are required.

### Key Design Principles

- **Model-agnostic**: Every agent role accepts `LLMConfig` (provider, endpoint, model, apiKey) from the UI. No hardcoded model paths.
- **Full auto-execution**: Once triggered, the pipeline runs all three phases sequentially without requiring user clicks.
- **Coexistence with Babel Mode**: Multi-agent results (glossary, quality reports) are stored in IndexedDB. Users can later open Babel Mode to review/edit, but the pipeline itself does not block on human input.
- **Crash recovery**: Every phase persists its output to IndexedDB. On restart, incomplete tasks are detected and can be resumed.
- **Single-block retry**: On high-severity review issues, only the affected blocks are re-translated — not the entire document.

## 2. Three-Phase Data Flow

```
[Document AST + Blocks]
       ↓
  ┌─────────────────────────────────────┐
  │ Phase 1: Planner Agent              │
  │ - Scan blocks, extract terminology  │
  │ - Generate style prompt             │
  │ - Classify block constraints        │
  │ Output: TranslationPlan (IDB)       │
  └─────────────────────────────────────┘
       ↓
  ┌─────────────────────────────────────┐
  │ Phase 2: Executor Pool (N parallel) │
  │ - Per-block translation             │
  │ - Glossary enforcement in prompt    │
  │ - Constraint-aware length control   │
  │ - DOM anchor preservation           │
  │ Output: TranslatedBlock[] (IDB)     │
  └─────────────────────────────────────┘
       ↓
  ┌─────────────────────────────────────┐
  │ Phase 3: Reviewer Agent             │
  │ - Term consistency check            │
  │ - Tag integrity check               │
  │ - Semantic drift heuristic          │
  │ - Auto-patch low-severity issues    │
  │ - Single-block retry for high-sev   │
  │ Output: ProofreadingReport (IDB)    │
  └─────────────────────────────────────┘
       ↓
  [Final Translated Blocks → JoEbook Renderer]
```

## 3. Core Interfaces

### 3.1 LLMConfig (User-Facing)

```typescript
interface LLMConfig {
  provider: 'openai' | 'ollama' | 'llamacpp' | 'mlx' | 'custom';
  endpoint: string;
  apiKey?: string;
  modelName: string;
  contextLength?: number;
  temperature?: number;
  maxTokens?: number;
}
```

Each agent role (planner/executor/reviewer) can be independently configured with a different `LLMConfig` via the Settings UI.

### 3.2 PlannerOutput (Spec Canonical)

```typescript
interface PlannerOutput {
  glossary: Record<string, { target: string; category: string }>;
  style_prompt: string;
  block_constraints: Record<BlockId, 'Concise' | 'PreserveLayout' | 'ExpandAllowed'>;
  routing_hints?: Record<string, string>;
}
```

### 3.3 ExecutorOutput (Spec Canonical)

```typescript
interface ExecutorOutput {
  block_id: string;
  original_text: string;
  translated_text: string;
  preserved_tags: string[];
  confidence_score: number;  // 0~1
  dom_path: string;
}
```

### 3.4 ReviewerOutput (Spec Canonical)

```typescript
interface ReviewerOutput {
  block_id: string;
  final_text: string;
  issues: Array<{ type: IssueType; suggestion: string; severity: IssueSeverity }>;
  quality_score: number;  // 1~5
}
```

### 3.5 Internal Types

The internal pipeline uses camelCase versions (`TranslationPlan`, `TranslatedBlock`, `ProofreadingReport`) that extend the spec types with additional metadata (timestamps, retry counts, expansion ratios). Conversion functions bridge between the two naming conventions.

## 4. Model Gateway Architecture

```
LLMConfig → llmConfigToAgentConfig() → AgentModelConfig → createAdapter() → LLMAdapter
```

Supported adapters:
- `OllamaAdapter` — HTTP to Ollama's OpenAI-compatible endpoint
- `LlamaCppAdapter` — HTTP to llama.cpp server's /v1 endpoint
- `MLXAdapter` — HTTP to MLX server's /v1 endpoint
- `OpenAICompatibleAdapter` — Generic fallback for any OpenAI-like API

All adapters share `callOpenAICompatible()` and `streamOpenAICompatible()` utility functions for DRY. Each call respects `timeoutMs` from the `AgentsConfig.timeouts` section.

## 5. Orchestrator Logic

### 5.1 Pipeline Execution

```typescript
orchestrator.run(docAST, roleModels, existingGlossary?)
```

1. Check IndexedDB for existing task state (crash recovery).
2. **Planning phase**: Invoke `PlannerAgent.plan()`. On timeout/failure, auto-retry once.
3. **Execution phase**: Create `ExecutorPool` with configured concurrency (default 2). Each block translation result is persisted immediately.
4. **Reviewing phase**: Invoke `ProofreaderAgent.checkAll()`. Auto-apply low-severity patches. For high-severity issues, retry only affected blocks (up to `maxRetries`), then re-review only those blocks.

### 5.2 Concurrency Control

- `ExecutorPool` uses a semaphore-based `Semaphore` class.
- Default `maxConcurrency = 2` (v2.0 change from 4) to avoid OOM on small-VRAM machines.
- User can increase via `agents.config.json` → `executorPool.maxConcurrency`.

### 5.3 Timeout & Retry

- Each phase has a configurable timeout (default 60s): `timeouts.planner`, `timeouts.executor`, `timeouts.reviewer`.
- On first failure, `withRetry()` automatically retries once before giving up.
- For reviewer-detected high-severity issues, only the affected block IDs are re-submitted to the executor pool (single-block retry pattern).

### 5.4 State Persistence

- Task state: `joebook-task-{documentId}` in IndexedDB
- Translation plan: `joebook-plan-{documentId}`
- Review report: `joebook-report-{documentId}`
- Task index: `joebook-task-index` (for listing incomplete tasks on startup)

## 6. Constraint Classification Rules

The planner uses both LLM suggestions and deterministic overrides:

| Block Type | Deterministic Rule | LLM Suggestion Used? |
|---|---|---|
| code, table, list | `PreserveLayout` | No (overridden) |
| label, button, caption, textbox | `Concise` | No (overridden) |
| bbox.width < 200 | `Concise` | No (overridden) |
| Other blocks | LLM suggestion | Yes, fallback `ExpandAllowed` |

## 7. Glossary Enforcement

1. Planner extracts terms (frequency >= 3, non-stopword) and generates initial translations.
2. User-provided glossary entries override LLM-extracted ones (confirmed=true).
3. Executor receives only glossary terms that appear in the current block (filtered by `filterRelevantGlossary()`).
4. Executor prompt explicitly states "MUST use these exact translations".
5. Reviewer programmatically checks if each glossary term's target appears in the translated block.

## 8. Extensibility

- **New agent role**: Extend `BaseAgent`, implement `run()`, add to `AgentsConfig` and `TranslationOrchestrator.run()`.
- **New LLM backend**: Add a class implementing `LLMAdapter`, register in `createAdapter()` switch.
- **Custom prompt templates**: Replace files in `prompts/` directory. The agent constructors accept `systemPrompt` parameter.
- **Custom quality metrics**: Add check methods to `ProofreaderAgent` (e.g., embedding-based similarity when a model is configured).
