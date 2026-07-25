import { logService } from '../../log/logService';
import * as commands from '../../../lib/ipc/commands';
import { feedbackService } from '../../feedback/feedbackService.svelte';
import { extensionIframeManager } from '../extensionIframeManager.svelte';
import { isExternallyConsumedExtensionResponse } from '../../../lib/ipc/extensionMessageProtocol';
import { HandledDispatchError, classifyProxyError, extractErrorMessage } from './errors';
import { resolvePreIdentityHandler, resolveTerminalHandler } from './handlers';
import type { IpcContext, IpcStage } from './types';

/** Search replies are consumed by a dedicated bridge, on every frame, first. */
const tap: IpcStage = {
  name: 'tap',
  async run(ctx, next) {
    extensionIframeManager.handleSearchResponse(ctx.event);
    await next();
  },
};

/**
 * Only `asyar:` frames are ours, and a response is not a request — re-entering
 * dispatch on one would answer it and loop.
 */
const protocolFilter: IpcStage = {
  name: 'protocolFilter',
  async run(ctx, next) {
    if (!ctx.type || !ctx.type.startsWith('asyar:')) return;
    if (ctx.type === 'asyar:response') return;
    if (isExternallyConsumedExtensionResponse(ctx.type)) return;
    await next();
  },
};

/** Handlers that declare `beforeIdentity` terminate here — above the gate. */
const preIdentityHandlers: IpcStage = {
  name: 'preIdentityHandlers',
  async run(ctx, next) {
    const handler = resolvePreIdentityHandler(ctx);
    if (!handler) {
      await next();
      return;
    }
    await handler.run(ctx);
  },
};

const identify: IpcStage = {
  name: 'identify',
  async run(ctx, next) {
    if (ctx.isPrivilegedHostContext) {
      // The host window has no iframe element; its payload-supplied id is
      // already trusted because only host code can post as `window`.
      ctx.extensionId = ctx.data?.extensionId || ctx.payload?.extensionId;
      await next();
      return;
    }

    // Untrusted frames get their identity from host-set iframe attributes,
    // never the message body — a payload id would let any extension
    // impersonate another.
    ctx.extensionId = ctx.deps.findExtensionIdForSource(ctx.source);
    ctx.role = ctx.deps.findIframeRoleForSource(ctx.source);

    if (!ctx.extensionId) {
      logService.error(
        `[Main] Rejected IPC message: No extensionId provided by untrusted frame for type ${ctx.type}`,
      );
      return;
    }

    if (!ctx.deps.getManifestById(ctx.extensionId)) {
      logService.error(
        `[Main] Unauthorized: No registered manifest found for iframe extension ${ctx.extensionId}`,
      );
      const unknownError = `Unknown extension: ${ctx.extensionId}`;
      ctx.replyError(unknownError);
      void feedbackService.report({
        source: 'extension',
        kind: classifyProxyError(ctx.type, unknownError),
        severity: 'warning',
        retryable: false,
        context: { method: ctx.type, error: unknownError },
        extensionId: ctx.extensionId,
      });
      return;
    }

    await next();
  },
};

/**
 * `asyar:api:*` is the only permission-bearing surface and the only one the
 * Rust gate classifies. Lifecycle/transport frames are ungated by design — a
 * new one needs a handler, not a permission.
 */
const permissionGate: IpcStage = {
  name: 'permissionGate',
  async run(ctx, next) {
    if (ctx.isPrivilegedHostContext || !ctx.type.startsWith('asyar:api:')) {
      await next();
      return;
    }

    // Fail closed: a failed check (null) must deny, not fall through.
    const permissionResult = await commands.checkExtensionPermission(ctx.extensionId!, ctx.type);
    if (permissionResult?.allowed) {
      await next();
      return;
    }

    logService.warn(
      `[PermissionGate] BLOCKED: ${permissionResult?.reason ?? 'permission check failed'}`,
    );
    // Rust sets `requiredPermission` only for calls gated on a real manifest
    // permission. The fail-closed path sends only `reason` — and a call type is
    // not a permission name, so "declare it in manifest.json" would be
    // unfollowable advice there.
    const permError = permissionResult?.requiredPermission
      ? `Permission denied: "${permissionResult.requiredPermission}" is required but not declared in manifest.json`
      : (permissionResult?.reason ?? `Blocked "${ctx.type}": permission check failed`);
    ctx.replyError(permError);
    void feedbackService.report({
      source: 'extension',
      kind: classifyProxyError(ctx.type, permError),
      severity: 'warning',
      retryable: false,
      context: { method: ctx.type, error: permError },
      extensionId: ctx.extensionId,
    });
  },
};

const replyEnvelope: IpcStage = {
  name: 'replyEnvelope',
  async run(ctx, next) {
    try {
      await next();
    } catch (error) {
      const catchError = extractErrorMessage(error);
      logService.error(`[Main] IPC handling error for ${ctx.extensionId}: ${catchError}`);
      ctx.replyError(catchError);
      // invokeSafe wrappers already reported their own diagnostic.
      if (!(error instanceof HandledDispatchError)) {
        void feedbackService.report({
          source: 'extension',
          kind: classifyProxyError(ctx.type, catchError),
          severity: 'warning',
          retryable: false,
          context: { method: ctx.type, error: catchError },
          extensionId: ctx.extensionId ?? 'unknown',
        });
      }
    }
  },
};

const dispatch: IpcStage = {
  name: 'dispatch',
  async run(ctx) {
    logService.debug(
      `[Main] Received IPC message${
        ctx.extensionId ? ` from ${ctx.extensionId}` : ' from Privileged Host Context'
      }: ${ctx.type}`,
    );
    const handler = resolveTerminalHandler(ctx);
    await handler.run(ctx);
    if (handler.replies) ctx.reply(ctx.result);
  },
};

/** The order is data so a test can assert it. */
export const IPC_PIPELINE: readonly IpcStage[] = [
  tap,
  protocolFilter,
  preIdentityHandlers,
  identify,
  permissionGate,
  replyEnvelope,
  dispatch,
];

export async function runIpcPipeline(
  ctx: IpcContext,
  stages: readonly IpcStage[] = IPC_PIPELINE,
): Promise<void> {
  let reached = -1;
  const invoke = async (index: number): Promise<void> => {
    if (index <= reached) throw new Error('[IpcRouter] next() called twice in one stage');
    reached = index;
    const stage = stages[index];
    if (!stage) return;
    await stage.run(ctx, () => invoke(index + 1));
  };
  await invoke(0);
}
