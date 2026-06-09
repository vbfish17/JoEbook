/**
 * JoEbook Proofreader Agent — Quality checks and interactive polish.
 *
 * Stage 3 of the pipeline. Performs term consistency, tag integrity,
 * semantic drift checks, and generates polish patches.
 */

import { BaseAgent } from './base-agent';
import type {
  AgentModelConfig,
  TranslatedBlock,
  TranslationPlan,
  ProofreadingReport,
  ProofIssue,
  ProofPatch,
  IssueType,
  IssueSeverity,
  PatchAction,
  GlossaryEntry,
  UserEditRecord,
} from './types';

const DEFAULT_SYSTEM_PROMPT = `You are a translation quality assurance specialist. Check translations for terminology consistency, tag integrity, and semantic accuracy. Return ONLY valid JSON with the specified structure.`;

export class ProofreaderAgent extends BaseAgent {
  private semanticThreshold: number;

  constructor(
    modelConfig: AgentModelConfig,
    systemPrompt?: string,
    semanticThreshold = 0.75,
  ) {
    super('proofreader', modelConfig, systemPrompt || DEFAULT_SYSTEM_PROMPT);
    this.semanticThreshold = semanticThreshold;
  }

  /**
   * Run full quality check on all translated blocks.
   */
  async checkAll(
    translatedBlocks: TranslatedBlock[],
    plan: TranslationPlan,
    userEdits?: UserEditRecord[],
  ): Promise<ProofreadingReport> {
    const issues: ProofIssue[] = [];
    const patches: ProofPatch[] = [];

    // Phase 1: Programmatic checks (no LLM needed, fast and deterministic)
    for (const block of translatedBlocks) {
      // 1. Term consistency check
      const termIssues = this.checkTermConsistency(block, plan.glossary);
      issues.push(...termIssues);

      // 2. Tag integrity check
      const tagIssues = this.checkTagIntegrity(block);
      issues.push(...tagIssues);

      // 3. Semantic drift heuristic
      const driftIssues = this.checkSemanticDrift(block);
      issues.push(...driftIssues);

      // 4. Layout overflow check
      const overflowIssues = this.checkLayoutOverflow(block);
      issues.push(...overflowIssues);
    }

    // Phase 2: LLM-based deep quality check (batched for efficiency)
    if (issues.filter(i => i.severity === 'high').length > 0 || translatedBlocks.length <= 50) {
      try {
        const llmIssues = await this.llmDeepCheck(translatedBlocks.slice(0, 30), plan);
        issues.push(...llmIssues);
      } catch (err) {
        console.warn('[Proofreader] LLM deep check failed, relying on programmatic checks:', err);
      }
    }

    // Phase 3: Generate auto-patches for low/medium issues
    for (const issue of issues) {
      if (issue.severity === 'low' && issue.suggestion) {
        patches.push({
          blockId: issue.blockId,
          action: 'native_rewrite',
          patchedText: issue.suggestion,
          confidence: 0.7,
        });
      }
    }

    const highSeverityCount = issues.filter(i => i.severity === 'high').length;

    return {
      issues,
      patches,
      summary: `Found ${issues.length} issues (${highSeverityCount} high, ${issues.filter(i => i.severity === 'medium').length} medium, ${issues.filter(i => i.severity === 'low').length} low). ${patches.length} auto-patches generated.`,
      checkedAt: new Date().toISOString(),
      highSeverityCount,
    };
  }

