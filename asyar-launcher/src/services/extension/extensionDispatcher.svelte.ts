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
import { extensionManager } from './extensionManager.svelte';

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
  let outcome;
  try {
    outcome = await dispatchToExtension(req.extensionId, message, role);
  } catch (err) {
    logService.error(
      `[dispatcher] ${req.extensionId}/${req.kind} (${req.source}) dispatch failed: ${err}`,
    );
    return;
  }
  logService.debug(
    `[dispatcher] ← ${req.extensionId} outcome=${outcome.kind}`,
  );

  switch (outcome.kind) {
    case 'readyDeliverNow': {
      const iframe = document.querySelector(
        `iframe[data-extension-id="${req.extensionId}"][data-role="${role}"]`,
      ) as HTMLIFrameElement | null;
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
        const manifest = extensionManager.getManifestById?.(req.extensionId);
        extensionDegradedState.noticeForUser(
          req.extensionId,
          (manifest as { name?: string } | undefined)?.name ?? req.extensionId,
          outcome.strikes,
        );
      }
      return;
  }
}
