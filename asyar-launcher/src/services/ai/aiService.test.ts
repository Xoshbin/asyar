import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStreamHandle, getCapturedStreamOptions, setCapturedStreamOptions, mockDispose } =
  vi.hoisted(() => {
    let captured: any = null;
    return {
      mockStreamHandle: {
        sendChunk: vi.fn(),
        sendDone: vi.fn(),
        sendError: vi.fn(),
        onAbort: vi.fn(),
        aborted: false,
      },
      getCapturedStreamOptions: () => captured,
      setCapturedStreamOptions: (val: any) => {
        captured = val;
      },
      mockDispose: vi.fn(),
    };
  });

vi.mock('../../lib/ipc/commands', () => ({
  agentsCancelRun: vi.fn().mockResolvedValue(undefined),
  agentsGet: vi.fn().mockResolvedValue({
    id: 'agent-123',
    providerId: 'mock-provider',
    modelId: 'mock-default-model',
  }),
  agentsRunSilent: vi.fn().mockResolvedValue('Completed answer'),
  aiGetCredentialStatus: vi.fn().mockResolvedValue({
    providers: { 'mock-provider': 'configured', ollama: 'not_configured' },
    webSearch: {},
    webReader: {},
  }),
  aiListModels: vi.fn().mockResolvedValue([
    { id: 'mock-default-model', label: 'Mock Default' },
    { id: 'mock-fast', label: 'Mock Fast' },
  ]),
  toAgentProviderDescriptors: vi.fn().mockReturnValue([{ id: 'mock-provider', name: 'Mock' }]),
}));

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn().mockReturnValue({
      ai: {
        defaultAgentId: 'agent-123',
        maxTokens: 2048,
        providers: {
          'mock-provider': { enabled: true, apiKey: 'key' },
        },
      },
    }),
  },
}));

vi.mock('./providerRegistry', () => ({
  providerRegistry: {
    list: vi.fn().mockReturnValue([
      { id: 'mock-provider', name: 'Mock Provider', requiresApiKey: true },
      { id: 'ollama', name: 'Ollama', requiresApiKey: false },
    ]),
  },
}));

vi.mock('../extension/streamDispatcher.svelte', () => ({
  streamDispatcher: {
    create: vi.fn().mockReturnValue(mockStreamHandle),
  },
}));

vi.mock('../../built-in-features/agents/agentStreamBridge', () => ({
  createAgentStreamChannel: vi.fn().mockImplementation((options) => {
    setCapturedStreamOptions(options);
    return {
      channel: { onmessage: vi.fn() },
      dispose: mockDispose,
    };
  }),
}));

import { AiService } from './aiService';
import {
  agentsCancelRun,
  agentsGet,
  agentsRunSilent,
  aiGetCredentialStatus,
  aiListModels,
} from '../../lib/ipc/commands';
import { settingsService } from '../settings/settingsService.svelte';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';

