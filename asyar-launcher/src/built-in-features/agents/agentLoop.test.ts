import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../../bindings';
import type { LocalRunHandle } from '../../services/run/runService.svelte';

vi.mock('./agentService.svelte', () => ({
  agentService: { getById: vi.fn() },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsGet: vi.fn(),
  agentsRunThread: vi.fn(),
  agentsCancelRun: vi.fn(),
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { getSettings: vi.fn() },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: { startLocal: vi.fn() },
}));

const streamMock = vi.hoisted(() => ({
  options: undefined as
    | {
        streamId: string;
        agentId: string;
        onEvent?: (event: AgentStreamEvent) => void;
        onBridgeError?: (error: Error) => void;
      }
    | undefined,
  unlisten: vi.fn(),
}));

vi.mock('./agentStreamBridge', () => ({
  listenToAgentStream: vi.fn(async (options) => {
    streamMock.options = options;
    return streamMock.unlisten;
  }),
}));

import { runAgent } from './agentLoop';
import { agentService } from './agentService.svelte';
import { agentsCancelRun, agentsRunThread } from '../../lib/ipc/commands';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { runService } from '../../services/run/runService.svelte';

type FakeHandle = LocalRunHandle & { fireExternalCancel: () => void };

function makeHandle(): FakeHandle {
  let cancelCallback: (() => void) | undefined;
  return {
    id: 'run-1',
    write: vi.fn().mockResolvedValue(undefined),
    done: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn((callback: () => void) => {
      cancelCallback = callback;
      return vi.fn();
    }),
    fireExternalCancel: () => cancelCallback?.(),
  };
}

const agent = {
  id: 'agent-1',
  name: 'Writer',
  description: null,
  systemPrompt: 'Be concise',
  providerId: 'openai',
  modelId: 'gpt-4o',
  toolSelection: [],
  silent: false,
  inputSource: 'argument' as const,
  outputAction: 'hud' as const,
  createdAt: 1,
  updatedAt: 1,
};

const config = { enabled: true, apiKey: 'sk-test' };
const runConfig = { provider: config, temperature: 0.7, maxTokens: 2048 };

