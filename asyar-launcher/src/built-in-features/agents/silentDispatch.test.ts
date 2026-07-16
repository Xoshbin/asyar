import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDef } from './types';

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { getSettings: vi.fn() },
}));

vi.mock('./agentService.svelte', () => ({
  agentService: {
    getById: vi.fn(),
    insertMessage: vi.fn(),
    createThread: vi.fn(),
    listMessages: vi.fn(),
  },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsGet: vi.fn(),
  agentsRunSilent: vi.fn(),
  agentsCancelRun: vi.fn(),
  simulatePaste: vi.fn(),
}));

const spinnerMock = vi.hoisted(() => ({
  replace: vi.fn(async () => undefined),
  dismiss: vi.fn(async () => undefined),
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    report: vi.fn(),
    showHUD: vi.fn(async () => undefined),
    showHUDSpinning: vi.fn(() => spinnerMock),
    sendBackgroundForSource: vi.fn(async () => 'background-1'),
  },
}));

vi.mock('../../services/window/windowService', () => ({
  windowService: { hide: vi.fn() },
}));

vi.mock('../../services/selection/selectionService', () => ({
  selectionService: { getSelectedText: vi.fn() },
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { warn: vi.fn() },
}));

const bridgeMock = vi.hoisted(() => ({
  options: undefined as
    { streamId: string; agentId: string; onBridgeError?: (error: Error) => void } | undefined,
  unlisten: vi.fn(),
}));

vi.mock('./agentStreamBridge', () => ({
  listenToAgentStream: vi.fn(async (options) => {
    bridgeMock.options = options;
    return bridgeMock.unlisten;
  }),
}));

import { dispatchSilentAgentCommand, lastNonEmptyLine } from './silentDispatch';
import { agentService } from './agentService.svelte';
import * as commands from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { selectionService } from '../../services/selection/selectionService';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { windowService } from '../../services/window/windowService';
import { readText, writeText } from 'tauri-plugin-clipboard-x-api';

const config = { enabled: true, apiKey: 'sk-test' };
const runConfig = { provider: config, temperature: 0.7, maxTokens: 2048 };

function makeAgent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'agent-1',
    name: 'Grammar Fix',
    description: null,
    systemPrompt: 'Fix grammar',
    providerId: 'openai',
    modelId: 'gpt-4o',
    toolSelection: [],
    silent: true,
    inputSource: 'argument',
    outputAction: 'replaceSelection',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('lastNonEmptyLine', () => {
  it('returns the final trimmed non-empty line', () => {
    expect(lastNonEmptyLine('first\r\n second \n\n')).toBe('second');
  });

  it('returns an empty string for empty input', () => {
    expect(lastNonEmptyLine('')).toBe('');
  });
});