  /**
   * Interactive polish: rewrite a single block in a specific style.
   */
  async polish(
    block: TranslatedBlock,
    action: PatchAction,
    plan: TranslationPlan,
    context?: string,
  ): Promise<string> {
    const actionDescriptions: Record<PatchAction, string> = {
      academic_polish: 'Rewrite in formal academic register with precise terminology, passive voice where appropriate, and field-standard conventions.',
      native_rewrite: 'Rewrite for natural target-language fluency. Remove translationese. Use idiomatic expressions. Make it sound originally written in the target language.',
      fit_to_bbox: 'Compress the translation to fit within tight space. Use abbreviations, omit optional modifiers. Target: output length <= original * 1.1. Preserve core meaning.',
    };

    const userPrompt = `Polish mode: ${action}
${actionDescriptions[action]}

Original text: ${block.originalText}
Current translation: ${block.translatedText}
Constraint: ${block.constraint}
Style guide: ${plan.styleGuide}

${context ? `Additional context: ${context}` : ''}

Glossary (MUST use these translations):
${JSON.stringify(plan.glossary.map(g => ({ [g.source]: g.target })), null, 2)}

Return ONLY the polished translation text, no JSON wrapping, no explanations.`;

    const result = await this.invoke(userPrompt, {
      temperature: action === 'academic_polish' ? 0.15 : 0.3,
      maxTokens: action === 'fit_to_bbox' ? Math.ceil(block.originalText.length * 1.2) : 4096,
    });

    return result || block.translatedText;
  }

  // ── Programmatic Check Methods ──────────────────────────

