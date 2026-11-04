/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function setRole(role: string | undefined) {
  if (role === undefined) {
    delete (window as any).__ASYAR_ROLE__;
  } else {
    (window as any).__ASYAR_ROLE__ = role;
  }
}

describe('worker proxy bag — ai provider service', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('ExtensionContext.ai exposes registerAiProvider method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof ctx.ai.registerAiProvider).toBe('function');
  });
});

describe('worker — asyar:aiProvider:* dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
    vi.restoreAllMocks();
  });

  it('dispatches asyar:aiProvider:streamRequest, yields chunks, and emits complete', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    const mockStream = vi.fn().mockImplementation(async (_req, onChunk) => {
      onChunk({ type: 'token', token: 'Thinking' });
      onChunk({ type: 'token', token: '...' });
    });

    ctx.ai.registerAiProvider({
      id: 'groq',
      completeStream: mockStream,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:aiProvider:streamRequest',
          messageId: 'stream-123',
          providerId: 'groq',
          payload: {
            messages: [{ role: 'user', content: 'hello' }],
            modelId: 'llama-3.3-70b',
            maxTokens: 100,
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(mockStream).toHaveBeenCalled();
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:aiProvider:chunk',
        messageId: 'stream-123',
        chunk: { type: 'token', token: 'Thinking' },
      },
      '*',
    );
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:aiProvider:chunk',
        messageId: 'stream-123',
        chunk: { type: 'token', token: '...' },
      },
      '*',
    );
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:aiProvider:complete',
        messageId: 'stream-123',
      },
      '*',
    );
  });

  it('dispatches asyar:aiProvider:listModels and replies with models', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    const mockList = vi
      .fn()
      .mockResolvedValue([
        { id: 'llama-3.3-70b', label: 'Llama 3.3 (70B)', contextWindow: 128000 },
      ]);

    ctx.ai.registerAiProvider({
      id: 'groq',
      completeStream: vi.fn(),
      listModels: mockList,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:aiProvider:listModels',
          messageId: 'list-456',
          providerId: 'groq',
          config: { apiKey: 'gsk_123' },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(mockList).toHaveBeenCalledWith({ apiKey: 'gsk_123' }, expect.any(AbortSignal));
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:aiProvider:listModelsResponse',
        messageId: 'list-456',
        models: [{ id: 'llama-3.3-70b', label: 'Llama 3.3 (70B)', contextWindow: 128000 }],
      },
      '*',
    );
  });

  it('aborts active stream when asyar:aiProvider:abort is received', async () => {
    const parentPostMessage = vi.fn();
    (window as any).parent = { postMessage: parentPostMessage };

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();

    let streamSignal: AbortSignal | undefined;
    const mockStream = vi.fn().mockImplementation(async (_req, _onChunk, signal) => {
      streamSignal = signal;
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    ctx.ai.registerAiProvider({
      id: 'groq',
      completeStream: mockStream,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:aiProvider:streamRequest',
          messageId: 'stream-abort-789',
          providerId: 'groq',
          payload: {
            messages: [{ role: 'user', content: 'hello' }],
            modelId: 'llama-3.3-70b',
            maxTokens: 100,
          },
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(streamSignal?.aborted).toBe(false);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:aiProvider:abort',
          messageId: 'stream-abort-789',
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(streamSignal?.aborted).toBe(true);
    expect(parentPostMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:aiProvider:error',
        messageId: 'stream-abort-789',
        error: 'aborted',
      },
      '*',
    );
  });
});
