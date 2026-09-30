/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import { AiServiceProxy } from './AiServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('AiServiceProxy', () => {
  let proxy: AiServiceProxy;
  let mockInvoke: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke = vi.fn().mockResolvedValue('Default response');
    Object.assign(messageBroker, {
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
    });
    proxy = new AiServiceProxy();
    proxy.setExtensionId('test.extension');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('complete', () => {
    it('invokes ai:complete with prompt and options and returns result', async () => {
      mockInvoke.mockResolvedValueOnce('Hello world!');

      const result = await proxy.complete('Translate to English', { temperature: 0.7 });

      expect(mockInvoke).toHaveBeenCalledWith(
        'ai:complete',
        {
          prompt: 'Translate to English',
          options: { temperature: 0.7 },
        },
        'test.extension',
        undefined,
      );
      expect(result).toBe('Hello world!');
    });

    it('returns empty string if invoke returns null/undefined', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      const result = await proxy.complete('Summarize this');

      expect(mockInvoke).toHaveBeenCalledWith(
        'ai:complete',
        {
          prompt: 'Summarize this',
          options: undefined,
        },
        'test.extension',
        undefined,
      );
      expect(result).toBe('');
    });

    it('throws immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('Pre-aborted'));

      await expect(proxy.complete('Prompt', { signal: controller.signal })).rejects.toThrow(
        'Pre-aborted',
      );

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('rejects when signal aborts during in-flight invoke', async () => {
      let resolveInvoke!: (val: string) => void;
      mockInvoke.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
      );

      const controller = new AbortController();
      const promise = proxy.complete('Prompt', { signal: controller.signal });

      controller.abort(new Error('User aborted'));

      await expect(promise).rejects.toThrow('User aborted');
      resolveInvoke('too late');
    });

    it('propagates errors from invoke', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Provider rate limit'));

      await expect(proxy.complete('Hello')).rejects.toThrow('Provider rate limit');
    });
  });

  describe('stream', () => {
    it('invokes ai:streamChat and delivers chunk events to onChunk', async () => {
      let capturedStreamId = '';
      mockInvoke.mockImplementationOnce(async (_cmd: string, payload: any) => {
        capturedStreamId = payload.streamId;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId: capturedStreamId,
              phase: 'chunk',
              data: { delta: 'Hel' },
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId: capturedStreamId,
              phase: 'chunk',
              data: { delta: 'lo!' },
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId: capturedStreamId,
              phase: 'done',
            },
          }),
        );
        return 'Hello!';
      });

      const chunks: string[] = [];
      const result = await proxy.stream('Say hello', (delta) => chunks.push(delta), {
        temperature: 0.5,
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'ai:streamChat',
        {
          prompt: 'Say hello',
          streamId: expect.any(String),
          options: { temperature: 0.5 },
        },
        'test.extension',
        undefined,
      );
      expect(chunks).toEqual(['Hel', 'lo!']);
      expect(result).toBe('Hello!');
    });

    it('handles string chunk payloads directly', async () => {
      mockInvoke.mockImplementationOnce(async (_cmd: string, payload: any) => {
        const streamId = payload.streamId;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId,
              phase: 'chunk',
              data: 'Chunk1',
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId,
              phase: 'done',
            },
          }),
        );
        return 'Chunk1';
      });

      const chunks: string[] = [];
      const result = await proxy.stream('Test', (delta) => chunks.push(delta));

      expect(chunks).toEqual(['Chunk1']);
      expect(result).toBe('Chunk1');
    });

    it('rejects on stream error phase', async () => {
      mockInvoke.mockImplementationOnce(async (_cmd: string, payload: any) => {
        const streamId = payload.streamId;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId,
              phase: 'error',
              data: { error: { message: 'Out of credits' } },
            },
          }),
        );
        return new Promise(() => {});
      });

      const chunks: string[] = [];
      await expect(proxy.stream('Test', (d) => chunks.push(d))).rejects.toThrow('Out of credits');
    });

    it('posts asyar:stream:abort to window.parent and rejects on signal abort', async () => {
      const postMessage = vi.spyOn(window.parent, 'postMessage');
      mockInvoke.mockReturnValueOnce(new Promise(() => {}));

      const controller = new AbortController();
      const promise = proxy.stream('Stream', vi.fn(), { signal: controller.signal });

      controller.abort(new Error('User cancelled'));

      await expect(promise).rejects.toThrow('User cancelled');
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'asyar:stream:abort',
          streamId: expect.any(String),
        },
        '*',
      );
    });

    it('throws immediately if signal is already aborted before stream starts', async () => {
      const controller = new AbortController();
      controller.abort(new Error('Pre-aborted'));

      await expect(proxy.stream('Stream', vi.fn(), { signal: controller.signal })).rejects.toThrow(
        'Pre-aborted',
      );

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('ignores messages for different stream IDs or message types', async () => {
      mockInvoke.mockImplementationOnce(async (_cmd: string, payload: any) => {
        const streamId = payload.streamId;
        // Other stream message
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId: 'other-stream',
              phase: 'chunk',
              data: 'wrong',
            },
          }),
        );
        // Correct stream message
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId,
              phase: 'chunk',
              data: 'correct',
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'asyar:stream',
              streamId,
              phase: 'done',
            },
          }),
        );
        return 'correct';
      });

      const chunks: string[] = [];
      const result = await proxy.stream('Test', (d) => chunks.push(d));

      expect(chunks).toEqual(['correct']);
      expect(result).toBe('correct');
    });
  });
});
