import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./invokeSafe', () => ({
  invokeSafe: vi.fn(),
  invokeSafeVoid: vi.fn(),
  invokeRaw: vi.fn(),
}));

import { invokeRaw } from './invokeSafe';
import {
  agentsCancelRun,
  agentsReportToolResult,
  agentsRunSilent,
  agentsRunThread,
} from './commands';
import type { AgentDef } from '../../built-in-features/agents/types';
import type { AgentRunConfig } from './commands';

const config: AgentRunConfig = {
  provider: { enabled: true, apiKey: 'test-key' },
  temperature: 0.25,
  maxTokens: 123,
};

const agent: AgentDef = {
  id: 'agent-1',
  name: 'Agent',
  description: null,
  systemPrompt: 'Help',
  providerId: 'openai',
  modelId: 'gpt-4o',
  toolSelection: [],
  silent: true,
  inputSource: 'argument',
  outputAction: 'copy',
  createdAt: null,
  updatedAt: null,
};

describe('agent runner commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invokeRaw).mockResolvedValue(undefined);
  });

  it('starts a persistent Rust agent run with the complete contract', async () => {
    await agentsRunThread('agent-1', 'thread-1', 'hello', 'run-1', config, 'stream-1');

    expect(invokeRaw).toHaveBeenCalledWith('agents_run_thread', {
      agentId: 'agent-1',
      threadId: 'thread-1',
      userText: 'hello',
      runId: 'run-1',
      config,
      streamId: 'stream-1',
    });
  });

  it('starts an ephemeral Rust run and forwards an optional agent override', async () => {
    vi.mocked(invokeRaw).mockResolvedValueOnce('answer');

    await expect(agentsRunSilent('agent-1', 'hello', config, 'stream-2', agent)).resolves.toBe(
      'answer',
    );
    expect(invokeRaw).toHaveBeenCalledWith('agents_run_silent', {
      agentId: 'agent-1',
      userText: 'hello',
      config,
      streamId: 'stream-2',
      agent,
    });
  });

  it('reports tool success and failure through the four-field resume contract', async () => {
    await agentsReportToolResult('stream-1', 'call-1', { answer: 42 });
    await agentsReportToolResult('stream-1', 'call-2', null, 'tool failed');

    expect(vi.mocked(invokeRaw).mock.calls).toEqual([
      [
        'agents_report_tool_result',
        { streamId: 'stream-1', toolCallId: 'call-1', result: { answer: 42 }, error: null },
      ],
      [
        'agents_report_tool_result',
        { streamId: 'stream-1', toolCallId: 'call-2', result: null, error: 'tool failed' },
      ],
    ]);
  });

  it('cancels the Rust runner by stream id', async () => {
    await agentsCancelRun('stream-1');

    expect(invokeRaw).toHaveBeenCalledWith('agents_cancel_run', { streamId: 'stream-1' });
  });
});
