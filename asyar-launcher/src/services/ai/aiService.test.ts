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
  agentsRunSilent: vi.fn().mockResolvedValue('Completed answer'),
  toAgentProviderDescriptors: vi.fn().mockReturnValue([{ id: 'mock-provider', name: 'Mock' }]),
}));

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn().mockReturnValue({
      ai: {
        defaultAgentId: 'agent-123',
        maxTokens: 2048,
        providers: {
          'mock-provider': { apiKey: 'key' },
        },
      },
    }),
  },
}));

vi.mock('./providerRegistry', () => ({
  providerRegistry: {
    list: vi.fn().mockReturnValue([{ id: 'mock-provider' }]),
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
import { agentsCancelRun, agentsRunSilent } from '../../lib/ipc/commands';
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
  });
});
