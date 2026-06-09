# JoEbook Multi-Agent Pipeline — Integration Guide (v2.0)

## 1. Prerequisites

- JoEbook running with Electron + React dev server
- A local LLM backend accessible (Ollama, llama.cpp server, or MLX)
- At least one model downloaded (e.g., `qwen2.5:7b` via Ollama)

## 2. Enabling Multi-Agent Mode

### 2.1 Settings UI Toggle

In the JoEbook Settings panel, enable:

```
[x] Enable Multi-Agent Workflow (Planner → Executor → Reviewer)
```

When enabled, the `translateDocument` function routes through `TranslationOrchestrator.run()` instead of the legacy single-model path. When disabled, behavior is unchanged.

### 2.2 Per-Role Model Configuration

For each agent role, configure:

| Field | Planner | Executor | Reviewer |
|---|---|---|---|
| Provider | ollama | openai-compatible | ollama |
| Endpoint | http://localhost:11434/v1 | http://127.0.0.1:1234/v1 | http://localhost:11434/v1 |
| Model | qwen2.5:7b | translategemma-4b | qwen2.5:7b |
| API Key | (leave blank for local) | (leave blank) | (leave blank) |

Click "Test Connection" to verify each endpoint is reachable.

### 2.3 Concurrency Setting

Default: **2** parallel executor workers. Increase to 4+ if your machine has sufficient RAM/VRAM. Edit `agents.config.json`:

```json
{ "executorPool": { "maxConcurrency": 4 } }
```

## 3. API Endpoints (Server → Frontend Bridge)

### 3.1 Start Pipeline

```
POST /api/orchestrator/run
Body: {
  documentId: string,
  fileName: string,
  blocks: Array<{ blockId, text, nodeType, bbox?, domPath? }>,
  sourceLang: string,
  targetLang: string,
  domain: 'academic' | 'business' | 'general',
  roleModels: {
    planner: { baseUrl, apiKey?, model },
    executor: { baseUrl, apiKey?, model },
    proofreader: { baseUrl, apiKey?, model }
  },
  glossaryTerms?: GlossaryEntry[]
}
Response: { started: true, documentId }
```

The pipeline runs asynchronously. Poll progress via the progress endpoint.

### 3.2 Poll Progress

```
GET /api/orchestrator/progress/:documentId
Response: {
  status: string,    // e.g. "阶段: executing (45/200 块)"
  progress: number,  // 0~100
  phase: string,     // planning | executing | reviewing | completed | failed
  result?: TaskState // present when completed
}
```

### 3.3 Interactive Polish

```
POST /api/orchestrator/polish
Body: {
  blockId: string,
  originalText: string,
  translatedText: string,
  constraint: BlockConstraint,
  action: 'academic_polish' | 'native_rewrite' | 'fit_to_bbox',
  plan: TranslationPlan,
  roleModels: { proofreader: { baseUrl, model } },
  context?: string
}
Response: { success: true, polishedText: string }
```

## 4. Integration with Existing JoEbook Features

### 4.1 Batch Translation Queue

Modify `handleBatchTranslate` to:

1. Check `multiAgentEnabled` setting.
2. If true, create a `TranslationOrchestrator` per file.
3. Use `p-queue` (concurrency 2) for file-level parallelism.
4. File A can execute while File B is still planning (pipeline parallelism).

### 4.2 Babel Mode (Dual-Column Review)

- Multi-agent mode and Babel Mode are **independent**.
- Multi-agent produces translated blocks + quality reports in IndexedDB.
- When the user opens Babel Mode later, the reviewer's issue markers are displayed as warning badges in the dual-column view.
- User edits in Babel Mode are stored as `UserEditRecord` and are **never** overwritten by the multi-agent pipeline.
- The pipeline only runs when explicitly triggered; it does not auto-rerun on Babel Mode edits.

### 4.3 DOM Mapping & Rendering

- Each `TranslatedBlock` carries `domPath` for precise DOM anchoring.
- The JoEbook renderer consumes translated blocks the same way it consumes single-model output — no renderer changes needed.
- `Auto-shrink` works as a safety net: if a `Concise` block's translation still overflows, the renderer shrinks the font.

### 4.4 IndexedDB Schema Additions

New keys stored by the pipeline:

| Key Pattern | Content | Phase |
|---|---|---|
| `joebook-task-{docId}` | `TaskState` | All phases |
| `joebook-plan-{docId}` | `TranslationPlan` | Planning |
| `joebook-report-{docId}` | `ProofreadingReport` | Reviewing |
| `joebook-task-index` | `string[]` (doc IDs) | Registration |

### 4.5 Translation Service Integration

In `translationService.ts`, add a branch:

```typescript
async function translateDocument(doc: DocumentAST): Promise<TranslatedBlock[]> {
  if (appSettings.multiAgentEnabled) {
    const orchestrator = new TranslationOrchestrator();
    const result = await orchestrator.run(doc, resolveRoleModels());
    if (!result.success) throw new Error(result.error);
    return result.taskState.translatedBlocks;
  }
  // Legacy single-model path
  return legacyTranslate(doc);
}
```

## 5. Crash Recovery

On application startup:

1. Call `findIncompleteTasks()` to check IndexedDB for tasks with phase != 'completed' and != 'failed'.
2. If found, show a dialog: "Found an incomplete translation task. Resume or restart?"
3. If user chooses "Resume", call `orchestrator.run()` with the same documentId — the orchestrator detects existing progress and skips completed phases.
4. If user chooses "Restart", clear task state and start fresh.

## 6. Logging & Debugging

- Each agent logs: `[role] Invoking LLM (prompt first 200 chars): ...`
- Each agent logs: `[role] LLM response received (elapsed ms, char count)`
- The orchestrator logs: `[Orchestrator] Starting pipeline for document: ...`
- The orchestrator logs: `[Orchestrator] Planning complete. Glossary entries: N`
- The orchestrator logs: `[Orchestrator] Retrying N high-severity blocks...`
- All logs go to `console` (electron-log integration pending).

For UI debugging, the last 50 log entries can be surfaced in a Debug Panel component.

## 7. Custom Prompt Templates

Prompt templates are stored as external text files:

| File | Agent Role | Customizable? |
|---|---|---|
| `prompts/planner.prompt.txt` | Planner | Yes |
| `prompts/executor.prompt.txt` | Executor | Yes |
| `prompts/proofreader.prompt.txt` | Reviewer | Yes |

To customize: edit the file, restart the application. The agent constructors accept `systemPrompt` as an optional override parameter.

## 8. Configuration Reference

### agents.config.json

```json
{
  "executorPool": { "maxConcurrency": 2, "batchSize": 20 },
  "proofreading": {
    "autoRetryOnHighSeverity": true,
    "maxRetries": 2,
    "semanticSimilarityThreshold": 0.75
  },
  "timeouts": { "planner": 60000, "executor": 60000, "reviewer": 60000 },
  "defaults": {
    "planner": { "adapter": "ollama", "baseUrl": "...", "model": "..." },
    "executor": { "adapter": "...", "baseUrl": "...", "model": "..." },
    "proofreader": { "adapter": "...", "baseUrl": "...", "model": "..." }
  }
}
```

All defaults are overridden at runtime by the frontend's ModelProfile selections.
