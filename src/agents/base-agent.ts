/**
 * JoEbook Base Agent — Abstract foundation for all pipeline agents (v2.0).
 *
 * Accepts either AgentModelConfig (legacy) or LLMConfig (v2.0 spec).
 * Provides shared prompt construction, error handling, timeout, and logging.
 */

import type { LLMAdapter, LLMGenerateOptions } from '../model-gateway/llm-adapter';
import type { AgentModelConfig, LLMConfig } from './types';
import { createAdapter, createAdapterFromLLMConfig } from '../model-gateway/llm-adapter';

export abstract class BaseAgent {
  protected adapter: LLMAdapter;
  protected systemPrompt: string;
  readonly role: string;

  constructor(role: string, modelConfig: AgentModelConfig | LLMConfig, systemPrompt: string) {
    this.role = role;
    // Support both config types
    if ('provider' in modelConfig) {
      // LLMConfig path (v2.0)
      this.adapter = createAdapterFromLLMConfig(modelConfig as LLMConfig);
    } else {
      // AgentModelConfig path (legacy)
      this.adapter = createAdapter(modelConfig as AgentModelConfig);
    }
    this.systemPrompt = systemPrompt;
  }

  protected async invoke(userPrompt: string, options?: LLMGenerateOptions): Promise<string> {
    const fullPrompt = this.systemPrompt + '\n\n---\n\n' + userPrompt;
    const startTime = Date.now();
    try {
      console.log('[' + this.role + '] Invoking LLM (prompt first 200 chars): ' + userPrompt.substring(0, 200));
      const result = await this.adapter.generate(fullPrompt, {
        temperature: options && options.temperature !== undefined ? options.temperature : 0.3,
        maxTokens: options && options.maxTokens !== undefined ? options.maxTokens : 4096,
        timeoutMs: options && options.timeoutMs,
      });
      const elapsed = Date.now() - startTime;
      console.log('[' + this.role + '] LLM response received (' + elapsed + 'ms, ' + result.length + ' chars)');
      return result.trim();
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.error('[' + this.role + '] LLM invocation failed after ' + elapsed + 'ms:', err && err.message ? err.message : err);
      throw new Error('Agent ' + this.role + ' failed: ' + (err && err.message ? err.message : String(err)));
    }
  }

  protected async invokeStream(
    userPrompt: string,
    onToken: (token: string) => void,
    options?: LLMGenerateOptions,
  ): Promise<string> {
    const fullPrompt = this.systemPrompt + '\n\n---\n\n' + userPrompt;
    const startTime = Date.now();
    try {
      console.log('[' + this.role + '] Invoking LLM stream (prompt first 200 chars): ' + userPrompt.substring(0, 200));
      return await this.adapter.streamGenerate(fullPrompt, onToken, {
        temperature: options && options.temperature !== undefined ? options.temperature : 0.3,
        maxTokens: options && options.maxTokens !== undefined ? options.maxTokens : 4096,
        timeoutMs: options && options.timeoutMs,
      });
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.error('[' + this.role + '] LLM streaming failed after ' + elapsed + 'ms:', err && err.message ? err.message : err);
      throw new Error('Agent ' + this.role + ' streaming failed: ' + (err && err.message ? err.message : String(err)));
    }
  }

  /**
   * Safely parse JSON from LLM output. Strips markdown code fences if present.
   */
  protected parseJsonOutput<T>(raw: string): T {
    let text = raw.trim();
    // Strip markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }
    try {
      return JSON.parse(text);
    } catch {
      // Try to find the first { and last }
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try { return JSON.parse(text.substring(start, end + 1)); } catch { /* fall through */ }
      }
      const arrStart = text.indexOf('[');
      const arrEnd = text.lastIndexOf(']');
      if (arrStart >= 0 && arrEnd > arrStart) {
        try { return JSON.parse(text.substring(arrStart, arrEnd + 1)); } catch { /* fall through */ }
      }
      throw new Error('Failed to parse JSON from ' + this.role + ' output: ' + text.substring(0, 200));
    }
  }
}