describe('runAgent', () => {
  let handle: FakeHandle;

  beforeEach(() => {
    vi.clearAllMocks();
    streamMock.options = undefined;
    handle = makeHandle();
    vi.mocked(agentService.getById).mockReturnValue(agent);
    vi.mocked(settingsService.getSettings).mockReturnValue({
      ai: {
        providers: { openai: config },
        temperature: 0.7,
        maxTokens: 2048,
      },
    } as never);
    vi.mocked(runService.startLocal).mockResolvedValue(handle);
    vi.mocked(agentsRunThread).mockResolvedValue(undefined);
    vi.mocked(agentsCancelRun).mockResolvedValue(undefined);
  });

  it('registers the event listener before delegating the entire loop to Rust', async () => {
    const order: string[] = [];
    const onUserMessagePersisted = vi.fn();
    const onAssistantTextDelta = vi.fn();
    const onAssistantStatus = vi.fn();
    const onAssistantTurnPersisted = vi.fn();

    vi.mocked(agentsRunThread).mockImplementation(async (...args) => {
      order.push('invoke');
      expect(streamMock.options).toBeDefined();
      const emit = streamMock.options?.onEvent;
      emit?.({ type: 'user_message_persisted' });
      emit?.({ type: 'status', status: 'searching' });
      emit?.({ type: 'text_delta', delta: 'Hi', accumulated: 'Hi' });
      emit?.({ type: 'status', status: null });
      emit?.({ type: 'assistant_turn_persisted' });
      emit?.({ type: 'completed' });
      expect(args[0]).toBe('agent-1');
    });

    const promise = runAgent({
      agentId: 'agent-1',
      threadId: 'thread-1',
      userText: 'hello',
      onUserMessagePersisted,
      onAssistantTextDelta,
      onAssistantStatus,
      onAssistantTurnPersisted,
    });
    order.push('listener');
    await promise;

    expect(order).toEqual(['listener', 'invoke']);
    expect(agentsRunThread).toHaveBeenCalledWith(
      'agent-1',
      'thread-1',
      'hello',
      'run-1',
      runConfig,
      expect.any(String),
    );
    expect(onUserMessagePersisted).toHaveBeenCalledOnce();
    expect(onAssistantStatus).toHaveBeenNthCalledWith(1, 'searching');
    expect(onAssistantStatus).toHaveBeenNthCalledWith(2, null);
    expect(onAssistantTextDelta).toHaveBeenCalledWith('Hi', 'Hi');
    expect(onAssistantTurnPersisted).toHaveBeenCalledOnce();
    expect(handle.write).toHaveBeenCalledWith('Hi');
    expect(handle.done).toHaveBeenCalledOnce();
    expect(streamMock.unlisten).toHaveBeenCalledOnce();
  });

  it('fails the tracked run and rethrows a Rust command error', async () => {
    vi.mocked(agentsRunThread).mockRejectedValue(new Error('provider unavailable'));

    await expect(
      runAgent({ agentId: 'agent-1', threadId: 'thread-1', userText: 'hello' }),
    ).rejects.toThrow('provider unavailable');

    expect(handle.fail).toHaveBeenCalledWith('provider unavailable');
    expect(handle.done).not.toHaveBeenCalled();
    expect(streamMock.unlisten).toHaveBeenCalledOnce();
  });

  it('cancels Rust and marks the run cancelled when the caller aborts', async () => {
    const controller = new AbortController();
    vi.mocked(agentsRunThread).mockImplementation(async () => {
      controller.abort();
      streamMock.options?.onEvent?.({ type: 'cancelled' });
    });

    await runAgent({
      agentId: 'agent-1',
      threadId: 'thread-1',
      userText: 'hello',
      abortSignal: controller.signal,
    });

    expect(agentsCancelRun).toHaveBeenCalledWith(streamMock.options?.streamId);
    expect(handle.cancel).toHaveBeenCalledOnce();
    expect(handle.fail).not.toHaveBeenCalled();
  });

  it('does not double-cancel a run cancelled from the Runs UI', async () => {
    vi.mocked(agentsRunThread).mockImplementation(async () => {
      handle.fireExternalCancel();
      streamMock.options?.onEvent?.({ type: 'cancelled' });
    });

    await runAgent({ agentId: 'agent-1', threadId: 'thread-1', userText: 'hello' });

    expect(agentsCancelRun).toHaveBeenCalledWith(streamMock.options?.streamId);
    expect(handle.cancel).not.toHaveBeenCalled();
    expect(handle.done).not.toHaveBeenCalled();
  });

  it('turns a bridge failure into a tracked run failure', async () => {
    vi.mocked(agentsRunThread).mockImplementation(async () => {
      streamMock.options?.onBridgeError?.(new Error('resume failed'));
      streamMock.options?.onEvent?.({ type: 'cancelled' });
    });

    await expect(
      runAgent({ agentId: 'agent-1', threadId: 'thread-1', userText: 'hello' }),
    ).rejects.toThrow('resume failed');

    expect(handle.fail).toHaveBeenCalledWith('resume failed');
  });

  it('returns before creating a run when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await runAgent({
      agentId: 'agent-1',
      threadId: 'thread-1',
      userText: 'hello',
      abortSignal: controller.signal,
    });

    expect(runService.startLocal).not.toHaveBeenCalled();
    expect(agentsRunThread).not.toHaveBeenCalled();
  });

  it('reports a missing provider configuration before creating a run', async () => {
    vi.mocked(settingsService.getSettings).mockReturnValue({
      ai: { providers: {}, temperature: 0.7, maxTokens: 2048 },
    } as never);

    await expect(
      runAgent({ agentId: 'agent-1', threadId: 'thread-1', userText: 'hello' }),
    ).rejects.toThrow("Provider 'openai' is not configured");

    expect(feedbackService.report).toHaveBeenCalledOnce();
    expect(runService.startLocal).not.toHaveBeenCalled();
  });
});