describe('dispatchSilentAgentCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    bridgeMock.options = undefined;
    vi.mocked(agentService.getById).mockReturnValue(makeAgent());
    vi.mocked(settingsService.getSettings).mockReturnValue({
      ai: { providers: { openai: config }, temperature: 0.7, maxTokens: 2048 },
    } as never);
    vi.mocked(commands.agentsRunSilent).mockResolvedValue('Corrected text');
    vi.mocked(commands.agentsCancelRun).mockResolvedValue(undefined);
    vi.mocked(readText).mockResolvedValue('previous clipboard');
    vi.mocked(writeText).mockResolvedValue(undefined);
    vi.mocked(commands.simulatePaste).mockResolvedValue(undefined);
    vi.mocked(windowService.hide).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures input then delegates the ephemeral loop to Rust without persistence', async () => {
    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo' });

    expect(commands.agentsRunSilent).toHaveBeenCalledWith(
      'agent-1',
      'helo',
      runConfig,
      expect.any(String),
    );
    expect(bridgeMock.options).toEqual(
      expect.objectContaining({ agentId: 'agent-1', streamId: expect.any(String) }),
    );
    expect(agentService.insertMessage).not.toHaveBeenCalled();
    expect(agentService.createThread).not.toHaveBeenCalled();
    expect(agentService.listMessages).not.toHaveBeenCalled();
    expect(bridgeMock.unlisten).toHaveBeenCalledOnce();
  });

  it('captures selected text in Svelte before invoking Rust', async () => {
    vi.mocked(agentService.getById).mockReturnValue(makeAgent({ inputSource: 'selection' }));
    vi.mocked(selectionService.getSelectedText).mockResolvedValue('selected words');

    await dispatchSilentAgentCommand({ agentId: 'agent-1' });

    expect(commands.agentsRunSilent).toHaveBeenCalledWith(
      'agent-1',
      'selected words',
      runConfig,
      expect.any(String),
    );
  });

  it('shows a capture warning and skips Rust for an empty selection', async () => {
    vi.mocked(agentService.getById).mockReturnValue(makeAgent({ inputSource: 'selection' }));
    vi.mocked(selectionService.getSelectedText).mockResolvedValue('  ');

    await dispatchSilentAgentCommand({ agentId: 'agent-1' });

    expect(feedbackService.showHUD).toHaveBeenCalledWith('No selection');
    expect(commands.agentsRunSilent).not.toHaveBeenCalled();
  });

  it('pastes the result and restores the previous clipboard', async () => {
    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo' });

    expect(spinnerMock.dismiss).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenNthCalledWith(1, 'Corrected text');
    expect(windowService.hide).toHaveBeenCalledOnce();
    expect(commands.simulatePaste).toHaveBeenCalledOnce();

    await vi.runAllTimersAsync();
    expect(writeText).toHaveBeenNthCalledWith(2, 'previous clipboard');
  });

  it('supports copy and HUD output actions', async () => {
    vi.mocked(agentService.getById).mockReturnValue(makeAgent({ outputAction: 'copy' }));
    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo' });
    expect(writeText).toHaveBeenCalledWith('Corrected text');
    expect(commands.simulatePaste).not.toHaveBeenCalled();
    expect(spinnerMock.replace).toHaveBeenCalledWith('✓ Copied', {
      spinning: false,
      durationMs: 1500,
    });

    vi.clearAllMocks();
    vi.mocked(agentService.getById).mockReturnValue(makeAgent({ outputAction: 'hud' }));
    vi.mocked(settingsService.getSettings).mockReturnValue({
      ai: { providers: { openai: config }, temperature: 0.7, maxTokens: 2048 },
    } as never);
    vi.mocked(commands.agentsRunSilent).mockResolvedValue('first\nfinal line\n');
    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'hello' });
    expect(spinnerMock.replace).toHaveBeenCalledWith('final line', { spinning: false });
  });

  it('passes the userText directly for a shortcodeMiss input source', async () => {
    const emojiAgent = makeAgent({
      id: 'emoji-agent-uuid',
      inputSource: 'shortcodeMiss',
      outputAction: 'paste',
    });
    vi.mocked(agentService.getById).mockReturnValue(emojiAgent);
    vi.mocked(commands.agentsRunSilent).mockResolvedValue('🎉');

    await dispatchSilentAgentCommand({ agentId: 'emoji-agent-uuid', userText: 'party' });

    expect(commands.agentsRunSilent).toHaveBeenCalledWith(
      'emoji-agent-uuid',
      'party',
      runConfig,
      expect.any(String),
    );
  });

  it('cancels the Rust command and suppresses failure feedback when aborted', async () => {
    const controller = new AbortController();
    vi.mocked(commands.agentsRunSilent).mockImplementation(async () => {
      controller.abort();
      throw new Error('agent run cancelled');
    });

    await dispatchSilentAgentCommand({
      agentId: 'agent-1',
      userText: 'hello',
      abortSignal: controller.signal,
    });

    expect(commands.agentsCancelRun).toHaveBeenCalledWith(bridgeMock.options?.streamId);
    expect(spinnerMock.dismiss).toHaveBeenCalledOnce();
    expect(feedbackService.report).not.toHaveBeenCalled();
  });

  it('reports Rust command failures without throwing into the hotkey caller', async () => {
    vi.mocked(commands.agentsRunSilent).mockRejectedValue(new Error('provider unavailable'));

    await expect(
      dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'hello' }),
    ).resolves.toBeUndefined();

    expect(spinnerMock.replace).toHaveBeenCalledWith('⚠️ Grammar Fix failed', {
      spinning: false,
      durationMs: 3000,
    });
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ developerDetail: 'provider unavailable' }),
    );
    expect(feedbackService.sendBackgroundForSource).toHaveBeenCalledOnce();
  });

  it('reports a bridge resume failure instead of treating cancellation as success', async () => {
    vi.mocked(commands.agentsRunSilent).mockImplementation(async () => {
      bridgeMock.options?.onBridgeError?.(new Error('resume failed'));
      return '';
    });

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'hello' });

    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ developerDetail: 'resume failed' }),
    );
  });

  it('invokes onFinalText and isolates callback failures', async () => {
    const onFinalText = vi.fn().mockRejectedValue(new Error('cache failed'));

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'hello', onFinalText });

    expect(onFinalText).toHaveBeenCalledWith('Corrected text');
    expect(feedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({ developerDetail: 'Error: cache failed' }),
    );
  });
});
