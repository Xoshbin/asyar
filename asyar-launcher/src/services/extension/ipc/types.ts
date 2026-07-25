import type { ExtendedManifest } from '../../../types/ExtendedManifest';
import type { ServiceRegistry } from '../defineServiceRegistry';

export type IframeRole = 'view' | 'worker';

/**
 * Everything a stage or handler is allowed to reach. DOM lookups and service
 * dispatch arrive as functions so stages stay unit-testable without a real
 * iframe tree behind them.
 */
export interface IpcDeps {
  serviceRegistry: ServiceRegistry;
  getManifestById: (id: string) => ExtendedManifest | undefined;
  goBack: () => void;
  saveSearchIndex: () => void;
  findExtensionIdForSource: (source: MessageEventSource | null) => string | undefined;
  findIframeRoleForSource: (source: MessageEventSource | null) => IframeRole | undefined;
  dispatchApiCall: (
    type: string,
    payload: any,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
    originRole?: IframeRole,
  ) => Promise<unknown>;
}

export interface IpcContext {
  readonly event: MessageEvent;
  /** The raw message body — `asyar:stream:abort` reads `streamId` off it. */
  readonly data: any;
  readonly type: string;
  readonly payload: any;
  readonly messageId: string | undefined;
  readonly source: MessageEventSource | null;
  readonly isPrivilegedHostContext: boolean;
  readonly deps: IpcDeps;
  extensionId?: string;
  role?: IframeRole;
  result: unknown;
  reply: (result: unknown) => void;
  replyError: (error: string) => void;
}

/** Cross-cutting stage. Not calling `next()` ends the message here. */
export interface IpcStage {
  name: string;
  run(ctx: IpcContext, next: () => Promise<void>): Promise<void>;
}

export interface IpcHandler {
  name: string;
  /**
   * Terminal before the identify/permissionGate stages run. Declaring this is
   * what keeps a frame out of the gate — not where the handler sits in a list.
   */
  beforeIdentity?: boolean;
  /** Post an `asyar:response` envelope carrying `ctx.result` once resolved. */
  replies?: boolean;
  /** False means "not this frame after all" — fall through to the rest of the pipeline. */
  match?: (ctx: IpcContext) => boolean;
  run(ctx: IpcContext): Promise<void> | void;
}