describe('AiService', () => {
  let aiService: AiService;

  beforeEach(() => {
    vi.clearAllMocks();
    setCapturedStreamOptions(null);
    aiService = new AiService();
  });

  describe('complete', () => {
    it('runs agentsRunSilent with defaultAgentId and returns completed text', async () => {
      const result = await aiService.complete('ext-1', 'What is 2+2?', { temperature: 0.2 });

      expect(agentsRunSilent).toHaveBeenCalledWith(
        'agent-123',
        'What is 2+2?',
        expect.objectContaining({
          defaultAgentId: 'agent-123',
          temperature: 0.2,
          maxTokens: 2048,
        }),
        expect.stringContaining('ai-complete-'),
        expect.anything(),
      );
      expect(result).toBe('Completed answer');
      expect(mockDispose).toHaveBeenCalled();
    });

    it('prepends systemPrompt if provided in options', async () => {
      await aiService.complete('ext-1', 'Hello', { systemPrompt: 'Be concise' });

      expect(agentsRunSilent).toHaveBeenCalledWith(
        'agent-123',
        'System instructions: Be concise\n\nHello',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('works without extensionId parameter (host direct call)', async () => {
      await aiService.complete('Direct prompt', { maxTokens: 500 });

      expect(agentsRunSilent).toHaveBeenCalledWith(
        'agent-123',
        'Direct prompt',
        expect.objectContaining({ maxTokens: 500 }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('forwards validated model override in AgentRunConfig', async () => {
      await aiService.complete('ext-1', 'Summarize', {
        model: { providerId: ' ollama ', modelId: ' llama3.2:latest ' },
      });

      expect(agentsRunSilent).toHaveBeenCalledWith(
        'agent-123',
        'Summarize',
        expect.objectContaining({
          providerOverrideId: 'ollama',
          modelOverrideId: 'llama3.2:latest',
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('omits override fields when model is omitted or null', async () => {
      await aiService.complete('ext-1', 'Ping', { model: null as any });

      const config = vi.mocked(agentsRunSilent).mock.calls[0][2];
      expect('providerOverrideId' in config).toBe(false);
      expect('modelOverrideId' in config).toBe(false);
    });

    it('rejects malformed or non-object model overrides before invoking agentsRunSilent', async () => {
      for (const bad of [
        { providerId: '  ', modelId: 'gpt-4o' },
        { providerId: '', modelId: 'gpt-4o' },
        'openai:gpt-4o',
        ['openai', 'gpt-4o'],
        123,
      ]) {
        await expect(
          aiService.complete('ext-1', 'Summarize', { model: bad as any }),
        ).rejects.toThrow(/non-empty providerId and modelId/i);
      }
      expect(agentsRunSilent).not.toHaveBeenCalled();
    });
  });

  describe('streamChat', () => {
    it('creates stream dispatcher handle and sends chunks to streamHandle', async () => {
      vi.mocked(agentsRunSilent).mockImplementationOnce(async () => {
        const streamOptions = getCapturedStreamOptions();
        streamOptions.onEvent({
          type: 'text_delta',
          delta: 'Part 1',
          accumulated: 'Part 1',
        });
        streamOptions.onEvent({
          type: 'text_delta',
          delta: ' Part 2',
          accumulated: 'Part 1 Part 2',
        });
        return 'Part 1 Part 2';
      });

      const result = await aiService.streamChat(
        'ext-1',
        'Stream prompt',
        'stream-abc',
        { temperature: 0.8 },
        'worker',
      );

      expect(streamDispatcher.create).toHaveBeenCalledWith('ext-1', 'stream-abc', 'worker');
      expect(mockStreamHandle.sendChunk).toHaveBeenCalledWith({
        delta: 'Part 1',
        accumulated: 'Part 1',
      });
      expect(mockStreamHandle.sendChunk).toHaveBeenCalledWith({
        delta: ' Part 2',
        accumulated: 'Part 1 Part 2',
      });
      expect(mockStreamHandle.sendDone).toHaveBeenCalled();
      expect(result).toBe('Part 1 Part 2');
      expect(mockDispose).toHaveBeenCalled();
    });

    it('registers abort listener that calls agentsCancelRun', async () => {
      let abortCb: (() => void) | undefined;
      mockStreamHandle.onAbort.mockImplementation((cb) => {
        abortCb = cb;
      });

      await aiService.streamChat('ext-1', 'Prompt', 'stream-abort-test');

      expect(mockStreamHandle.onAbort).toHaveBeenCalled();
      abortCb?.();
      expect(agentsCancelRun).toHaveBeenCalledWith('stream-abort-test');
    });

    it('forwards error and rethrows on failure', async () => {
      vi.mocked(agentsRunSilent).mockRejectedValueOnce(new Error('AI generation failed'));

      await expect(aiService.streamChat('ext-1', 'Prompt', 'stream-fail')).rejects.toThrow(
        'AI generation failed',
      );

      expect(mockStreamHandle.sendError).toHaveBeenCalledWith({
        code: 'AI_STREAM_ERROR',
        message: 'AI generation failed',
      });
      expect(mockDispose).toHaveBeenCalled();
    });

    it('forwards validated model override in AgentRunConfig', async () => {
      await aiService.streamChat(
        'ext-1',
        'Stream prompt',
        'stream-override',
        { model: { providerId: 'mock-provider', modelId: 'mock-fast' } },
        'worker',
      );

      expect(agentsRunSilent).toHaveBeenCalledWith(
        'agent-123',
        'Stream prompt',
        expect.objectContaining({
          providerOverrideId: 'mock-provider',
          modelOverrideId: 'mock-fast',
        }),
        'stream-override',
        expect.anything(),
      );
    });

    it('rejects invalid model override in streamChat before creating a stream', async () => {
      await expect(
        aiService.streamChat('ext-1', 'Hi', 's-bad', {
          model: { providerId: 'mock-provider', modelId: '' },
        }),
      ).rejects.toThrow(/non-empty providerId and modelId/i);
      expect(agentsRunSilent).not.toHaveBeenCalled();
      expect(streamDispatcher.create).not.toHaveBeenCalled();
    });
  });

  describe('listModels', () => {
    it('returns configured models with isDefault on the default agent model', async () => {
      const models = await aiService.listModels('ext-1');

      expect(models).toEqual([
        {
          providerId: 'mock-provider',
          providerName: 'Mock Provider',
          modelId: 'mock-default-model',
          label: 'Mock Default',
          isDefault: true,
        },
        {
          providerId: 'mock-provider',
          providerName: 'Mock Provider',
          modelId: 'mock-fast',
          label: 'Mock Fast',
          isDefault: false,
        },
      ]);
    });

    it('deduplicates duplicate model entries from a provider', async () => {
      vi.mocked(aiListModels).mockResolvedValueOnce([
        { id: 'mock-default-model', label: 'Mock Default' },
        { id: 'mock-default-model', label: 'Mock Default Duplicate' },
      ]);

      const models = await aiService.listModels('ext-1');
      expect(models).toHaveLength(1);
      expect(models[0].label).toBe('Mock Default');
    });

    it('falls back cleanly when aiGetCredentialStatus or agentsGet rejects', async () => {
      vi.mocked(aiGetCredentialStatus).mockRejectedValueOnce(new Error('cred error'));
      vi.mocked(agentsGet).mockRejectedValueOnce(new Error('agent error'));

      const models = await aiService.listModels('ext-1');
      expect(models).toEqual([
        {
          providerId: 'mock-provider',
          providerName: 'Mock Provider',
          modelId: 'mock-default-model',
          label: 'Mock Default',
          isDefault: false,
        },
        {
          providerId: 'mock-provider',
          providerName: 'Mock Provider',
          modelId: 'mock-fast',
          label: 'Mock Fast',
          isDefault: false,
        },
      ]);
    });

    it('tolerates one failing provider while returning models from healthy providers', async () => {
      vi.mocked(settingsService.getSettings).mockReturnValueOnce({
        ai: {
          defaultAgentId: 'agent-123',
          maxTokens: 2048,
          providers: {
            'mock-provider': { enabled: true, apiKey: 'key' },
            ollama: { enabled: true },
          },
        },
      } as any);

      vi.mocked(aiListModels).mockImplementation(async (providerId: string) => {
        if (providerId === 'ollama') {
          throw new Error('Ollama daemon not running');
        }
        return [{ id: 'mock-default-model', label: 'Mock Default' }];
      });

      const models = await aiService.listModels('ext-1');
      expect(models).toEqual([
        {
          providerId: 'mock-provider',
          providerName: 'Mock Provider',
          modelId: 'mock-default-model',
          label: 'Mock Default',
          isDefault: true,
        },
      ]);
    });
  });
});
