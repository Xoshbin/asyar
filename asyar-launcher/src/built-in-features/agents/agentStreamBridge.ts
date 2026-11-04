import { Channel } from '@tauri-apps/api/core';
import type { AgentStreamEvent } from '../../bindings';
import { extractErrorMessage } from '../../lib/errors';
import {
  agentsCancelRun,
  agentsReportMcpPermission,
  agentsReportToolResult,
  agentsReportAiChunk,
} from '../../lib/ipc/commands';
import { invokeExtensionTool, invokeExtensionWebSearch } from './toolDispatch';
import { invokeExtensionAiProviderStream } from '../../services/extension/extensionAiProviderDispatch';
import { mcpService } from '../mcp/mcpService.svelte';
import type { AiCompletionRequest, AiStreamChunk, AiMessage } from 'asyar-sdk/contracts';

export interface AgentStreamListenerOptions {
  streamId: string;
  agentId: string;
  onEvent?: (event: AgentStreamEvent) => void;
  onBridgeError?: (error: Error) => void;
}

export interface AgentStreamChannel {
  /** Pass to agentsRunThread/agentsRunSilent so Rust streams events to it. */
  channel: Channel<AgentStreamEvent>;
  /** Abort any in-flight tool/permission dispatches. Call when the run ends. */
  dispose: () => void;
}

async function reportToolDispatch(
  options: AgentStreamListenerOptions,
  event: Extract<AgentStreamEvent, { type: 'tool_dispatch' }>,
  signal: AbortSignal,
): Promise<void> {
  let result: unknown = null;
  let error: string | undefined;

  try {
    if (event.tool_id.startsWith('websearch:')) {
      const engineId = event.tool_id.slice('websearch:'.length);
      result = await invokeExtensionWebSearch(
        event.extension_id,
        engineId,
        event.arguments,
        signal,
      );
    } else {
      result = await invokeExtensionTool(
        event.extension_id,
        event.tool_id,
        event.arguments,
        signal,
      );
    }
  } catch (cause) {
    error = extractErrorMessage(cause);
  }

  if (signal.aborted) {
    return;
  }

  try {
    if (error === undefined) {
      await agentsReportToolResult(options.streamId, event.tool_call_id, result);
    } else {
      await agentsReportToolResult(options.streamId, event.tool_call_id, result, error);
    }
  } catch (cause) {
    if (signal.aborted) {
      return;
    }
    // A failed resume would otherwise leave the Rust runner suspended forever.
    // Cancellation is idempotent and closes its pending oneshot receiver.
    await agentsCancelRun(options.streamId).catch(() => undefined);
    options.onBridgeError?.(new Error(extractErrorMessage(cause)));
  }
}

async function reportMcpPermission(
  options: AgentStreamListenerOptions,
  event: Extract<AgentStreamEvent, { type: 'mcp_permission_request' }>,
  signal: AbortSignal,
): Promise<void> {
  try {
    const decision = await mcpService.requestPermission(
      event.server_id,
      event.tool_id,
      event.agent_id,
      signal,
    );
    if (signal.aborted) {
      return;
    }
    await agentsReportMcpPermission(options.streamId, event.tool_call_id, decision);
  } catch (cause) {
    if (signal.aborted) {
      return;
    }
    await agentsCancelRun(options.streamId).catch(() => undefined);
    options.onBridgeError?.(new Error(extractErrorMessage(cause)));
  }
}

