import { logService } from '../../log/logService';
import * as commands from '../../../lib/ipc/commands';
import { feedbackService } from '../../feedback/feedbackService.svelte';
import { extensionPreferencesService } from '../extensionPreferencesService.svelte';
import { streamDispatcher } from '../streamDispatcher.svelte';
import { isDevInspectorActive } from './devTracing';
import type { IframeRole, IpcContext, IpcHandler } from './types';

/**
 * Self-scoped UI affordance, deliberately ungated: any frame may ask the
 * launcher to hide itself, and it grants nothing beyond that.
 */
const windowHide: IpcHandler = {
  name: 'window:hide',
  beforeIdentity: true,
  run(ctx) {
    ctx.deps.goBack();
    ctx.deps.saveSearchIndex();
    commands.hideWindow();
  },
};

/**
 * Dev-inspector diagnostics from either iframe. The id is whatever the logging
 * frame claims — nothing is granted on it, it only labels a log row.
 */
const devInspectorLog: IpcHandler = {
  name: 'dev:inspectorLog',
  beforeIdentity: true,
  match: () => isDevInspectorActive(),
  run(ctx) {
    const devExtensionId = ctx.payload?.extensionId || ctx.data?.extensionId;
    if (!devExtensionId) return;
    void import('../../dev/inspectorStore.svelte').then(({ inspectorStore }) => {
      if (ctx.type === 'asyar:dev:rpc-log') {
        inspectorStore.recordRpcLog(devExtensionId, ctx.payload);
      } else {
        inspectorStore.recordIpcLog(devExtensionId, ctx.payload);
      }
    });
  },
};

/**
 * Auto-fault reporting. Worker iframes post this directly to the launcher
 * window rather than through the SDK proxy bag, so it carries no messageId and
 * gets no reply; an unrecognized source is dropped silently.
 */
const feedbackUncaught: IpcHandler = {
  name: 'feedback:uncaught',
  beforeIdentity: true,
  run(ctx) {
    const extensionId = ctx.deps.findExtensionIdForSource(ctx.source);
    if (!extensionId) return;
    const role = ctx.deps.findIframeRoleForSource(ctx.source);
    void feedbackService.report({
      source: 'extension',
      kind:
        ctx.payload?.kind === 'iframe_unhandled_rejection'
          ? 'iframe_unhandled_rejection'
          : 'iframe_uncaught',
      severity: 'error',
      retryable: false,
      context: { extensionId, role: role ?? 'unknown' },
      extensionId,
      developerDetail: ctx.payload?.developerDetail,
    });
  },
};

const streamAbort: IpcHandler = {
  name: 'stream:abort',
  run(ctx) {
    const streamId = ctx.payload?.streamId ?? ctx.data?.streamId;
    if (!streamId || typeof streamId !== 'string') {
      logService.warn('[IpcRouter] asyar:stream:abort message missing streamId — ignoring');
      return;
    }
    streamDispatcher.abort(streamId);
  },
};

/**
 * The iframe signals it has booted. The reply is the preferences bundle on
 * `asyar:event:preferences:set-all`, not an `asyar:response` envelope — the
 * SDK installs it on the live ExtensionContext.
 */
const extensionLoaded: IpcHandler = {
  name: 'extension:loaded',
  async run(ctx) {
    logService.info(`Extension ready: ${ctx.extensionId}`);
    if (!ctx.extensionId) return;
    const bundle = await extensionPreferencesService.getEffectivePreferences(ctx.extensionId);
    (ctx.source as WindowProxy | null)?.postMessage(
      {
        type: 'asyar:event:preferences:set-all',
        payload: { extension: bundle.extension, commands: bundle.commands },
      },
      '*',
    );
  },
};

/**
 * Stamps which iframe role owns the handler so sendActionExecuteToExtension can
 * route `asyar:action:execute` back to it, then still replies so the SDK's
 * `broker.invoke` resolves.
 */
const registerActionHandler: IpcHandler = {
  name: 'api:actions:registerActionHandler',
  replies: true,
  run(ctx) {
    if (ctx.isPrivilegedHostContext || !ctx.extensionId) return;
    const actionId = typeof ctx.payload?.actionId === 'string' ? ctx.payload.actionId : null;
    if (!ctx.role || !actionId) return;
    const actionsService = ctx.deps.serviceRegistry.actions as {
      recordActionHandlerRole?: (extensionId: string, actionId: string, role: IframeRole) => void;
    };
    actionsService.recordActionHandlerRole?.(ctx.extensionId, actionId, ctx.role);
  },
};

/** The one permission-bearing surface: everything under `asyar:api:`. */
export const API_CALL_HANDLER: IpcHandler = {
  name: 'api:dispatch',
  replies: true,
  async run(ctx) {
    // Tagged so streaming APIs route chunks back to the originating iframe.
    const originRole = ctx.isPrivilegedHostContext ? undefined : ctx.role;
    ctx.result = await ctx.deps.dispatchApiCall(
      ctx.type,
      ctx.payload,
      ctx.extensionId,
      ctx.isPrivilegedHostContext,
      originRole,
    );
  },
};

/** Any other `asyar:*` frame: an empty reply so the caller never hangs. */
export const UNHANDLED_FRAME_HANDLER: IpcHandler = {
  name: 'unhandled',
  replies: true,
  run(ctx) {
    if (import.meta.env.DEV) {
      logService.warn(`[IPC] Unhandled message type: ${ctx.type}`);
    }
  },
};

/**
 * Terminal handlers keyed by exact message type. A new non-api frame needs an
 * entry here — plus a `beforeIdentity` decision — not a permission.
 */
export const IPC_HANDLERS: Readonly<Record<string, IpcHandler>> = {
  'asyar:window:hide': windowHide,
  'asyar:dev:rpc-log': devInspectorLog,
  'asyar:dev:ipc-log': devInspectorLog,
  'asyar:feedback:uncaught': feedbackUncaught,
  'asyar:stream:abort': streamAbort,
  'asyar:extension:loaded': extensionLoaded,
  'asyar:api:actions:registerActionHandler': registerActionHandler,
};

export function resolvePreIdentityHandler(ctx: IpcContext): IpcHandler | undefined {
  const handler = IPC_HANDLERS[ctx.type];
  if (!handler?.beforeIdentity) return undefined;
  return (handler.match?.(ctx) ?? true) ? handler : undefined;
}

export function resolveTerminalHandler(ctx: IpcContext): IpcHandler {
  const handler = IPC_HANDLERS[ctx.type];
  if (handler && !handler.beforeIdentity) return handler;
  return ctx.type.startsWith('asyar:api:') ? API_CALL_HANDLER : UNHANDLED_FRAME_HANDLER;
}
