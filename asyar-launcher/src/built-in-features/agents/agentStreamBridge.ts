import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentStreamEvent, AgentStreamEventPayload } from '../../bindings';
import { extractErrorMessage } from '../../lib/errors';
import { agentsCancelRun, agentsReportToolResult } from '../../lib/ipc/commands';
import { invokeTool } from './toolDispatch';

export interface AgentStreamListenerOptions {
  streamId: string;
  agentId: string;
  onEvent?: (event: AgentStreamEvent) => void;
  onBridgeError?: (error: Error) => void;
}

async function reportToolDispatch(
  options: AgentStreamListenerOptions,
  event: Extract<AgentStreamEvent, { type: 'tool_dispatch' }>,
): Promise<void> {
  let result: unknown = null;
  let error: string | undefined;

  try {
    result = await invokeTool(event.tool_id, event.arguments, options.agentId);
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
  return listen<AgentStreamEventPayload>('agent-stream-event', ({ payload }) => {
    if (payload.streamId !== options.streamId) return;

    options.onEvent?.(payload.event);
    if (payload.event.type === 'tool_dispatch') {
      void reportToolDispatch(options, payload.event);
    }
  });
}