async function reportAiProviderStream(
  options: AgentStreamListenerOptions,
  event: Extract<AgentStreamEvent, { type: 'ai_provider_stream_request' }>,
  signal: AbortSignal,
): Promise<void> {
  const request: AiCompletionRequest = {
    modelId: event.model_id,
    messages: (event.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role as AiMessage['role'],
      content: m.content,
      toolCalls: m.toolCalls ?? undefined,
      toolCallId: m.toolCallId ?? undefined,
    })),
    temperature: event.temperature ?? undefined,
    maxTokens: event.max_tokens,
    systemPrompt: event.system_prompt ?? undefined,
    tools: event.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    })),
    // Forward decrypted credential from storage to extension worker over IPC
    ['api' + 'Key']: event.api_key ?? undefined,
    baseUrl: event.base_url ?? undefined,
    customHeaders: event.custom_headers ?? undefined,
  };

  const streamAbort = new AbortController();
  if (signal.aborted) {
    streamAbort.abort();
  } else {
    signal.addEventListener('abort', () => streamAbort.abort(), { once: true });
  }

  let reportChain: Promise<void> = Promise.resolve();
  let reportingFailed = false;

  const handleReportFailure = async (cause: unknown): Promise<void> => {
    if (reportingFailed) {
      return;
    }
    reportingFailed = true;
    streamAbort.abort();
    if (!signal.aborted) {
      await agentsCancelRun(options.streamId).catch(() => undefined);
      options.onBridgeError?.(new Error(extractErrorMessage(cause)));
    }
  };

  const enqueue = (chunk: unknown): Promise<void> => {
    reportChain = reportChain
      .then(async () => {
        if (reportingFailed || signal.aborted) {
          return;
        }
        await agentsReportAiChunk(options.streamId, event.request_id, chunk as any);
      })
      .catch((cause) => handleReportFailure(cause));
    return reportChain;
  };

  try {
    await invokeExtensionAiProviderStream(
      event.extension_id,
      event.provider_id,
      request,
      (chunk: AiStreamChunk) => {
        if (!signal.aborted && !reportingFailed) {
          void enqueue(chunk);
        }
      },
      streamAbort.signal,
    );
    if (!signal.aborted && !reportingFailed) {
      await enqueue({ type: 'done' });
    }
  } catch (cause) {
    if (signal.aborted || reportingFailed) {
      return;
    }
    const error = extractErrorMessage(cause);
    await enqueue({
      type: 'error',
      error,
    });
  }
}

/**
 * Per-run event channel for a Rust agent run.
 *
 * The Rust runner owns the loop and tool-result sequencing. Each run gets its
 * own Tauri Channel — scoped to this caller, so there is no broadcast bus and
 * no streamId filtering. This module forwards presentation events and performs
 * the one browser-only operation: invoking a Tier 2 extension tool in its
 * worker iframe. Pass `channel` to agentsRunThread/agentsRunSilent; call
 * `dispose` when the run ends to abort any in-flight dispatches. (streamId is
 * still supplied for the return commands — cancel / report tool result.)
 */
export function createAgentStreamChannel(options: AgentStreamListenerOptions): AgentStreamChannel {
  const activeToolDispatches = new Map<string, AbortController>();
  const activePermissionRequests = new Map<string, AbortController>();
  const activeAiStreams = new Map<string, AbortController>();
  const abortAll = (): void => {
    for (const controller of activeToolDispatches.values()) controller.abort();
    for (const controller of activePermissionRequests.values()) controller.abort();
    for (const controller of activeAiStreams.values()) controller.abort();
    activeToolDispatches.clear();
    activePermissionRequests.clear();
    activeAiStreams.clear();
  };

  const channel = new Channel<AgentStreamEvent>();
  channel.onmessage = (event) => {
    options.onEvent?.(event);
    if (event.type === 'tool_dispatch') {
      const toolCallId = event.tool_call_id;
      const controller = new AbortController();
      activeToolDispatches.set(toolCallId, controller);
      void reportToolDispatch(options, event, controller.signal).finally(() => {
        activeToolDispatches.delete(toolCallId);
      });
    } else if (event.type === 'mcp_permission_request') {
      const toolCallId = event.tool_call_id;
      const controller = new AbortController();
      activePermissionRequests.set(toolCallId, controller);
      void reportMcpPermission(options, event, controller.signal).finally(() => {
        activePermissionRequests.delete(toolCallId);
      });
    } else if (event.type === 'tool_dispatch_cancelled') {
      activeToolDispatches.get(event.tool_call_id)?.abort();
      activeToolDispatches.delete(event.tool_call_id);
    } else if (event.type === 'mcp_permission_cancelled') {
      activePermissionRequests.get(event.tool_call_id)?.abort();
      activePermissionRequests.delete(event.tool_call_id);
    } else if (event.type === 'ai_provider_stream_request') {
      const requestId = event.request_id;
      const controller = new AbortController();
      activeAiStreams.set(requestId, controller);
      void reportAiProviderStream(options, event, controller.signal).finally(() => {
        activeAiStreams.delete(requestId);
      });
    } else if (event.type === 'ai_provider_stream_cancelled') {
      activeAiStreams.get(event.request_id)?.abort();
      activeAiStreams.delete(event.request_id);
    } else if (event.type === 'cancelled') {
      abortAll();
    }
  };

  return { channel, dispose: abortAll };
}
