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
  agentsReportAiChunk: vi.fn(),
  agentsCancelRun: vi.fn(),
}));

vi.mock('../../services/extension/extensionAiProviderDispatch', () => ({
  invokeExtensionAiProviderStream: vi.fn(),
}));

vi.mock('./toolDispatch', () => ({
  invokeExtensionTool: vi.fn(),
  invokeExtensionWebSearch: vi.fn(),
}));

vi.mock('../mcp/mcpService.svelte', () => ({
  mcpService: { requestPermission: vi.fn() },
}));

import { createAgentStreamChannel } from './agentStreamBridge';
import {
  agentsCancelRun,
  agentsReportMcpPermission,
  agentsReportToolResult,
  agentsReportAiChunk,
} from '../../lib/ipc/commands';
import { invokeExtensionTool, invokeExtensionWebSearch } from './toolDispatch';
import { invokeExtensionAiProviderStream } from '../../services/extension/extensionAiProviderDispatch';
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
    vi.mocked(agentsReportAiChunk).mockResolvedValue(undefined);
    vi.mocked(invokeExtensionAiProviderStream).mockResolvedValue(undefined);
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

  it('routes websearch: prefixed tool dispatches to invokeExtensionWebSearch', async () => {
    vi.mocked(invokeExtensionWebSearch).mockResolvedValue({
      sources: [{ title: 'Doc', url: 'https://doc.example' }],
      results: [{ title: 'Doc', url: 'https://doc.example', snippet: 'Content' }],
    });
    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'tool_dispatch',
      tool_call_id: 'call-ws-1',
      extension_id: 'org.example.keenable',
      tool_id: 'websearch:keenable',
      arguments: { query: 'asyar' },
    });
    await vi.waitFor(() => expect(agentsReportToolResult).toHaveBeenCalledOnce());

    expect(invokeExtensionWebSearch).toHaveBeenCalledWith(
      'org.example.keenable',
      'keenable',
      { query: 'asyar' },
      expect.any(AbortSignal),
    );
    expect(agentsReportToolResult).toHaveBeenCalledWith('stream-1', 'call-ws-1', {
      sources: [{ title: 'Doc', url: 'https://doc.example' }],
      results: [{ title: 'Doc', url: 'https://doc.example', snippet: 'Content' }],
    });
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

  it('dispatches ai_provider_stream_request to invokeExtensionAiProviderStream and relays chunks to Rust', async () => {
    let capturedOnChunk: ((chunk: any) => void) | undefined;
    vi.mocked(invokeExtensionAiProviderStream).mockImplementation(
      async (_extId, _provId, _req, onChunk) => {
        capturedOnChunk = onChunk;
        onChunk({ type: 'token', token: 'Hello' });
        onChunk({ type: 'token', token: ' world' });
      },
    );

    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'ai_provider_stream_request',
      stream_id: 'stream-1',
      request_id: 'req-1',
      extension_id: 'org.example.groq',
      provider_id: 'groq',
      model_id: 'llama-3.3-70b',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Hello',
          timestamp: 1000,
          toolCalls: null,
          toolCallId: null,
          providerContext: null,
        },
      ],
      temperature: 0.7,
      max_tokens: 2048,
      system_prompt: 'You are helpful',
      tools: null,
      api_key: 'gsk_test',
      base_url: 'https://api.groq.com/openai/v1',
      custom_headers: null,
    } as unknown as AgentStreamEvent);

    await vi.waitFor(() => expect(invokeExtensionAiProviderStream).toHaveBeenCalledOnce());

    expect(invokeExtensionAiProviderStream).toHaveBeenCalledWith(
      'org.example.groq',
      'groq',
      {
        modelId: 'llama-3.3-70b',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Hello',
            toolCalls: undefined,
            toolCallId: undefined,
          },
        ],
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: 'You are helpful',
        tools: undefined,
        apiKey: 'gsk_test',
        baseUrl: 'https://api.groq.com/openai/v1',
        customHeaders: undefined,
      },
      expect.any(Function),
      expect.any(AbortSignal),
    );

    await vi.waitFor(() => expect(agentsReportAiChunk).toHaveBeenCalledTimes(3));
    expect(vi.mocked(agentsReportAiChunk).mock.calls).toEqual([
      ['stream-1', 'req-1', { type: 'token', token: 'Hello' }],
      ['stream-1', 'req-1', { type: 'token', token: ' world' }],
      ['stream-1', 'req-1', { type: 'done' }],
    ]);
  });

  it('reports error to agentsReportAiChunk when invokeExtensionAiProviderStream rejects', async () => {
    vi.mocked(invokeExtensionAiProviderStream).mockRejectedValue(new Error('Rate limit exceeded'));

    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'ai_provider_stream_request',
      stream_id: 'stream-1',
      request_id: 'req-1',
      extension_id: 'org.example.groq',
      provider_id: 'groq',
      model_id: 'llama-3.3-70b',
      messages: [],
      temperature: null,
      max_tokens: 1000,
      system_prompt: null,
      tools: null,
      api_key: null,
      base_url: null,
      custom_headers: null,
    } as unknown as AgentStreamEvent);

    await vi.waitFor(() =>
      expect(agentsReportAiChunk).toHaveBeenCalledWith('stream-1', 'req-1', {
        type: 'error',
        error: 'Rate limit exceeded',
      }),
    );
  });

  it('aborts active AI stream when ai_provider_stream_cancelled is emitted', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(invokeExtensionAiProviderStream).mockImplementation(
      async (_extId, _provId, _req, _onChunk, signal) => {
        capturedSignal = signal;
        return new Promise(() => undefined);
      },
    );

    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1' });

    emit({
      type: 'ai_provider_stream_request',
      stream_id: 'stream-1',
      request_id: 'req-1',
      extension_id: 'org.example.groq',
      provider_id: 'groq',
      model_id: 'llama-3.3-70b',
      messages: [],
      temperature: null,
      max_tokens: 1000,
      system_prompt: null,
      tools: null,
      api_key: null,
      base_url: null,
      custom_headers: null,
    } as unknown as AgentStreamEvent);

    expect(capturedSignal?.aborted).toBe(false);

    emit({
      type: 'ai_provider_stream_cancelled',
      request_id: 'req-1',
    } as unknown as AgentStreamEvent);

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('cancels the Rust runner and reports bridge error if chunk reporting fails', async () => {
    const onBridgeError = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(agentsReportAiChunk).mockRejectedValue(new Error('IPC chunk error'));
    vi.mocked(invokeExtensionAiProviderStream).mockImplementation(
      async (_extId, _provId, _req, onChunk, signal) => {
        capturedSignal = signal;
        onChunk({ type: 'token', token: 'Hello' });
        // Wait briefly to see if signal gets aborted
        await new Promise((r) => setTimeout(r, 10));
      },
    );

    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1', onBridgeError });

    emit({
      type: 'ai_provider_stream_request',
      stream_id: 'stream-1',
      request_id: 'req-1',
      extension_id: 'org.example.groq',
      provider_id: 'groq',
      model_id: 'llama-3.3-70b',
      messages: [],
      temperature: null,
      max_tokens: 1000,
      system_prompt: null,
      tools: null,
      api_key: null,
      base_url: null,
      custom_headers: null,
    } as unknown as AgentStreamEvent);

    await vi.waitFor(() => expect(agentsCancelRun).toHaveBeenCalledWith('stream-1'));
    expect(onBridgeError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'IPC chunk error' }),
    );
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('cancels the Rust runner if done reporting itself fails', async () => {
    const onBridgeError = vi.fn();
    vi.mocked(agentsReportAiChunk).mockImplementation(async (_sid, _rid, chunk) => {
      if ((chunk as any).type === 'done') {
        throw new Error('IPC done error');
      }
    });
    vi.mocked(invokeExtensionAiProviderStream).mockImplementation(
      async (_extId, _provId, _req, onChunk) => {
        onChunk({ type: 'token', token: 'Hello' });
      },
    );

    const { emit } = start({ streamId: 'stream-1', agentId: 'agent-1', onBridgeError });

    emit({
      type: 'ai_provider_stream_request',
      stream_id: 'stream-1',
      request_id: 'req-1',
      extension_id: 'org.example.groq',
      provider_id: 'groq',
      model_id: 'llama-3.3-70b',
      messages: [],
      temperature: null,
      max_tokens: 1000,
      system_prompt: null,
      tools: null,
      api_key: null,
      base_url: null,
      custom_headers: null,
    } as unknown as AgentStreamEvent);

    await vi.waitFor(() => expect(agentsCancelRun).toHaveBeenCalledWith('stream-1'));
    expect(onBridgeError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'IPC done error' }),
    );
  });
});
