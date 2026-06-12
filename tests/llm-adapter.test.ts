/**
 * Tests for llm-adapter.ts — pure utility functions.
 */
import { describe, it, expect } from 'vitest';

// Import only pure functions (no I/O)
import { parseOpenAIStream } from '../src/model-gateway/llm-adapter';

// ── parseOpenAIStream ─────────────────────────────────

describe('parseOpenAIStream', () => {
  function createMockReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index++]));
        } else {
          controller.close();
        }
      },
    });
    // @ts-ignore - ReadableStream is available in Node 18+
    return stream.getReader();
  }

  it('parses single chunk correctly', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const tokens: string[] = [];
    const result = await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(result).toBe('Hello');
    expect(tokens).toEqual(['Hello']);
  });

  it('parses multiple chunks', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const tokens: string[] = [];
    const result = await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(result).toBe('Hello');
    expect(tokens).toEqual(['He', 'llo']);
  });

  it('skips non-data lines', async () => {
    const reader = createMockReader([
      ':heartbeat\n\n',
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const tokens: string[] = [];
    const result = await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(result).toBe('OK');
  });

  it('handles empty stream', async () => {
    const reader = createMockReader(['data: [DONE]\n\n']);
    const tokens: string[] = [];
    const result = await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(result).toBe('');
    expect(tokens).toHaveLength(0);
  });

  it('skips malformed JSON gracefully', async () => {
    const reader = createMockReader([
      'data: {broken json\n\n',
      'data: {"choices":[{"delta":{"content":"valid"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const tokens: string[] = [];
    const result = await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(result).toBe('valid');
  });

  it('handles chunk with no choices array', async () => {
    const reader = createMockReader([
      'data: {"choices":[]}\n\ndata: [DONE]\n\n',
    ]);
    const tokens: string[] = [];
    await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(tokens).toHaveLength(0);
  });

  it('accumulates text across multiple data chunks in same buffer', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"content":"part1"}}]}\ndata: {"choices":[{"delta":{"content":"part2"}}]}\ndata: [DONE]\n',
    ]);
    const tokens: string[] = [];
    const result = await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(result).toBe('part1part2');
    expect(tokens).toEqual(['part1', 'part2']);
  });

  it('handles content with special characters and Unicode', async () => {
    const reader = createMockReader([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" 🌍"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const tokens: string[] = [];
    const result = await parseOpenAIStream(reader, (t) => tokens.push(t));
    expect(result).toBe('你好 🌍');
  });
});