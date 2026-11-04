/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./extensionIframeSelector', () => ({
  pickExtensionIframe: vi.fn(),
}));
vi.mock('./workerHost.svelte', () => ({
  workerHost: { hasWorker: vi.fn(() => false), getWorker: vi.fn(), post: vi.fn() },
}));
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn().mockReturnValue('*'),
}));

import {
  invokeExtensionAiProviderStream,
  invokeExtensionAiProviderListModels,
  handleAiProviderResponse,
} from './extensionAiProviderDispatch';
import { pickExtensionIframe } from './extensionIframeSelector';
import { workerHost } from './workerHost.svelte';
import type { AiStreamChunk } from 'asyar-sdk/contracts';

function mountedWorker(): Window {
  const worker = { postMessage: vi.fn() } as unknown as Window;
  vi.mocked(pickExtensionIframe).mockReturnValue({ contentWindow: worker } as HTMLIFrameElement);
  return worker;
}

function postedMessage(
  worker: Window,
  callIndex = 0,
): {
  type: string;
  messageId: string;
  providerId: string;
  payload?: unknown;
  config?: unknown;
} {
  return vi.mocked(worker.postMessage).mock.calls[callIndex][0] as {
    type: string;
    messageId: string;
    providerId: string;
    payload?: unknown;
    config?: unknown;
  };
}

describe('extensionAiProviderDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('invokeExtensionAiProviderStream', () => {
    it('dispatches stream request, receives chunks, and resolves on complete', async () => {
      const worker = mountedWorker();
      const chunks: AiStreamChunk[] = [];
      const onChunk = vi.fn((chunk: AiStreamChunk) => {
        chunks.push(chunk);
      });

      const promise = invokeExtensionAiProviderStream(
        'org.example.groq',
        'groq',
        {
          modelId: 'llama-3.3-70b',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1024,
        },
        onChunk,
      );

      const msg = postedMessage(worker);
      expect(msg.type).toBe('asyar:aiProvider:streamRequest');
      expect(msg.providerId).toBe('groq');
      expect(msg.payload).toEqual({
        modelId: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1024,
      });

      // Send chunk 1
      handleAiProviderResponse(
        new MessageEvent('message', {
          source: worker,
          data: {
            type: 'asyar:aiProvider:chunk',
            messageId: msg.messageId,
            chunk: { delta: 'Hello' },
          },
        }),
      );

      // Send chunk 2
      handleAiProviderResponse(
        new MessageEvent('message', {
          source: worker,
          data: {
            type: 'asyar:aiProvider:chunk',
            messageId: msg.messageId,
            chunk: { delta: ' world!' },
          },
        }),
      );

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(chunks).toEqual([{ delta: 'Hello' }, { delta: ' world!' }]);

      // Complete
      handleAiProviderResponse(
        new MessageEvent('message', {
          source: worker,
          data: {
            type: 'asyar:aiProvider:complete',
            messageId: msg.messageId,
          },
        }),
      );

      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects on provider error', async () => {
      const worker = mountedWorker();
      const onChunk = vi.fn();

      const promise = invokeExtensionAiProviderStream(
        'org.example.groq',
        'groq',
        {
          modelId: 'llama-3.3-70b',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1024,
        },
        onChunk,
      );

      const msg = postedMessage(worker);

      handleAiProviderResponse(
        new MessageEvent('message', {
          source: worker,
          data: {
            type: 'asyar:aiProvider:error',
            messageId: msg.messageId,
            error: 'Authentication failed: invalid API key',
          },
        }),
      );

      await expect(promise).rejects.toThrow('Authentication failed: invalid API key');
    });

    it('aborts cleanly and sends abort message when signal is triggered', async () => {
      const worker = mountedWorker();
      const onChunk = vi.fn();
      const controller = new AbortController();

      const promise = invokeExtensionAiProviderStream(
        'org.example.groq',
        'groq',
        {
          modelId: 'llama-3.3-70b',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1024,
        },
        onChunk,
        controller.signal,
      );

      const msg = postedMessage(worker);
      expect(msg.type).toBe('asyar:aiProvider:streamRequest');

      controller.abort();

      await expect(promise).rejects.toThrow(/cancelled/i);

      // Verify abort notification was sent to worker
      const abortMsg = postedMessage(worker, 1);
      expect(abortMsg.type).toBe('asyar:aiProvider:abort');
      expect(abortMsg.messageId).toBe(msg.messageId);
    });

    it('rejects if worker is not mounted', async () => {
      vi.mocked(pickExtensionIframe).mockReturnValue(null);
      vi.mocked(workerHost.getWorker).mockReturnValue(undefined);

      await expect(
        invokeExtensionAiProviderStream(
          'org.missing',
          'provider',
          { modelId: 'm', messages: [], maxTokens: 1024 },
          vi.fn(),
        ),
      ).rejects.toThrow(/not mounted/i);
    });
  });

  describe('invokeExtensionAiProviderListModels', () => {
    it('dispatches listModels request and resolves model array', async () => {
      const worker = mountedWorker();

      const promise = invokeExtensionAiProviderListModels('org.example.groq', 'groq', {
        apiKey: 'gsk_test',
        baseUrl: 'https://api.groq.com/openai/v1',
      });

      const msg = postedMessage(worker);
      expect(msg.type).toBe('asyar:aiProvider:listModels');
      expect(msg.providerId).toBe('groq');
      expect(msg.config).toEqual({
        apiKey: 'gsk_test',
        baseUrl: 'https://api.groq.com/openai/v1',
      });

      handleAiProviderResponse(
        new MessageEvent('message', {
          source: worker,
          data: {
            type: 'asyar:aiProvider:listModelsResponse',
            messageId: msg.messageId,
            models: [
              { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', contextWindow: 128000 },
              { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1', contextWindow: 128000 },
            ],
          },
        }),
      );

      const models = await promise;
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('llama-3.3-70b-versatile');
      expect(models[1].label).toBe('DeepSeek R1');
    });

    it('rejects on listModels error', async () => {
      const worker = mountedWorker();

      const promise = invokeExtensionAiProviderListModels('org.example.groq', 'groq', {});
      const msg = postedMessage(worker);

      handleAiProviderResponse(
        new MessageEvent('message', {
          source: worker,
          data: {
            type: 'asyar:aiProvider:listModelsResponse',
            messageId: msg.messageId,
            error: 'Failed to fetch models: network offline',
          },
        }),
      );

      await expect(promise).rejects.toThrow('Failed to fetch models: network offline');
    });

    it('rejects if abort signal triggers before completion', async () => {
      mountedWorker();
      const controller = new AbortController();

      const promise = invokeExtensionAiProviderListModels(
        'org.example.groq',
        'groq',
        {},
        controller.signal,
      );

      controller.abort();
      await expect(promise).rejects.toThrow(/cancelled/i);
    });
  });
});
