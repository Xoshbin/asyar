// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agentService.svelte', () => ({
  agentService: {
    getById: vi.fn(),
    listThreads: vi.fn(),
    listMessages: vi.fn(),
  },
}));

vi.mock('../../components', async () => ({
  Button: (await import('../../components/base/Button.svelte')).default,
  IconButton: (await import('../../components/base/IconButton.svelte')).default,
}));

vi.mock('../../services/log/logService', () => ({
  logService: { warn: vi.fn() },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsBackfillThreadTitles: vi.fn(),
  replaceDynamicCommandsBuiltin: vi.fn(),
  showSettingsWindow: vi.fn(),
}));

import AgentChatView from './AgentChatView.svelte';
import { agentService } from './agentService.svelte';
import { agentsManager } from './agentsManager.svelte';

const agent = {
  id: 'agent-1',
  name: 'Asyar Assistant',
  description: null,
  systemPrompt: '',
  providerId: 'provider-1',
  modelId: 'model-1',
  toolSelection: [],
  silent: false,
  inputSource: 'argument' as const,
  outputAction: 'replaceSelection' as const,
  createdAt: 1,
  updatedAt: 1,
};

const thread = {
  id: 'thread-1',
  agentId: agent.id,
  title: 'Thread to delete',
  createdAt: 1,
  updatedAt: 1,
};

describe('AgentChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentService.getById).mockReturnValue(agent);
    vi.mocked(agentService.listThreads).mockResolvedValue([thread]);
    vi.mocked(agentService.listMessages).mockResolvedValue([]);
    agentsManager.currentAgentId = agent.id;
    agentsManager.currentThreadId = thread.id;
    agentsManager.sending = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes the sidebar when the selected thread is cleared after deletion', async () => {
    render(AgentChatView);
    await screen.findByText(thread.title);

    vi.mocked(agentService.listThreads).mockResolvedValue([]);
    agentsManager.currentThreadId = null;

    await screen.findByText('No threads');
    await waitFor(() => expect(screen.queryByText(thread.title)).toBeNull());
  });

  it('keeps pending scroll callbacks safe after unmount', async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
    );

    const view = render(AgentChatView);
    await screen.findByText(thread.title);
    view.unmount();

    expect(callbacks.length).toBeGreaterThan(0);
    expect(() => callbacks.forEach((callback) => callback(0))).not.toThrow();
  });
});
