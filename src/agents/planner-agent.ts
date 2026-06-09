/**
 * JoEbook Planner Agent — Scans document AST and produces TranslationPlan.
 *
 * Stage 1 of the Planner → Executor → Proofreader pipeline.
 * Extracts terminology, generates style guide, classifies block constraints.
 */

import { BaseAgent } from './base-agent';
import type {
  AgentModelConfig,
  DocumentAST,
  DocumentBlock,
  TranslationPlan,
  GlossaryEntry,
  BlockConstraint,
  BlockId,
} from './types';

const DEFAULT_SYSTEM_PROMPT = `You are a translation planning specialist. Analyze the provided document blocks and produce a structured translation plan as JSON.

You must output:
1. "glossary": Array of {source, target, category} objects for domain terms requiring consistent translation.
2. "styleGuide": A paragraph of translation style instructions.
3. "blockConstraints": Object mapping blockId to one of "Concise"|"PreserveLayout"|"ExpandAllowed".
4. "estimatedExpansionRatio": Number (expected character length ratio, e.g. 1.3 for 30% expansion).

Constraint classification rules:
- Concise: labels, buttons, captions, textboxes, table headers, or any block with bbox.width < 200
- PreserveLayout: code, tables, lists
- ExpandAllowed: paragraphs, headings, body text

Return ONLY valid JSON.`;

export class PlannerAgent extends BaseAgent {
  constructor(modelConfig: AgentModelConfig, systemPrompt?: string) {
    super('planner', modelConfig, systemPrompt || DEFAULT_SYSTEM_PROMPT);
  }

  /**
   * Produce a TranslationPlan from a document AST.
   * Optionally merges with an existing termbase glossary.
   */
  async plan(
    docAST: DocumentAST,
    existingGlossary?: GlossaryEntry[],
  ): Promise<TranslationPlan> {
    // Build block summary for the prompt (truncate large documents)
    const blockSummaries = docAST.blocks.map(b => ({
      blockId: b.blockId,
      text: b.text.substring(0, 200),
      nodeType: b.nodeType,
      bboxWidth: b.bbox?.width,
      bboxHeight: b.bbox?.height,
    }));

    const existingTermsStr = existingGlossary && existingGlossary.length > 0
      ? `\n\nExisting glossary terms to incorporate (preserve their target translations):\n${JSON.stringify(existingGlossary.slice(0, 100), null, 2)}`
      : '';

    const userPrompt = `Document: "${docAST.fileName}" (${docAST.fileType})
Source language: ${docAST.sourceLang}
Target language: ${docAST.targetLang}
Domain: ${docAST.domain}
Total blocks: ${docAST.blocks.length}

Block summaries:
${JSON.stringify(blockSummaries, null, 2)}

Full text samples (first 20 blocks):
${docAST.blocks.slice(0, 20).map(b => `[${b.blockId}] (${b.nodeType}): ${b.text.substring(0, 300)}`).join('\n\n')}
${existingTermsStr}

Produce the complete translation plan as JSON.`;

    const raw = await this.invoke(userPrompt, {
      temperature: 0.2,
      maxTokens: 8192,
    });

    const parsed = this.parseJsonOutput<{
      glossary: Array<{ source: string; target: string; category: string }>;
      styleGuide: string;
      blockConstraints: Record<BlockId, BlockConstraint>;
      estimatedExpansionRatio: number;
    }>(raw);

    // Merge with existing glossary: existing entries take priority for same source
    const mergedGlossary = this.mergeGlossary(parsed.glossary || [], existingGlossary || []);

    // Apply deterministic constraint overrides for blocks the LLM might miss
    const blockConstraints = this.enforceConstraintRules(docAST, parsed.blockConstraints || {});

    return {
      glossary: mergedGlossary,
      styleGuide: parsed.styleGuide || this.defaultStyleGuide(docAST.domain),
      blockConstraints,
      estimatedExpansionRatio: parsed.estimatedExpansionRatio || 1.3,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Merge LLM-extracted glossary with existing termbase entries.
   * Existing confirmed entries take priority.
   */
  private mergeGlossary(
    extracted: GlossaryEntry[],
    existing: GlossaryEntry[],
  ): GlossaryEntry[] {
    const map = new Map<string, GlossaryEntry>();

    // Add extracted terms first
    for (const entry of extracted) {
      if (entry.source && entry.target) {
        map.set(entry.source.toLowerCase(), { ...entry, confirmed: false });
      }
    }

    // Override with existing confirmed terms
    for (const entry of existing) {
      const key = entry.source.toLowerCase();
      if (entry.target) {
        map.set(key, { ...entry, confirmed: true });
      }
    }

    return Array.from(map.values());
  }

  /**
   * Enforce deterministic constraint rules the LLM might miss.
   */
  private enforceConstraintRules(
    docAST: DocumentAST,
    llmConstraints: Record<BlockId, BlockConstraint>,
  ): Record<BlockId, BlockConstraint> {
    const result: Record<BlockId, BlockConstraint> = {};

    for (const block of docAST.blocks) {
      // Deterministic rules override LLM
      if (block.nodeType === 'code' || block.nodeType === 'table' || block.nodeType === 'list') {
        result[block.blockId] = 'PreserveLayout';
      } else if (
        block.nodeType === 'label' ||
        block.nodeType === 'button' ||
        block.nodeType === 'caption' ||
        block.nodeType === 'textbox' ||
        (block.bbox && block.bbox.width < 200)
      ) {
        result[block.blockId] = 'Concise';
      } else {
        // Use LLM suggestion if valid, otherwise default to ExpandAllowed
        const suggested = llmConstraints[block.blockId];
        if (suggested === 'Concise' || suggested === 'PreserveLayout' || suggested === 'ExpandAllowed') {
          result[block.blockId] = suggested;
        } else {
          result[block.blockId] = 'ExpandAllowed';
        }
      }
    }

    return result;
  }

  private defaultStyleGuide(domain: string): string {
    switch (domain) {
      case 'academic':
        return 'Use formal, objective academic tone. Prefer passive voice for methodology descriptions. Preserve all technical terminology exactly. Use SI units. Maintain precise, unambiguous language throughout.';
      case 'business':
        return 'Use professional business tone. Be direct and action-oriented. Use standard business terminology. Maintain a formal but accessible register. Preserve brand names and product terms in original form.';
      default:
        return 'Use natural, clear translation tone. Prioritize readability and accuracy. Preserve the original register and style. Adapt idioms to target language equivalents where appropriate.';
    }
  }
}