  /**
   * Check that all glossary terms in the original were translated correctly.
   */
  private checkTermConsistency(block: TranslatedBlock, glossary: GlossaryEntry[]): ProofIssue[] {
    const issues: ProofIssue[] = [];
    const originalLower = block.originalText.toLowerCase();

    for (const entry of glossary) {
      if (!entry.target) continue;
      if (!originalLower.includes(entry.source.toLowerCase())) continue;

      // Source term exists in original — check if target appears in translation
      const translationLower = block.translatedText.toLowerCase();
      if (!translationLower.includes(entry.target.toLowerCase())) {
        // Check for <term> markers
        if (block.translatedText.includes(`<term>${entry.source}</term>`)) {
          issues.push({
            blockId: block.blockId,
            type: 'term_mismatch',
            description: `Term "${entry.source}" was marked uncertain (wrapped in <term> tags) instead of using glossary translation "${entry.target}"`,
            suggestion: block.translatedText.replace(`<term>${entry.source}</term>`, entry.target),
            severity: 'medium',
          });
        } else {
          issues.push({
            blockId: block.blockId,
            type: 'term_mismatch',
            description: `Glossary term "${entry.source}" should be "${entry.target}" but was not found in translation`,
            suggestion: `Replace translation of "${entry.source}" with "${entry.target}"`,
            severity: 'high',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check that all preserved tags from the original appear in the translation.
   */
  private checkTagIntegrity(block: TranslatedBlock): ProofIssue[] {
    const issues: ProofIssue[] = [];

    for (const tag of block.preservedTags) {
      if (!block.translatedText.includes(tag)) {
        // Allow HTML tags to be reconstructed (e.g., <b>word</b> → <b>译词</b>)
        const tagName = tag.match(/^<(\w+)/)?.[1];
        if (tagName) {
          const openTagPattern = new RegExp(`<${tagName}[\\s>]`, 'i');
          if (!openTagPattern.test(block.translatedText)) {
            issues.push({
              blockId: block.blockId,
              type: 'tag_lost',
              description: `Tag "${tag}" from original was lost in translation`,
              suggestion: `Re-insert tag "${tag}" at the appropriate position`,
              severity: 'high',
            });
          }
        } else {
          issues.push({
            blockId: block.blockId,
            type: 'tag_lost',
            description: `Structural element "${tag.substring(0, 50)}" was lost`,
            suggestion: `Restore the missing element`,
            severity: 'medium',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Detect semantic drift using character-length ratio heuristic.
   * (Proxy for LaBSE embedding similarity when running fully local.)
   */
  private checkSemanticDrift(block: TranslatedBlock): ProofIssue[] {
    const issues: ProofIssue[] = [];
    const origLen = block.originalText.length;
    const transLen = block.translatedText.length;

    if (origLen === 0) return issues;

    const ratio = transLen / origLen;

    // Very short translation (< 30% of original) — likely missing content
    if (ratio < 0.3) {
      issues.push({
        blockId: block.blockId,
        type: 'semantic_drift',
        description: `Translation is suspiciously short (${transLen} vs ${origLen} chars, ratio ${ratio.toFixed(2)}). May have lost significant content.`,
        suggestion: 'Review and ensure all key information is preserved',
        severity: 'high',
      });
    }
    // Very long translation (> 250% of original) — may have hallucinated
    else if (ratio > 2.5) {
      issues.push({
        blockId: block.blockId,
        type: 'semantic_drift',
        description: `Translation is suspiciously long (${transLen} vs ${origLen} chars, ratio ${ratio.toFixed(2)}). May contain added content or hallucinations.`,
        suggestion: 'Review and trim any content not present in the original',
        severity: 'medium',
      });
    }
    // Moderate drift — low severity flag
    else if (ratio < 0.5 || ratio > 1.8) {
      issues.push({
        blockId: block.blockId,
        type: 'semantic_drift',
        description: `Translation length ratio ${ratio.toFixed(2)} is outside expected range (0.5-1.8). Verify content accuracy.`,
        suggestion: 'Check that translation preserves original meaning',
        severity: 'low',
      });
    }

    return issues;
  }

  /**
   * Check Concise-constraint blocks for length overflow.
   */
  private checkLayoutOverflow(block: TranslatedBlock): ProofIssue[] {
    const issues: ProofIssue[] = [];
    if (block.constraint !== 'Concise') return issues;

    const origLen = block.originalText.length;
    const transLen = block.translatedText.length;
    if (origLen === 0) return issues;

    const ratio = transLen / origLen;
    if (ratio > 1.2) {
      issues.push({
        blockId: block.blockId,
        type: 'layout_overflow',
        description: `Concise block translation exceeds 1.2x limit (${ratio.toFixed(2)}x, ${transLen} vs ${origLen} chars). May cause layout overflow.`,
        suggestion: 'Compress translation using abbreviations and shorter phrasing',
        severity: ratio > 1.5 ? 'high' : 'medium',
      });
    }

    return issues;
  }

  /**
   * LLM-based deeper quality check for a batch of blocks.
   */
  private async llmDeepCheck(
    blocks: TranslatedBlock[],
    plan: TranslationPlan,
  ): Promise<ProofIssue[]> {
    const blockSummaries = blocks.map(b => ({
      blockId: b.blockId,
      original: b.originalText.substring(0, 200),
      translation: b.translatedText.substring(0, 200),
      confidence: b.confidence,
      constraint: b.constraint,
    }));

    const glossaryStr = plan.glossary.length > 0
      ? `\nGlossary:\n${JSON.stringify(plan.glossary.slice(0, 50).map(g => ({ [g.source]: g.target })), null, 2)}`
      : '';

    const userPrompt = `Review these translation blocks for quality issues. Focus on:
1. Meaning accuracy: Does the translation preserve the original meaning?
2. Natural fluency: Is the translation natural in the target language?
3. Missing content: Any information from the original lost?
4. Added content: Any hallucinated content not in the original?

Blocks:
${JSON.stringify(blockSummaries, null, 2)}
${glossaryStr}

Return JSON array of issues:
[{"blockId":"...", "type":"semantic_drift", "description":"...", "suggestion":"...", "severity":"low|medium|high"}]

If no issues, return: []`;

    try {
      const raw = await this.invoke(userPrompt, {
        temperature: 0.1,
        maxTokens: 4096,
      });
      const parsed = this.parseJsonOutput<Array<{
        blockId: string;
        type: IssueType;
        description: string;
        suggestion: string;
        severity: IssueSeverity;
      }>>(raw);

      if (Array.isArray(parsed)) {
        return parsed.filter(i => i.blockId && i.type && i.description);
      }
      return [];
    } catch {
      return [];
    }
  }
}
