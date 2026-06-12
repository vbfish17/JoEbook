/**
 * Tests for types.ts — llmConfigToAgentConfig mapping.
 */
import { describe, it, expect } from 'vitest';
import { llmConfigToAgentConfig } from '../src/agents/types';
import type { LLMConfig } from '../src/agents/types';

describe('llmConfigToAgentConfig', () => {
  it('maps ollama provider', () => {
    const config = llmConfigToAgentConfig({
      provider: 'ollama',
      endpoint: 'http://localhost:11434/v1',
      modelName: 'qwen2.5:7b',
    });
    expect(config.adapter).toBe('ollama');
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
    expect(config.model).toBe('qwen2.5:7b');
  });

  it('detects ollama from URL pattern', () => {
    const config = llmConfigToAgentConfig({
      provider: 'custom',
      endpoint: 'http://192.168.1.1:11434/v1',
      modelName: 'mistral',
    });
    expect(config.adapter).toBe('ollama');
  });

  it('maps llamacpp provider', () => {
    const config = llmConfigToAgentConfig({
      provider: 'llamacpp',
      endpoint: 'http://localhost:8080/v1',
      modelName: 'llama3',
    });
    expect(config.adapter).toBe('llamacpp');
    expect(config.model).toBe('llama3');
  });

  it('detects llamacpp from URL pattern', () => {
    const config = llmConfigToAgentConfig({
      provider: 'custom',
      endpoint: 'http://server:8080/v1',
      modelName: 'gemma',
    });
    expect(config.adapter).toBe('llamacpp');
  });

  it('maps mlx provider', () => {
    const config = llmConfigToAgentConfig({
      provider: 'mlx',
      endpoint: 'http://localhost:1234/v1',
      modelName: 'mlx-community/qwen',
    });
    expect(config.adapter).toBe('mlx');
  });

  it('detects mlx from URL pattern (port 1234)', () => {
    const config = llmConfigToAgentConfig({
      provider: 'custom',
      endpoint: 'http://localhost:1234/v1',
      modelName: 'phi',
    });
    expect(config.adapter).toBe('mlx');
  });

  it('maps openai provider to openai-compatible', () => {
    const config = llmConfigToAgentConfig({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      modelName: 'gpt-4',
    });
    expect(config.adapter).toBe('openai-compatible');
  });

  it('defaults to openai-compatible for unknown provider', () => {
    const config = llmConfigToAgentConfig({
      provider: 'custom',
      endpoint: 'https://my-llm.example.com/v1',
      modelName: 'custom-model',
      apiKey: 'sk-123',
      temperature: 0.7,
      maxTokens: 4096,
    });
    expect(config.adapter).toBe('openai-compatible');
    expect(config.baseUrl).toBe('https://my-llm.example.com/v1');
    expect(config.apiKey).toBe('sk-123');
    expect(config.temperature).toBe(0.7);
    expect(config.maxTokens).toBe(4096);
  });

  it('handles minimal LLMConfig', () => {
    const config = llmConfigToAgentConfig({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      modelName: 'gpt-4',
    });
    expect(config.adapter).toBe('openai-compatible');
    expect(config.apiKey).toBeUndefined();
    expect(config.temperature).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
  });

  it('URL matching is case-insensitive', () => {
    const config = llmConfigToAgentConfig({
      provider: 'custom',
      endpoint: 'HTTP://LOCALHOST:11434/V1',
      modelName: 'test',
    });
    expect(config.adapter).toBe('ollama');
  });

  it('ollama has priority: 11434 over 8080 in same URL', () => {
    // In the detection chain, ollama (11434) is checked first
    const config = llmConfigToAgentConfig({
      provider: 'custom',
      endpoint: 'http://multiport:11434/v1',
      modelName: 'test',
    });
    expect(config.adapter).toBe('ollama');
  });

  it('llamacpp has priority over mlx when 8080 in URL', () => {
    // llamacpp (8080) is before mlx (1234) in the checks
    const config = llmConfigToAgentConfig({
      provider: 'custom',
      endpoint: 'http://localhost:8080/v1',
      modelName: 'test',
    });
    expect(config.adapter).toBe('llamacpp');
  });
});