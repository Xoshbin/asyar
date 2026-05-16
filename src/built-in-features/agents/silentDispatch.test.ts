/**
 * Contract tests for the silent-AI dispatcher.
 *
 * Hard rules these tests pin in place:
 *  1. Successful silent runs never call `runService.startLocal` (no Run
 *     row), never call `agentService.insertMessage` or `createThread`
 *     (no thread / messages), and never touch
 *     `agentsManager.currentAgentId` or `viewManager.navigateToView`.
 *  2. `outputAction: 'replaceSelection'` writes to clipboard, hides the
 *     window, simulates paste, then restores the previous clipboard
 *     after a short delay.
 *  3. `outputAction: 'copy'` writes to clipboard only — no paste, no
 *     window hide, no clipboard restore.
 *  4. `outputAction: 'hud'` calls `feedbackService.showHUD` with the
 *     last non-empty line of the LLM response.
 *  5. `inputSource: 'selection'` reads from `selectionService.getSelectedText()`.
 *     Empty selection HUDs a warning and returns (no LLM call).
 *  6. Provider / API failures surface through diagnostics + a system
 *     notification, never as a thrown exception (the hotkey UX has
 *     nowhere to show a thrown error).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (must be declared before importing the module under test) ──────────

vi.mock('../../services/ai/providerRegistry', () => ({
  getProvider: vi.fn(),
}));

vi.mock('../../services/ai/aiEngine', () => ({
  streamChat: vi.fn(),
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    getSettings: vi.fn(),
  },
}));

vi.mock('./agentService.svelte', () => ({
  agentService: {
    getById: vi.fn(),
    insertMessage: vi.fn(),
    createThread: vi.fn(),
    listThreads: vi.fn(),
    listMessages: vi.fn(),
  },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsGet: vi.fn(),
  agentsToolsList: vi.fn(),
  simulatePaste: vi.fn(),
}));

vi.mock('./toolDispatch', () => ({
  invokeTool: vi.fn(),
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { showHUD: vi.fn() },
}));

vi.mock('../../services/notification/notificationService', () => ({
  notificationService: { send: vi.fn() },
}));

vi.mock('../../services/window/windowService', () => ({
  windowService: { hide: vi.fn(), show: vi.fn() },
}));

vi.mock('../../services/selection/selectionService', () => ({
  selectionService: { getSelectedText: vi.fn() },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: { startLocal: vi.fn() },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  dispatchSilentAgentCommand,
  lastNonEmptyLine,
} from './silentDispatch';
import { getProvider } from '../../services/ai/providerRegistry';
import { streamChat } from '../../services/ai/aiEngine';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { agentService } from './agentService.svelte';
import * as commands from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { notificationService } from '../../services/notification/notificationService';
import { windowService } from '../../services/window/windowService';
import { selectionService } from '../../services/selection/selectionService';
import { runService } from '../../services/run/runService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { readText, writeText } from 'tauri-plugin-clipboard-x-api';
import type { AgentDef } from './types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAgent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'agent-1',
    name: 'Grammar Fix',
    description: null,
    systemPrompt: 'Fix grammar. Reply only with the corrected text.',
    providerId: 'openai',
    modelId: 'gpt-4o',
    toolSelection: [],
    silent: true,
    inputSource: 'argument',
    outputAction: 'replaceSelection',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

const makeSettings = (apiKey = 'sk-test') => ({
  ai: {
    providers: {
      openai: { enabled: true, apiKey },
    },
    temperature: 0.7,
    maxTokens: 2048,
    activeProviderId: 'openai',
    activeModelId: 'gpt-4o',
    allowExtensionUse: true,
  },
});

const makePlugin = () => ({
  id: 'openai' as const,
  name: 'OpenAI',
  requiresApiKey: true,
  requiresBaseUrl: false,
  optionalApiKey: false,
  getModels: vi.fn(),
  buildRequest: vi.fn(),
  parseStream: vi.fn(),
});

function wireHappyPath(agent: AgentDef, responseText: string): void {
  vi.mocked(agentService.getById).mockReturnValue(agent as never);
  vi.mocked(getProvider).mockReturnValue(makePlugin() as never);
  vi.mocked(settingsService.getSettings).mockReturnValue(makeSettings() as never);
  vi.mocked(streamChat).mockImplementation(
    async (_plugin, _config, _messages, _params, handlers) => {
      handlers.onToken(responseText);
      handlers.onDone();
    },
  );
  vi.mocked(readText).mockResolvedValue('previous-clipboard');
  vi.mocked(writeText).mockResolvedValue(undefined);
  vi.mocked(commands.simulatePaste).mockResolvedValue(undefined);
  vi.mocked(windowService.hide).mockResolvedValue(undefined);
}

// ── lastNonEmptyLine ──────────────────────────────────────────────────────────

describe('lastNonEmptyLine', () => {
  it('returns the only line for single-line text', () => {
    expect(lastNonEmptyLine('hello world')).toBe('hello world');
  });

  it('returns the last non-empty line, ignoring trailing blanks', () => {
    expect(lastNonEmptyLine('first\nsecond\n\n')).toBe('second');
  });

  it('handles CRLF line endings', () => {
    expect(lastNonEmptyLine('a\r\nb\r\nc')).toBe('c');
  });

  it('trims whitespace within the returned line', () => {
    expect(lastNonEmptyLine('foo\n   bar   ')).toBe('bar');
  });

  it('returns empty string for empty input', () => {
    expect(lastNonEmptyLine('')).toBe('');
  });
});

// ── No-promotion contract ─────────────────────────────────────────────────────

describe('dispatchSilentAgentCommand — Run + thread suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never_calls_runService_startLocal_on_success', async () => {
    wireHappyPath(makeAgent(), 'Corrected text');

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo wrld' });

    expect(runService.startLocal).not.toHaveBeenCalled();
  });

  it('never_persists_thread_or_messages_on_success', async () => {
    wireHappyPath(makeAgent(), 'Corrected text');

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo wrld' });

    expect(agentService.createThread).not.toHaveBeenCalled();
    expect(agentService.insertMessage).not.toHaveBeenCalled();
    expect(agentService.listThreads).not.toHaveBeenCalled();
  });

  it('never_navigates_to_AgentChatView_on_success', async () => {
    wireHappyPath(makeAgent(), 'Corrected text');

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo wrld' });

    expect(viewManager.navigateToView).not.toHaveBeenCalled();
  });
});

// ── Output actions ────────────────────────────────────────────────────────────

describe('dispatchSilentAgentCommand — outputAction: replaceSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes_result_to_clipboard_then_hides_then_pastes', async () => {
    wireHappyPath(makeAgent({ outputAction: 'replaceSelection' }), 'Hello world');

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo wrld' });

    // writeText is called twice: once with the LLM output, once to restore.
    // Verify the LLM output write happened.
    expect(writeText).toHaveBeenCalledWith('Hello world');
    expect(windowService.hide).toHaveBeenCalledTimes(1);
    expect(commands.simulatePaste).toHaveBeenCalledTimes(1);
  });

  it('restores_previous_clipboard_after_short_delay', async () => {
    wireHappyPath(makeAgent({ outputAction: 'replaceSelection' }), 'Hello world');

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'helo wrld' });

    // Before timers fire, only the result is on the clipboard.
    expect(writeText).toHaveBeenCalledWith('Hello world');
    expect(writeText).not.toHaveBeenCalledWith('previous-clipboard');

    // Advance time past the restore delay.
    await vi.advanceTimersByTimeAsync(300);

    expect(writeText).toHaveBeenCalledWith('previous-clipboard');
  });
});

describe('dispatchSilentAgentCommand — outputAction: copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes_to_clipboard_but_does_not_paste_or_hide_window', async () => {
    wireHappyPath(makeAgent({ outputAction: 'copy' }), 'COPY ME');

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'x' });

    expect(writeText).toHaveBeenCalledWith('COPY ME');
    expect(commands.simulatePaste).not.toHaveBeenCalled();
    expect(windowService.hide).not.toHaveBeenCalled();
  });
});

describe('dispatchSilentAgentCommand — outputAction: hud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows_last_non_empty_line_of_response_in_HUD', async () => {
    wireHappyPath(
      makeAgent({ outputAction: 'hud' }),
      'first line\nsecond line\n',
    );

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'x' });

    expect(feedbackService.showHUD).toHaveBeenCalledWith('second line');
    // HUD never touches the clipboard or paste.
    expect(commands.simulatePaste).not.toHaveBeenCalled();
  });
});

// ── Input sources ─────────────────────────────────────────────────────────────

describe('dispatchSilentAgentCommand — inputSource: selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads_selection_via_selectionService_and_passes_it_to_the_LLM', async () => {
    const agent = makeAgent({ inputSource: 'selection', outputAction: 'copy' });
    wireHappyPath(agent, 'OK');
    vi.mocked(selectionService.getSelectedText).mockResolvedValue('the cat sit on mat');

    await dispatchSilentAgentCommand({ agentId: 'agent-1' });

    expect(selectionService.getSelectedText).toHaveBeenCalled();
    // streamChat should have received a user-role message with the selection.
    const call = vi.mocked(streamChat).mock.calls[0];
    const messages = call?.[2];
    expect(messages).toBeDefined();
    const userMsg = messages?.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe('the cat sit on mat');
  });

  it('shows_HUD_warning_and_skips_LLM_when_selection_is_empty', async () => {
    const agent = makeAgent({ inputSource: 'selection' });
    vi.mocked(agentService.getById).mockReturnValue(agent as never);
    vi.mocked(selectionService.getSelectedText).mockResolvedValue('');

    await dispatchSilentAgentCommand({ agentId: 'agent-1' });

    expect(feedbackService.showHUD).toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});

// ── Failure handling ──────────────────────────────────────────────────────────

describe('dispatchSilentAgentCommand — failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports_diagnostic_and_sends_notification_when_provider_errors', async () => {
    const agent = makeAgent();
    vi.mocked(agentService.getById).mockReturnValue(agent as never);
    vi.mocked(getProvider).mockReturnValue(makePlugin() as never);
    vi.mocked(settingsService.getSettings).mockReturnValue(makeSettings() as never);
    vi.mocked(streamChat).mockImplementation(
      async (_plugin, _config, _messages, _params, handlers) => {
        handlers.onError('rate_limited: try again later');
      },
    );

    // Must NOT throw — failures are surfaced via diagnostics/notification only.
    await expect(
      dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'x' }),
    ).resolves.toBeUndefined();

    expect(diagnosticsService.report).toHaveBeenCalled();
    const reportCall = vi.mocked(diagnosticsService.report).mock.calls[0]?.[0] as {
      kind?: string;
      severity?: string;
    };
    expect(reportCall?.kind).toBe('silent_agent_failed');
    expect(reportCall?.severity).toBe('warning');

    expect(notificationService.send).toHaveBeenCalled();
  });

  it('reports_failure_when_api_key_is_missing', async () => {
    const agent = makeAgent();
    vi.mocked(agentService.getById).mockReturnValue(agent as never);
    vi.mocked(getProvider).mockReturnValue(makePlugin() as never);
    vi.mocked(settingsService.getSettings).mockReturnValue(makeSettings('') as never);

    await dispatchSilentAgentCommand({ agentId: 'agent-1', userText: 'x' });

    expect(notificationService.send).toHaveBeenCalled();
    // No clipboard work should have happened.
    expect(writeText).not.toHaveBeenCalled();
  });
});
