import { describe, expect, it } from 'vitest';
import { requestTimeoutMs, resolveChatParams } from './aiEngine';
import type { ChatMessage, ChatParams } from './IProviderPlugin';

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
