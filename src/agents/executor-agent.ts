/**
 * JoEbook Executor Agent — Translates a single text block with constraint awareness.
 *
 * Stage 2 of the pipeline. Handles tag preservation, glossary enforcement,
 * constraint-based compression, and confidence scoring.
 */

import { BaseAgent } from './base-agent';
import type {
  AgentModelConfig,
  DocumentBlock,
  TranslatedBlock,
  TranslationPlan,
  GlossaryEntry,
  BlockConstraint,
} from './types';

const DEFAULT_SYSTEM_PROMPT = `You are an expert constraint-aware translator. Translate the given text block following the glossary, style guide, and constraint rules exactly. Return ONLY valid JSON with: {translatedText, preservedTags, confidence}.`;

// Regex patterns for extracting preserved tags
const HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s+[^>]*)?\/?>/g;
const JO_ID_RE = /<span\s+data-jo-id="[^"]*"[^>]*>.*?<\/span>/g;
const MARKDOWN_FORMAT_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[([^\]]+)\]\([^)]+\))/g;
const MATH_MARKER_RE = /\{\$[^$]+\$?\}|\{\{[^}]+\}\}/g;

export class ExecutorAgent extends BaseAgent {
  constructor(modelConfig: AgentModelConfig, systemPrompt?: string) {
    super('executor', modelConfig, systemPrompt || DEFAULT_SYSTEM_PROMPT);
  }

  /**
   * Translate a single block with full context and plan.
   */
  async execute(
    block: DocumentBlock,
    plan: TranslationPlan,
    previousBlocks: Array<{ original: string; translated: string }> = [],
    sourceLang?: string,
    targetLang?: string,
  ): Promise<TranslatedBlock> {
    // Extract tags from original text
    const preservedTags = this.extractPreservedTags(block.text);

    // Build constraint instruction
    const constraintInstruction = this.buildConstraintInstruction(block.constraint || 'ExpandAllowed');

    // Build glossary injection
    const relevantGlossary = this.filterRelevantGlossary(block.text, plan.glossary);
    const glossaryStr = relevantGlossary.length > 0
      ? `MANDATORY terminology mapping:\n${JSON.stringify(Object.fromEntries(relevantGlossary.map(g => [g.source, g.target])), null, 2)}\nYou MUST use these exact translations.`
      : 'No glossary terms found in this block.';

    // Build context window
    const contextStr = previousBlocks.length > 0
      ? `Previous blocks for context:\n${previousBlocks.map((pb, i) => `[${i + 1}] Original: ${pb.original.substring(0, 150)}\n    Translated: ${pb.translated.substring(0, 150)}`).join('\n\n')}`
      : 'This is the first block. No prior context available.';

    const userPrompt = `Source language: ${sourceLang || 'auto'}
Target language: ${targetLang || 'Chinese (Simplified)'}
Block ID: ${block.blockId}
Block type: ${block.nodeType}
Constraint: ${block.constraint || 'ExpandAllowed'}

${constraintInstruction}

Style guide: ${plan.styleGuide}

${glossaryStr}

${contextStr}

Original text to translate:
${block.text}

Return JSON: {translatedText, preservedTags, confidence}`;

    const raw = await this.invoke(userPrompt, {
      temperature: block.constraint === 'Concise' ? 0.15 : 0.3,
      maxTokens: block.constraint === 'Concise' ? Math.ceil(block.text.length * 1.5) : 4096,
    });

    try {
      const parsed = this.parseJsonOutput<{
        translatedText?: string;
        preservedTags?: string[];
        confidence?: number;
      }>(raw);

      const translatedText = parsed.translatedText || block.text;
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : this.estimateConfidence(block.text, translatedText, block.constraint);

      return {
        blockId: block.blockId,
        originalText: block.text,
        translatedText,
        preservedTags: Array.isArray(parsed.preservedTags) ? parsed.preservedTags : preservedTags,
        confidence,
        domPath: block.domPath,
        constraint: block.constraint || 'ExpandAllowed',
      };
    } catch {
      // Fallback: treat raw output as direct translation
      return {
        blockId: block.blockId,
        originalText: block.text,
        translatedText: raw || block.text,
        preservedTags,
        confidence: 0.3,
        domPath: block.domPath,
        constraint: block.constraint || 'ExpandAllowed',
      };
    }
  }

  /**
   * Extract structural tags from the original text.
   */
  extractPreservedTags(text: string): string[] {
    const tags: Set<string> = new Set();

    const htmlMatches = text.match(HTML_TAG_RE) || [];
    for (const t of htmlMatches) tags.add(t);

    const joMatches = text.match(JO_ID_RE) || [];
    for (const t of joMatches) tags.add(t);

    const mdMatches = text.match(MARKDOWN_FORMAT_RE) || [];
    for (const t of mdMatches) tags.add(t);

    const mathMatches = text.match(MATH_MARKER_RE) || [];
    for (const t of mathMatches) tags.add(t);

    return Array.from(tags);
  }

  /**
   * Filter glossary entries that actually appear in the text.
   */
  private filterRelevantGlossary(text: string, glossary: GlossaryEntry[]): GlossaryEntry[] {
    return glossary.filter(g => {
      const sourceLower = g.source.toLowerCase();
      const textLower = text.toLowerCase();
      return textLower.includes(sourceLower);
    });
  }

  /**
   * Build constraint-specific translation instructions.
   */
  private buildConstraintInstruction(constraint: BlockConstraint): string {
    switch (constraint) {
      case 'Concise':
        return `CONSTRAINT: CONCISE — Translation MUST NOT exceed 1.2x original length (original: characters). Use abbreviations, compress sentence structure, omit redundant words. Count characters before finalizing.`;
      case 'PreserveLayout':
        return `CONSTRAINT: PRESERVE_LAYOUT — Translation MUST preserve exact line breaks, indentation, and whitespace. Each translated line corresponds to the same original line. Do NOT merge or split lines.`;
      case 'ExpandAllowed':
      default:
        return `CONSTRAINT: EXPAND_ALLOWED — Natural, fluent translation is prioritized. May expand up to 1.5x original length.`;
    }
  }

  /**
   * Estimate confidence based on length ratio and constraint compliance.
   */
  private estimateConfidence(original: string, translated: string, constraint?: BlockConstraint): number {
    const origLen = original.length;
    const transLen = translated.length;
    if (origLen === 0) return 0.5;

    const ratio = transLen / origLen;
    switch (constraint) {
      case 'Concise':
        return ratio <= 1.2 ? 0.85 : Math.max(0.3, 0.85 - (ratio - 1.2) * 0.5);
      case 'PreserveLayout': {
        const origLines = original.split('\n').length;
        const transLines = translated.split('\n').length;
        return origLines === transLines ? 0.85 : 0.5;
      }
      default:
        return ratio >= 0.5 && ratio <= 2.0 ? 0.8 : 0.4;
    }
  }
}
