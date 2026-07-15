import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@tauri-apps/api/event';
import type { AgentStreamEventPayload } from '../../bindings';

const eventMock = vi.hoisted(() => ({
  handler: undefined as ((event: Event<AgentStreamEventPayload>) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (event: Event<AgentStreamEventPayload>) => void) => {
    eventMock.handler = handler;
    return eventMock.unlisten;
  }),
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsReportToolResult: vi.fn(),
  agentsCancelRun: vi.fn(),
}));

vi.mock('./toolDispatch', () => ({ invokeTool: vi.fn() }));

import { listenToAgentStream } from './agentStreamBridge';
import { agentsCancelRun, agentsReportToolResult } from '../../lib/ipc/commands';
import { invokeTool } from './toolDispatch';

function emit(payload: AgentStreamEventPayload): void {
  eventMock.handler?.({ payload } as Event<AgentStreamEventPayload>);
}

describe('listenToAgentStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventMock.handler = undefined;
    vi.mocked(agentsReportToolResult).mockResolvedValue(undefined);
    vi.mocked(agentsCancelRun).mockResolvedValue(undefined);
  });

  it('filters events by stream id and forwards presentation events', async () => {
    const onEvent = vi.fn();
    await listenToAgentStream({ streamId: 'stream-1', agentId: 'agent-1', onEvent });

    emit({ streamId: 'other', event: { type: 'text_delta', delta: 'x', accumulated: 'x' } });
    emit({
      streamId: 'stream-1',
      event: { type: 'text_delta', delta: 'hello', accumulated: 'hello' },
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: 'text_delta',
      delta: 'hello',
      accumulated: 'hello',
    });
  });

  it('executes a dispatched iframe tool and reports the result to Rust', async () => {
    vi.mocked(invokeTool).mockResolvedValue({ answer: 42 });
    await listenToAgentStream({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      streamId: 'stream-1',
      event: {
        type: 'tool_dispatch',
        tool_call_id: 'call-1',
        tool_id: 'org.example:lookup',
        arguments: { query: 'x' },
      },
    });
    await vi.waitFor(() => expect(agentsReportToolResult).toHaveBeenCalledOnce());

    expect(invokeTool).toHaveBeenCalledWith('org.example:lookup', { query: 'x' }, 'agent-1');
    expect(agentsReportToolResult).toHaveBeenCalledWith('stream-1', 'call-1', { answer: 42 });
  });

  it('reports tool errors so the suspended Rust runner is unblocked', async () => {
    vi.mocked(invokeTool).mockRejectedValue(new Error('extension failed'));
    await listenToAgentStream({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      streamId: 'stream-1',
      event: {
        type: 'tool_dispatch',
        tool_call_id: 'call-1',
        tool_id: 'org.example:lookup',
        arguments: {},
      },
    });
    await vi.waitFor(() => expect(agentsReportToolResult).toHaveBeenCalledOnce());

    expect(agentsReportToolResult).toHaveBeenCalledWith(
      'stream-1',
      'call-1',
      null,
      'extension failed',
    );
  });

  it('cancels the Rust runner if reporting a tool result itself fails', async () => {
    const onBridgeError = vi.fn();
    vi.mocked(invokeTool).mockResolvedValue('ok');
    vi.mocked(agentsReportToolResult).mockRejectedValue(new Error('resume failed'));
    await listenToAgentStream({
      streamId: 'stream-1',
      agentId: 'agent-1',
      onBridgeError,
    });

    emit({
      streamId: 'stream-1',
      event: {
        type: 'tool_dispatch',
        tool_call_id: 'call-1',
        tool_id: 'org.example:lookup',
        arguments: {},
      },
    });
    await vi.waitFor(() => expect(agentsCancelRun).toHaveBeenCalledWith('stream-1'));

    expect(onBridgeError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'resume failed' }),
    );
  });
});
