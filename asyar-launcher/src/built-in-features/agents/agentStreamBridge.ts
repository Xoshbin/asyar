import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentStreamEvent, AgentStreamEventPayload } from '../../bindings';
import { extractErrorMessage } from '../../lib/errors';
import {
  agentsCancelRun,
  agentsReportMcpPermission,
  agentsReportToolResult,
} from '../../lib/ipc/commands';
import { invokeExtensionTool } from './toolDispatch';
import { mcpService } from '../mcp/mcpService.svelte';

export interface AgentStreamListenerOptions {
  streamId: string;
  agentId: string;
  onEvent?: (event: AgentStreamEvent) => void;
  onBridgeError?: (error: Error) => void;
}

async function reportToolDispatch(
  options: AgentStreamListenerOptions,
  event: Extract<AgentStreamEvent, { type: 'tool_dispatch' }>,
  signal: AbortSignal,
): Promise<void> {
  let result: unknown = null;
  let error: string | undefined;

  try {
    result = await invokeExtensionTool(event.extension_id, event.tool_id, event.arguments, signal);
  } catch (cause) {
    error = extractErrorMessage(cause);
  }

  try {
    if (error === undefined) {
      await agentsReportToolResult(options.streamId, event.tool_call_id, result);
    } else {
      await agentsReportToolResult(options.streamId, event.tool_call_id, result, error);
    }
  } catch (cause) {
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
    await agentsReportMcpPermission(options.streamId, event.tool_call_id, decision);
  } catch (cause) {
    await agentsCancelRun(options.streamId).catch(() => undefined);
    options.onBridgeError?.(new Error(extractErrorMessage(cause)));
  }
}

/**
 * Browser-bound adapter for Rust runner events.
 *
 * The Rust runner owns the loop and tool-result sequencing. This module only
 * forwards presentation events and performs the one browser-only operation:
 * invoking a Tier 2 extension tool in its worker iframe.
 */
export async function listenToAgentStream(
  options: AgentStreamListenerOptions,
): Promise<UnlistenFn> {
  const activeToolDispatches = new Map<string, AbortController>();
  const activePermissionRequests = new Map<string, AbortController>();
  const abortAll = (): void => {
    for (const controller of activeToolDispatches.values()) controller.abort();
    for (const controller of activePermissionRequests.values()) controller.abort();
    activeToolDispatches.clear();
    activePermissionRequests.clear();
  };
  const unlisten = await listen<AgentStreamEventPayload>('agent-stream-event', ({ payload }) => {
    if (payload.streamId !== options.streamId) return;

    options.onEvent?.(payload.event);
    if (payload.event.type === 'tool_dispatch') {
      const toolCallId = payload.event.tool_call_id;
      const controller = new AbortController();
      activeToolDispatches.set(toolCallId, controller);
      void reportToolDispatch(options, payload.event, controller.signal).finally(() => {
        activeToolDispatches.delete(toolCallId);
      });
    } else if (payload.event.type === 'mcp_permission_request') {
      const toolCallId = payload.event.tool_call_id;
      const controller = new AbortController();
      activePermissionRequests.set(toolCallId, controller);
      void reportMcpPermission(options, payload.event, controller.signal).finally(() => {
        activePermissionRequests.delete(toolCallId);
      });
    } else if (payload.event.type === 'tool_dispatch_cancelled') {
      activeToolDispatches.get(payload.event.tool_call_id)?.abort();
      activeToolDispatches.delete(payload.event.tool_call_id);
    } else if (payload.event.type === 'mcp_permission_cancelled') {
      activePermissionRequests.get(payload.event.tool_call_id)?.abort();
      activePermissionRequests.delete(payload.event.tool_call_id);
    } else if (payload.event.type === 'cancelled') {
      abortAll();
    }
  });
  return () => {
    abortAll();
    unlisten();
  };
}
