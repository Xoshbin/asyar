import { vi, describe, expect, it, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

let mockListener: (event: any) => void = () => {};
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_eventName, cb) => {
    mockListener = cb;
    return Promise.resolve(() => {});
  }),
}));

import { requestTimeoutMs, resolveChatParams, streamChat } from './aiEngine';
import type { ChatMessage, ChatParams } from './IProviderPlugin';
import { invoke } from '@tauri-apps/api/core';

describe('requestTimeoutMs', () => {
  it('keeps the normal chat timeout at 30 seconds', () => {
    expect(requestTimeoutMs({ enabled: true })).toBe(30_000);
  });

  it('allows hosted web search up to 120 seconds', () => {
    expect(requestTimeoutMs({ enabled: true, hostedWebSearch: true })).toBe(120_000);
  });
});

describe('resolveChatParams', () => {
  const params: ChatParams = {
    modelId: 'test-model',
    temperature: 0.5,
    maxTokens: 1024,
  };

  it('passes an agent system message to provider adapters', () => {
    const messages: ChatMessage[] = [
      { id: 'system', role: 'system', content: 'Be concise.', timestamp: 0 },
      { id: 'user', role: 'user', content: 'Hello', timestamp: 1 },
    ];

    expect(resolveChatParams(messages, params)).toEqual({
      ...params,
      systemPrompt: 'Be concise.',
    });
  });

  it('keeps an explicit system prompt authoritative', () => {
    const explicit = { ...params, systemPrompt: 'Explicit prompt' };
    const messages: ChatMessage[] = [
      { id: 'system', role: 'system', content: 'Message prompt', timestamp: 0 },
    ];

    expect(resolveChatParams(messages, explicit)).toBe(explicit);
  });
});

describe('streamChat via Rust', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates streaming to the Rust tauri command and listens to events', async () => {
    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const mockPlugin = {
      id: 'openai' as any,
      name: 'OpenAI',
      requiresApiKey: true,
      requiresBaseUrl: false,
      supportsTools: true as const,
      getModels: vi.fn(),
      buildRequest: vi.fn(),
      parseStream: vi.fn(),
      buildToolRequest: vi.fn(),
      parseToolStream: vi.fn(),
    };

    const streamPromise = streamChat(
      mockPlugin,
      { enabled: true, apiKey: 'test' },
      [{ id: '1', role: 'user', content: 'hello', timestamp: 0 }],
      { modelId: 'gpt-4o', temperature: 0.7, maxTokens: 100 },
      { onToken, onDone, onError },
      new AbortController().signal,
      'stream-123',
    );

    // Verify it invokes the tauri command
    expect(invoke).toHaveBeenCalledWith('ai_stream_chat', expect.any(Object));

    // Simulate events from Rust
    mockListener({
      payload: {
        streamId: 'stream-123',
        event: { type: 'token', token: 'hello ' },
      },
    });
    mockListener({
      payload: {
        streamId: 'stream-123',
        event: { type: 'token', token: 'world' },
      },
    });
    mockListener({
      payload: {
        streamId: 'stream-123',
        event: { type: 'done' },
      },
    });

    await streamPromise;

    expect(onToken).toHaveBeenCalledWith('hello ');
    expect(onToken).toHaveBeenCalledWith('world');
    expect(onDone).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
