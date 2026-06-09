/**
 * JoEbook Model Gateway — Abstract LLM Adapter Interface (v2.0)
 *
 * Provides a unified interface for calling local LLM backends
 * (Ollama, llama.cpp server, MLX, OpenAI-compatible).
 * Supports both AgentModelConfig (legacy) and LLMConfig (v2.0 spec).
 */

import type { AgentModelConfig, LLMConfig } from '../agents/types';
import { llmConfigToAgentConfig } from '../agents/types';

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  timeoutMs?: number;          // v2.0: per-call timeout
}

export interface LLMAdapter {
  readonly name: string;
  generate(prompt: string, options?: LLMGenerateOptions): Promise<string>;
  streamGenerate(prompt: string, onToken: (token: string) => void, options?: LLMGenerateOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
}

// ── Shared Utilities ─────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export function parseOpenAIStream(reader: ReadableStreamDefaultReader<Uint8Array>, onToken: (token: string) => void): Promise<string> {
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  return (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
          if (delta) {
            fullText += delta;
            onToken(delta);
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
    return fullText;
  })();
}

export async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  prompt: string,
  options?: LLMGenerateOptions,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey && apiKey !== 'not-required') {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: options && options.temperature !== undefined ? options.temperature : 0.3,
    max_tokens: options && options.maxTokens !== undefined ? options.maxTokens : 2048,
    stream: false,
    stop: options && options.stopSequences,
  };

  const timeout = (options && options.timeoutMs) || 60000;
  const response = await fetchWithTimeout(baseUrl + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeout);

  if (!response.ok) {
    const errText = await response.text().catch(function() { return ''; });
    throw new Error('LLM API error ' + response.status + ': ' + errText.substring(0, 500));
  }

  const data = await response.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

export async function streamOpenAICompatible(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  prompt: string,
  onToken: (token: string) => void,
  options?: LLMGenerateOptions,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey && apiKey !== 'not-required') {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: options && options.temperature !== undefined ? options.temperature : 0.3,
    max_tokens: options && options.maxTokens !== undefined ? options.maxTokens : 2048,
    stream: true,
    stop: options && options.stopSequences,
  };

  const timeout = (options && options.timeoutMs) || 60000;
  const response = await fetchWithTimeout(baseUrl + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeout);

  if (!response.ok) {
    const errText = await response.text().catch(function() { return ''; });
    throw new Error('LLM streaming error ' + response.status + ': ' + errText.substring(0, 500));
  }

  const reader = response.body && response.body.getReader();
  if (!reader) throw new Error('No readable stream from LLM response');

  return parseOpenAIStream(reader, onToken);
}

// ── Ollama Adapter ───────────────────────────────────────

export class OllamaAdapter implements LLMAdapter {
  readonly name = 'ollama';
  constructor(
    private baseUrl: string = 'http://localhost:11434/v1',
    private model: string = 'qwen2.5:7b',
    private apiKey?: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const base = this.baseUrl.replace(/\/v1$/, '');
      const response = await fetchWithTimeout(base + '/api/tags', {}, 5000);
      return response.ok;
    } catch { return false; }
  }

  async generate(prompt: string, options?: LLMGenerateOptions): Promise<string> {
    return callOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, options);
  }

  async streamGenerate(prompt: string, onToken: (token: string) => void, options?: LLMGenerateOptions): Promise<string> {
    return streamOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, onToken, options);
  }
}

// ── llama.cpp Server Adapter ─────────────────────────────

export class LlamaCppAdapter implements LLMAdapter {
  readonly name = 'llamacpp';
  constructor(
    private baseUrl: string = 'http://localhost:8080/v1',
    private model: string = 'default',
    private apiKey?: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(this.baseUrl + '/health', {}, 5000);
      return response.ok;
    } catch { return false; }
  }

  async generate(prompt: string, options?: LLMGenerateOptions): Promise<string> {
    return callOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, options);
  }

  async streamGenerate(prompt: string, onToken: (token: string) => void, options?: LLMGenerateOptions): Promise<string> {
    return streamOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, onToken, options);
  }
}

// ── MLX Adapter (Python Bridge) ──────────────────────────

export class MLXAdapter implements LLMAdapter {
  readonly name = 'mlx';
  constructor(
    private baseUrl: string = 'http://localhost:1234/v1',
    private model: string = 'mlx-community/default',
    private apiKey?: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(this.baseUrl + '/models', {}, 5000);
      return response.ok;
    } catch { return false; }
  }

  async generate(prompt: string, options?: LLMGenerateOptions): Promise<string> {
    return callOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, options);
  }

  async streamGenerate(prompt: string, onToken: (token: string) => void, options?: LLMGenerateOptions): Promise<string> {
    return streamOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, onToken, options);
  }
}

// ── Generic OpenAI-Compatible Adapter ────────────────────

export class OpenAICompatibleAdapter implements LLMAdapter {
  readonly name: string;
  constructor(
    name: string,
    private baseUrl: string,
    private model: string,
    private apiKey?: string,
  ) {
    this.name = name;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey && this.apiKey !== 'not-required') {
        headers['Authorization'] = 'Bearer ' + this.apiKey;
      }
      const response = await fetchWithTimeout(this.baseUrl + '/models', { headers }, 5000);
      return response.ok;
    } catch { return false; }
  }

  async generate(prompt: string, options?: LLMGenerateOptions): Promise<string> {
    return callOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, options);
  }

  async streamGenerate(prompt: string, onToken: (token: string) => void, options?: LLMGenerateOptions): Promise<string> {
    return streamOpenAICompatible(this.baseUrl, this.apiKey, this.model, prompt, onToken, options);
  }
}

// ── Adapter Factories ────────────────────────────────────

/**
 * Legacy factory: create adapter from AgentModelConfig.
 */
export function createAdapter(config: AgentModelConfig): LLMAdapter {
  switch (config.adapter) {
    case 'ollama':
      return new OllamaAdapter(config.baseUrl, config.model, config.apiKey);
    case 'llamacpp':
      return new LlamaCppAdapter(config.baseUrl, config.model, config.apiKey);
    case 'mlx':
      return new MLXAdapter(config.baseUrl, config.model, config.apiKey);
    case 'openai-compatible':
    default:
      return new OpenAICompatibleAdapter(config.adapter, config.baseUrl, config.model, config.apiKey);
  }
}

/**
 * v2.0 factory: create adapter from LLMConfig (user-facing config from UI).
 * Converts LLMConfig → AgentModelConfig internally.
 */
export function createAdapterFromLLMConfig(llmConfig: LLMConfig): LLMAdapter {
  const config = llmConfigToAgentConfig(llmConfig);
  return createAdapter(config);
}
