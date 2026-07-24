import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../../bindings';

// The bridge builds a Tauri Channel; mock it so a test can invoke `onmessage`
// directly (a real Channel needs the Tauri IPC runtime).
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage: ((message: AgentStreamEvent) => void) | undefined;
  },
}));

vi.mock('../../lib/ipc/commands', () => ({
  agentsReportToolResult: vi.fn(),
  agentsReportMcpPermission: vi.fn(),
  agentsCancelRun: vi.fn(),
}));

vi.mock('./toolDispatch', () => ({ invokeExtensionTool: vi.fn() }));

vi.mock('../mcp/mcpService.svelte', () => ({
  mcpService: { requestPermission: vi.fn() },
}));

import { createAgentStreamChannel } from './agentStreamBridge';
import {
  agentsCancelRun,
  agentsReportMcpPermission,
  agentsReportToolResult,
} from '../../lib/ipc/commands';
import { invokeExtensionTool } from './toolDispatch';
import { mcpService } from '../mcp/mcpService.svelte';

interface StreamOptions {
  streamId: string;
  agentId: string;
  onEvent?: (event: AgentStreamEvent) => void;
  onBridgeError?: (error: Error) => void;
}

/** Build a stream and return an `emit` that simulates Rust sending on the channel. */
function start(options: StreamOptions) {
  const { channel, dispose } = createAgentStreamChannel(options);
  const sink = channel as unknown as { onmessage?: (event: AgentStreamEvent) => void };
  return { dispose, emit: (event: AgentStreamEvent) => sink.onmessage?.(event) };
}

describe('createAgentStreamChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentsReportToolResult).mockResolvedValue(undefined);
    vi.mocked(agentsReportMcpPermission).mockResolvedValue(undefined);
    vi.mocked(agentsCancelRun).mockResolvedValue(undefined);
  });

  it('forwards presentation events straight through the channel', () => {
    const onEvent = vi.fn();
    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1', onEvent });

    emit({ type: 'text_delta', delta: 'hello', accumulated: 'hello' });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: 'text_delta',
      delta: 'hello',
      accumulated: 'hello',
    });
  });

  it('executes a dispatched iframe tool and reports the result to Rust', async () => {
    vi.mocked(invokeExtensionTool).mockResolvedValue({ answer: 42 });
    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'tool_dispatch',
      tool_call_id: 'call-1',
      extension_id: 'org.example',
      tool_id: 'lookup',
      arguments: { query: 'x' },
    });
    await vi.waitFor(() => expect(agentsReportToolResult).toHaveBeenCalledOnce());

    expect(invokeExtensionTool).toHaveBeenCalledWith(
      'org.example',
      'lookup',
      { query: 'x' },
      expect.any(AbortSignal),
    );
    expect(agentsReportToolResult).toHaveBeenCalledWith('stream-1', 'call-1', { answer: 42 });
  });

  it('reports tool errors so the suspended Rust runner is unblocked', async () => {
    vi.mocked(invokeExtensionTool).mockRejectedValue(new Error('extension failed'));
    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'tool_dispatch',
      tool_call_id: 'call-1',
      extension_id: 'org.example',
      tool_id: 'lookup',
      arguments: {},
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
    vi.mocked(invokeExtensionTool).mockResolvedValue('ok');
    vi.mocked(agentsReportToolResult).mockRejectedValue(new Error('resume failed'));
    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1', onBridgeError });

    emit({
      type: 'tool_dispatch',
      tool_call_id: 'call-1',
      extension_id: 'org.example',
      tool_id: 'lookup',
      arguments: {},
    });
    await vi.waitFor(() => expect(agentsCancelRun).toHaveBeenCalledWith('stream-1'));

    expect(onBridgeError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'resume failed' }),
    );
  });

  it('reports MCP permission decisions to Rust without invoking MCP in TypeScript', async () => {
    vi.mocked(mcpService.requestPermission).mockResolvedValue('allow_once');
    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'mcp_permission_request',
      tool_call_id: 'call-1',
      server_id: 'linear',
      tool_id: 'create_issue',
      agent_id: 'agent-1',
    });

    await vi.waitFor(() => expect(agentsReportMcpPermission).toHaveBeenCalledOnce());
    expect(mcpService.requestPermission).toHaveBeenCalledWith(
      'linear',
      'create_issue',
      'agent-1',
      expect.any(AbortSignal),
    );
    expect(agentsReportMcpPermission).toHaveBeenCalledWith('stream-1', 'call-1', 'allow_once');
  });

  it('aborts a pending iframe invocation when Rust cancels that dispatch', () => {
    let dispatchSignal: AbortSignal | undefined;
    vi.mocked(invokeExtensionTool).mockImplementation(
      async (_extensionId, _toolId, _args, signal) => {
        dispatchSignal = signal;
        return new Promise(() => undefined);
      },
    );
    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'tool_dispatch',
      tool_call_id: 'call-1',
      extension_id: 'org.example',
      tool_id: 'lookup',
      arguments: {},
    });
    emit({ type: 'tool_dispatch_cancelled', tool_call_id: 'call-1' });

    expect(dispatchSignal?.aborted).toBe(true);
  });
});
