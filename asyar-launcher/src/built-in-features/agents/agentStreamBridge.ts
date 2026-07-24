import { Channel } from '@tauri-apps/api/core';
import type { AgentStreamEvent } from '../../bindings';
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
  const abortAll = (): void => {
    for (const controller of activeToolDispatches.values()) controller.abort();
    for (const controller of activePermissionRequests.values()) controller.abort();
    activeToolDispatches.clear();
    activePermissionRequests.clear();
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
    } else if (event.type === 'cancelled') {
      abortAll();
    }
  };

  return { channel, dispose: abortAll };
}
