/**
 * End-to-end contract: Tab with "Continue last thread" OFF, then first send
 * must create a NEW thread, not reuse the most-recent existing one.
 *
 * This file deliberately does NOT mock `ensureThread` or `openAgentForTab` —
 * those are the two layers under test. Everything else is mocked at the
 * lowest stable seam (IPC commands / side-effect singletons).
 *
 * The tests in this file will FAIL on current code because `ensureThread`
 * currently returns `threads[0]` when threads exist, so `onViewSubmit` writes
 * the old thread-id into `agentsManager.currentThreadId` and calls `runAgent`
 * with the wrong thread.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (must appear before any import of the modules under test) ──────────

vi.mock('./agentsManager.svelte', () => ({
  agentsManager: {
    currentAgentId: null as string | null,
    currentThreadId: null as string | null,
    sending: false,
    streamingText: '',
    activeAbortController: null as AbortController | null,
  },
}));

vi.mock('./agentService.svelte', () => ({
  agentService: {
    agents: [],
    listThreads: vi.fn(),
    createThread: vi.fn(),
    updateThreadTitle: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    navigateToView: vi.fn(),
    activeView: null,
  },
}));

vi.mock('./agentLoop', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('asyar-sdk/contracts', () => ({
  ActionContext: { EXTENSION_VIEW: 'EXTENSION_VIEW' },
}));

vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: {
    registerProvider: vi.fn(),
    activate: vi.fn(),
    updateQuery: vi.fn(),
  },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
    setActionExecutor: vi.fn(),
  },
}));

vi.mock('../../services/run/runService.svelte', () => ({
  runService: { selectedRunId: null, active: [], recent: [] },
}));

vi.mock('../../services/extension/builtinDynamicDispatchers', () => ({
  registerBuiltinDynamicDispatcher: vi.fn(),
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsFindRunOrigin: vi.fn(),
  showSettingsWindow: vi.fn(),
}));

vi.mock('./tabRouter', () => ({
  decideTabDestination: vi.fn(() => ({ agentId: 'agent-a' })),
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: {
    currentSettings: {
      ai: { tabContinuesLastThread: false, defaultAgentId: null, providers: {} },
    },
  },
}));

vi.mock('./dispatch', () => ({
  dispatchAgentCommand: vi.fn(),
}));

// Svelte component stubs
vi.mock('./AgentListView.svelte', () => ({ default: {} }));
vi.mock('./AgentEditView.svelte', () => ({ default: {} }));
vi.mock('./AgentChatView.svelte', () => ({ default: {} }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { openAgentForTab } from './threadOpener';
import { agentsManager } from './agentsManager.svelte';
import { agentService } from './agentService.svelte';
import { runAgent } from './agentLoop';
import agentsExtension from './index';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const oldThread = {
  id: 'old-thread',
  agentId: 'agent-a',
  title: 'Old thread',
  createdAt: 1000,
  updatedAt: 2000,
};

const newThread = {
  id: 'new-thread',
  agentId: 'agent-a',
  title: '',
  createdAt: 3000,
  updatedAt: 3000,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Tab OFF end-to-end: first send creates a new thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsManager.currentAgentId = null;
    agentsManager.currentThreadId = null;
    agentsManager.sending = false;
    agentsManager.streamingText = '';
    agentsManager.activeAbortController = null;
  });

  it('Test D: after Tab OFF → first send → new thread is created, not the old one', async () => {
    // Arrange: one existing thread exists in the service.
    vi.mocked(agentService.listThreads).mockResolvedValue([oldThread]);
    vi.mocked(agentService.createThread).mockResolvedValue(newThread);

    // Step 1: Tab is pressed with continueLastThread=false.
    await openAgentForTab('agent-a', '', false);

    // Step 2: openAgentForTab must set currentThreadId = null (prior fix).
    // This is the invariant the prior fix established.
    expect(agentsManager.currentThreadId).toBeNull();

    // Step 3: Simulate user typing "hello" and pressing Enter.
    // At this point currentThreadId is null, so onViewSubmit calls ensureThread.
    agentsManager.currentAgentId = 'agent-a'; // threadOpener already sets this, but reinforce
    await agentsExtension.onViewSubmit('hello');

    // Step 4: createThread MUST have been called — a new thread was requested.
    expect(agentService.createThread).toHaveBeenCalledWith('agent-a', '');

    // Step 5: After the send, currentThreadId must be the NEW thread, not the old one.
    // On current (buggy) code this will be 'old-thread' because ensureThread returns
    // threads[0] when threads exist.
    expect(agentsManager.currentThreadId).toBe('new-thread');

    // Step 6: runAgent was invoked with the NEW thread id, not the old one.
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'new-thread', agentId: 'agent-a' }),
    );
    expect(runAgent).not.toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'old-thread' }),
    );
  });
});
