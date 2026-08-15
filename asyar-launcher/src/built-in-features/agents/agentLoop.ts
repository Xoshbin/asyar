import type { AgentStreamEvent } from '../../bindings';
import { extractErrorMessage } from '../../lib/errors';
import {
  agentsCancelRun,
  agentsGet,
  agentsRunThread,
  toAgentProviderDescriptors,
} from '../../lib/ipc/commands';
import { providerRegistry } from '../../services/ai/providerRegistry';
import type { ChatStreamStatus } from '../../services/ai/IProviderPlugin';
import { runService } from '../../services/run/runService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { agentService } from './agentService.svelte';
import { createAgentStreamChannel } from './agentStreamBridge';
import type { AgentDef } from './types';

export interface RunAgentInput {
  agentId: string;
  threadId: string;
  userText: string;
  abortSignal?: AbortSignal;
  onUserMessagePersisted?: () => void;
  onAssistantTextDelta?: (delta: string, accumulated: string) => void;
  onAssistantStatus?: (status: ChatStreamStatus | null) => void;
  onAssistantTurnPersisted?: () => void;
}

async function loadAgent(agentId: string): Promise<AgentDef> {
  const cached = agentService.getById(agentId);
  if (cached) return cached;
  const fetched = await agentsGet(agentId);
  if (!fetched) throw new Error(`agent '${agentId}' not found`);
  return fetched;
}

function presentEvent(
  input: RunAgentInput,
  event: AgentStreamEvent,
  writeRunOutput: (text: string) => void,
): void {
  switch (event.type) {
    case 'user_message_persisted':
      input.onUserMessagePersisted?.();
      break;
    case 'text_delta':
      input.onAssistantTextDelta?.(event.delta, event.accumulated);
      writeRunOutput(event.delta);
      break;
    case 'status':
      input.onAssistantStatus?.(event.status === 'searching' ? 'searching' : null);
      break;
    case 'assistant_turn_persisted':
      input.onAssistantTurnPersisted?.();
      break;
    default:
      break;
  }
}

/**
 * Starts a Rust-owned agent run and reflects its events into frontend state.
 * Message persistence, provider streaming, turn limits, and tool sequencing
 * all remain behind the Tauri command boundary.
 */
export async function runAgent(input: RunAgentInput): Promise<void> {
  if (input.abortSignal?.aborted) return;

  const agent = await loadAgent(input.agentId);
  const settings = settingsService.getSettings();

  const handle = await runService.startLocal({
    label: `${agent.name}: ${input.userText.slice(0, 50)}`,
    kind: 'agent',
    cancellable: true,
    extensionId: 'agents',
    subjectId: `cmd_agents_dyn_${input.agentId}`,
  });
  const streamId = `agent-${input.agentId}-${crypto.randomUUID()}`;
  const providerConfig = settings.ai.providers[agent.providerId];
  const runConfig = {
    providers: toAgentProviderDescriptors(providerRegistry.list()),
    configs: settings.ai.providers,
    defaultAgentId: settings.ai.defaultAgentId,
    temperature: providerConfig?.temperature ?? settings.ai.temperature,
    maxTokens: providerConfig?.maxTokens ?? settings.ai.maxTokens,
  };

  let runnerCancelled = false;
  let callerCancelled = false;
  let externallyCancelled = false;
  const streamFailure: { current: Error | null } = { current: null };

  const requestRustCancellation = (): void => {
    void agentsCancelRun(streamId).catch(() => undefined);
  };
  const onAbort = (): void => {
    callerCancelled = true;
    requestRustCancellation();
  };
  const unsubscribeCancel = handle.onCancel(() => {
    externallyCancelled = true;
    requestRustCancellation();
  });
  input.abortSignal?.addEventListener('abort', onAbort, { once: true });

  let dispose: (() => void) | undefined;
  try {
    const stream = createAgentStreamChannel({
      streamId,
      agentId: input.agentId,
      onEvent: (event) => {
        if (event.type === 'cancelled') runnerCancelled = true;
        if (event.type === 'error') streamFailure.current = new Error(event.message);
        presentEvent(input, event, (text) => {
          void handle.write(text).catch(() => undefined);
        });
      },
      onBridgeError: (error) => {
        streamFailure.current = error;
      },
    });
    dispose = stream.dispose;

    await agentsRunThread(
      input.agentId,
      input.threadId,
      input.userText,
      handle.id,
      runConfig,
      streamId,
      stream.channel,
    );

    if (streamFailure.current) throw streamFailure.current;
    if (runnerCancelled || callerCancelled || input.abortSignal?.aborted) {
      if (!externallyCancelled) await handle.cancel().catch(() => undefined);
    } else {
      await handle.done();
    }
  } catch (cause) {
    const streamError = streamFailure.current;
    if (streamError) {
      await handle.fail(streamError.message);
      throw streamError;
    }
    if (runnerCancelled || callerCancelled || externallyCancelled || input.abortSignal?.aborted) {
      if (!externallyCancelled) await handle.cancel().catch(() => undefined);
      return;
    }
    await handle.fail(extractErrorMessage(cause));
    throw cause;
  } finally {
    input.abortSignal?.removeEventListener('abort', onAbort);
    unsubscribeCancel();
    dispose?.();
  }
}
