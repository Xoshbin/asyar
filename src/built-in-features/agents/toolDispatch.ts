/**
 * toolDispatch — routes `invokeTool` calls to the right backend.
 *
 * - `builtin:<id>` → `agents_invoke_builtin_tool` Tauri command.
 * - `mcp:<server>:<tool>` → `mcp_invoke_tool` Tauri command, with
 *   automatic permission-prompt flow for write tools.
 * - `<extId>:<id>` → post `asyar:tools:invoke` to the extension's worker
 *   iframe, await the `asyar:tools:invoke:response` envelope.
 */

import { invoke } from '@tauri-apps/api/core';
import { pickExtensionIframe } from '../../services/extension/extensionIframeSelector';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { mcpService } from '../mcp/mcpService.svelte';

let messageIdCounter = 0;
const pendingResponses = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

let responseListenerInstalled = false;

function ensureResponseListener(): void {
  if (responseListenerInstalled) return;
  responseListenerInstalled = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown> | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== 'asyar:tools:invoke:response') return;
    const messageId = msg.messageId as string | undefined;
    if (!messageId) return;
    const pending = pendingResponses.get(messageId);
    if (!pending) return;
    pendingResponses.delete(messageId);
    if ('error' in msg) {
      pending.reject(new Error(String(msg.error)));
    } else {
      pending.resolve(msg.result);
    }
  });
}

export async function invokeTool(
  fullyQualifiedId: string,
  args: unknown,
  agentId: string | null = null,
): Promise<unknown> {
  const colonIdx = fullyQualifiedId.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(
      `invokeTool: invalid tool id — expected 'source:id' format, got '${fullyQualifiedId}'`,
    );
  }

  const source = fullyQualifiedId.slice(0, colonIdx);
  const id = fullyQualifiedId.slice(colonIdx + 1);

  if (source === 'builtin') {
    return invoke('agents_invoke_builtin_tool', { id, args });
  }

  if (source === 'mcp') {
    const secondColon = id.indexOf(':');
    if (secondColon === -1) {
      throw new Error(
        `invokeTool: invalid mcp id '${fullyQualifiedId}' — expected mcp:<server>:<tool>`,
      );
    }
    const serverId = id.slice(0, secondColon);
    const toolId = id.slice(secondColon + 1);
    return invokeMcpTool(serverId, toolId, agentId, args);
  }

  // Tier 2: source is the extension id.
  const iframe = pickExtensionIframe(source, 'worker');
  if (!iframe) {
    throw new Error(
      `invokeTool: extension '${source}' worker iframe is not mounted`,
    );
  }

  const messageId = `tool-${++messageIdCounter}-${Date.now()}`;
  ensureResponseListener();

  return new Promise<unknown>((resolve, reject) => {
    pendingResponses.set(messageId, { resolve, reject });
    iframe.contentWindow?.postMessage(
      {
        type: 'asyar:tools:invoke',
        messageId,
        payload: { id, args },
      },
      getExtensionFrameOrigin(source),
    );
  });
}

async function invokeMcpTool(
  serverId: string,
  toolId: string,
  agentId: string | null,
  args: unknown,
): Promise<unknown> {
  try {
    return await invoke('mcp_invoke_tool', { serverId, toolId, agentId, args });
  } catch (err) {
    if (!String(err).includes('mcp_permission_required')) throw err;
    const decision = await mcpService.requestPermission(
      serverId,
      toolId,
      agentId ?? '',
    );
    if (decision === 'never' || decision === 'cancel') {
      throw new Error(`MCP tool ${toolId} blocked by user`);
    }
    return await invoke('mcp_invoke_tool', { serverId, toolId, agentId, args });
  }
}
