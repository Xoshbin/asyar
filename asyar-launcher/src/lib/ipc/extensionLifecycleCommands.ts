import { invokeSafe } from './invokeSafe';
import type { IpcDispatchOutcome } from './iframeLifecycleCommands';

export async function stateGet(extensionId: string, key: string): Promise<unknown> {
  return invokeSafe<unknown>('state_get', { extensionId, key });
}

export async function stateSet(extensionId: string, key: string, value: unknown): Promise<void> {
  await invokeSafe('state_set', { extensionId, key, value });
}

export async function stateSubscribe(
  extensionId: string,
  key: string,
  role: 'worker' | 'view',
): Promise<number | null> {
  return invokeSafe<number>('state_subscribe', { extensionId, key, role });
}

export async function stateUnsubscribe(subscriptionId: number): Promise<void> {
  await invokeSafe('state_unsubscribe', { subscriptionId });
}

export async function stateRpcRequest(
  extensionId: string,
  id: string,
  correlationId: string,
  payload: unknown,
): Promise<IpcDispatchOutcome | null> {
  return invokeSafe<IpcDispatchOutcome>('state_rpc_request', {
    extensionId,
    id,
    correlationId,
    payload,
  });
}

export async function stateRpcAbort(
  extensionId: string,
  correlationId: string,
): Promise<IpcDispatchOutcome | null> {
  return invokeSafe<IpcDispatchOutcome>('state_rpc_abort', { extensionId, correlationId });
}

export async function stateRpcReply(
  extensionId: string,
  correlationId: string,
  result?: unknown,
  error?: string,
): Promise<void> {
  await invokeSafe('state_rpc_reply', {
    extensionId,
    correlationId,
    result: result ?? null,
    error: error ?? null,
  });
}

export async function classifyItemsCommand(
  query: string,
  items: { id: string; title: string; subtitle: string | null; keywords: string[] }[],
): Promise<{ id: string; tier: number }[] | null> {
  return invokeSafe<{ id: string; tier: number }[]>('classify_items', { query, items });
}

export async function filterCompatibleExtensionsCommand(
  items: { id: string; platforms: string[] | null }[],
): Promise<string[] | null> {
  return invokeSafe<string[]>('filter_compatible_extensions', { items });
}

export async function completeExtensionOnboarding(extensionId: string): Promise<void> {
  await invokeSafe('complete_extension_onboarding', { extensionId });
}
