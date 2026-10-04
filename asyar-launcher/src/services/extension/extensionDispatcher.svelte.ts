import { pickExtensionIframe } from './extensionIframeSelector';
import { logService } from '../log/logService';
import {
  dispatchToExtension,
  type IpcPendingMessage,
  type DispatchMessageKind,
  type DispatchTriggerSource,
} from '../../lib/ipc/iframeLifecycleCommands';
import { post } from './extensionDelivery';
import { extensionPendingState } from './extensionPendingState.svelte';
import { extensionDegradedState } from './extensionDegradedState.svelte';

import { workerHost } from './workerHost.svelte';

type ExtensionNameResolver = (extensionId: string) => string | undefined;
let extensionNameResolver: ExtensionNameResolver | null = null;

export function registerExtensionNameResolver(resolver: ExtensionNameResolver): void {
  extensionNameResolver = resolver;
}

export interface DispatchRequest {
  extensionId: string;
  kind: DispatchMessageKind;
  payload: Record<string, unknown>;
  source: DispatchTriggerSource;
  commandMode: 'view' | 'background';
}

const USER_FACING: ReadonlySet<DispatchTriggerSource> = new Set([
  'search',
  'argument',
  'deeplink',
  'userHighlight',
]);

export async function dispatch(req: DispatchRequest): Promise<void> {
  const message: IpcPendingMessage = {
    kind: req.kind,
    payload: req.payload,
    source: req.source,
  };
  logService.debug(
    `[dispatcher] → ${req.extensionId}/${req.kind} source=${req.source} payload=${JSON.stringify(req.payload)}`,
  );
  const role: 'view' | 'worker' = req.commandMode === 'background' ? 'worker' : 'view';
  const outcome = await dispatchToExtension(req.extensionId, message, role);
  logService.debug(`[dispatcher] ← ${req.extensionId} outcome=${outcome.kind}`);

  switch (outcome.kind) {
    case 'readyDeliverNow': {
      if (role === 'worker' && workerHost.hasWorker(req.extensionId)) {
        for (const m of outcome.messages) workerHost.deliver(req.extensionId, m);
        extensionPendingState.markReady(req.extensionId);
        return;
      }
      const iframe = pickExtensionIframe(req.extensionId, role, { fallback: false });
      if (!iframe) {
        logService.warn(
          `[dispatcher] ReadyDeliverNow but iframe DOM node missing for ${req.extensionId}`,
        );
        return;
      }
      for (const m of outcome.messages) post(iframe, m);
      extensionPendingState.markReady(req.extensionId);
      return;
    }
    case 'mountingWaitForReady':
    case 'needsMount':
      if (USER_FACING.has(req.source)) extensionPendingState.markPending(req.extensionId);
      return;
    case 'degraded':
      logService.warn(
        `[dispatcher] extension ${req.extensionId} is degraded (${outcome.strikes} strikes); dropping ${req.source}`,
      );
      if (USER_FACING.has(req.source)) {
        const name = extensionNameResolver?.(req.extensionId) ?? req.extensionId;
        extensionDegradedState.noticeForUser(req.extensionId, name, outcome.strikes);
      }
      return;
  }
}
