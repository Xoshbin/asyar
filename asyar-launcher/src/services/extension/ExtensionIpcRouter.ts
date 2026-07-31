import { logService } from '../log/logService';
import * as commands from '../../lib/ipc/commands';
import { contributeShortcodes, revokeShortcodes } from '../../lib/ipc/shortcodeCommands';
import { messageBroker, type Namespace } from 'asyar-sdk/contracts';
import type { ServiceRegistry } from './defineServiceRegistry';
import type { ExtendedManifest } from '../../types/ExtendedManifest';
import { HandledDispatchError } from './ipc/errors';
import { runIpcPipeline } from './ipc/pipeline';
import type { IframeRole, IpcContext, IpcDeps } from './ipc/types';

const EXTENSION_INVOKE_DISPATCH: Record<string, (args: any) => Promise<any>> = {
  search_items: (args) => commands.searchItems(args?.query ?? ''),
  check_path_exists: (args) => commands.checkPathExists(args?.path ?? ''),
  list_applications: () => commands.listApplications(),
  get_extensions_dir: () => commands.getExtensionsDir(),
  list_installed_extensions: () => commands.listInstalledExtensions(),
  get_builtin_extensions_path: () => commands.getBuiltinFeaturesPath(),
  get_indexed_object_ids: () => commands.getIndexedObjectIds(),
  get_autostart_status: () => commands.getAutostartStatus(),
  get_persisted_shortcut: () => commands.getPersistedShortcut(),
  check_snippet_permission: () => commands.checkSnippetPermission(),
};

// Kept for documentation — actual dispatch uses EXTENSION_INVOKE_DISPATCH
export const ALLOWED_EXTENSION_INVOKE_COMMANDS = new Set(Object.keys(EXTENSION_INVOKE_DISPATCH));

/**
 * Services whose first parameter is the calling extension's ID.
 * Only injected when `extensionId` is present (i.e., from an iframe context).
 * Example: `storage.get(extensionId, key)` — the extension never passes its own ID.
 *
 * If you add a new service that needs per-extension scoping, add its canonical
 * namespace here. Missing it means the service receives the raw IPC payload as
 * its first argument instead of the extension ID — a silent, hard-to-debug bug.
 */
export const INJECTS_EXTENSION_ID = new Set<Namespace>([
  'storage',
  'oauth',
  'shell',
  'interop',
  'cache',
  'preferences',
  'power',
  'screen',
  'process',
  'systemEvents',
  'appEvents',
  'timers',
  'fsWatcher',
  'state',
  'searchBar',
  'feedback',
  'onboarding',
  'runs',
  'tools',
] as const satisfies readonly Namespace[]);

/**
 * Services that ALWAYS receive the caller identity as the first argument —
 * even `null` for privileged host-context calls. Used for audit logging where
 * the service needs to know who triggered the request regardless of context.
 */
export const ALWAYS_INJECTS_CALLER_ID = new Set<Namespace>([
  'network',
  'applicationIndex',
  'files',
  'opener',
  'browser',
] as const satisfies readonly Namespace[]);

export class ExtensionIpcRouter {
  private readonly deps: IpcDeps;

  constructor(
    private serviceRegistry: ServiceRegistry,
    getManifestById: (id: string) => ExtendedManifest | undefined,
    goBack: () => void,
    saveSearchIndex: () => void,
  ) {
    this.deps = {
      serviceRegistry,
      getManifestById,
      goBack,
      saveSearchIndex,
      findExtensionIdForSource: (source) => this.findExtensionIdForSource(source),
      findIframeRoleForSource: (source) => this.findIframeRoleForSource(source),
      dispatchApiCall: (type, payload, extensionId, isPrivileged, originRole) =>
        this.dispatchApiCall(type, payload, extensionId, isPrivileged, originRole),
    };
  }

  public setup(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('message', (event: MessageEvent) => {
      void this.handleMessage(event);
    });

    // Tier-1 built-ins run in the host window; dispatch their invokes
    // synchronously so nav-stack side effects land before the caller's
    // await resumes. This bypasses the pipeline by design — the host is the
    // privileged context. Iframes continue to use postMessage.
    messageBroker.setHostDispatcher((command, payload, extensionId) =>
      this.dispatchApiCall(`asyar:api:${command}`, payload, extensionId, true),
    );
  }

  /** Runs one incoming frame through the declared pipeline. */
  public async handleMessage(event: MessageEvent): Promise<void> {
    await runIpcPipeline(this.createContext(event));
  }

  private createContext(event: MessageEvent): IpcContext {
    const data = event.data ?? {};
    const source = event.source;
    const messageId = data.messageId;
    const post = (body: Record<string, unknown>) => {
      (source as WindowProxy | null)?.postMessage(
        { type: 'asyar:response', messageId, ...body },
        '*',
      );
    };

    return {
      event,
      data,
      type: data.type,
      payload: data.payload,
      messageId,
      source,
      isPrivilegedHostContext: source === window,
      deps: this.deps,
      result: undefined,
      reply: (result) => post({ result }),
      replyError: (error) => post({ error }),
    };
  }

  /**
   * Find the iframe whose `contentWindow` matches `source` and read its
   * `data-extension-id` attribute. Returns undefined when source is not a
   * known Tier 2 iframe. Trusted — the attribute is host-set on the element.
   */
  private findExtensionIdForSource(source: MessageEventSource | null): string | undefined {
    return this.findFrameForSource(source)?.dataset.extensionId;
  }

  /**
   * Find the iframe whose `contentWindow` matches `source` and read its
   * `data-role` attribute. Returns undefined for Tier 1 built-ins (host
   * window = privileged context) or anything that doesn't look like a
   * Tier 2 iframe. Trusted path — the attribute is set by the host when
   * the iframe is created, not by extension code.
   */
  private findIframeRoleForSource(source: MessageEventSource | null): IframeRole | undefined {
    const role = this.findFrameForSource(source)?.dataset.role;
    return role === 'view' || role === 'worker' ? role : undefined;
  }

  private findFrameForSource(source: MessageEventSource | null): HTMLIFrameElement | undefined {
    if (!source || typeof document === 'undefined') return undefined;
    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe[data-extension-id]');
    for (let index = 0; index < iframes.length; index += 1) {
      const frame = iframes[index];
      if (frame?.contentWindow === source) return frame;
    }
    return undefined;
  }

  private async dispatchApiCall(
    type: string,
    payload: any,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
    originRole?: IframeRole,
  ): Promise<unknown> {
    const parts = type.split(':');
    const serviceName = parts[2];
    const methodName = parts[3] || parts[2];

    if (type === 'asyar:api:invoke') {
      const handler = EXTENSION_INVOKE_DISPATCH[payload?.cmd];
      if (!handler) {
        if (!isPrivilegedHostContext) {
          logService.warn(
            `[PermissionGate] BLOCKED invoke: iframe extension "${extensionId}" tried to call non-allowlisted command "${payload?.cmd}"`,
          );
        }
        throw new Error(`Command "${payload?.cmd}" is not available to extensions`);
      }
      const result = await handler(payload?.args);
      if (result === null) {
        throw new HandledDispatchError(`Command "${payload?.cmd}" failed`);
      }
      return result;
    }

    if (type === 'asyar:api:snippets:registerShortcodes') {
      const { map } = payload as { map: Record<string, string> };
      const ok = await contributeShortcodes(extensionId, map);
      if (!ok) throw new HandledDispatchError('contribute_shortcodes failed');
      return undefined;
    }

    if (type === 'asyar:api:snippets:unregisterShortcodes') {
      const ok = await revokeShortcodes(extensionId);
      if (!ok) throw new HandledDispatchError('revoke_shortcodes failed');
      return undefined;
    }

    const ns = serviceName as Namespace;
    const service = this.serviceRegistry[ns] as Record<string, unknown> | undefined;
    const method = service?.[methodName];
    if (!service || typeof method !== 'function') {
      logService.warn(
        `[Main] Dispatch failed for ${type}: Service ${serviceName}.${methodName} not found`,
      );
      return undefined;
    }

    // shell.spawn keeps Tier-1-only slots (subjectId, label) between
    // originRole and silent, so the positional Object.values dispatch below
    // cannot reach its tail. Build this one call explicitly.
    if (ns === 'shell' && methodName === 'spawn') {
      const p = (payload ?? {}) as Record<string, unknown>;
      return await (method as (...a: unknown[]) => unknown).apply(service, [
        extensionId,
        p.program,
        p.args,
        p.spawnId,
        originRole,
        undefined,
        undefined,
        p.silent === true,
      ]);
    }

    let args: unknown[];
    if (payload === null || payload === undefined) {
      args = [];
    } else if (typeof payload !== 'object' || Array.isArray(payload)) {
      args = Array.isArray(payload) ? payload : [payload];
    } else {
      const values = Object.values(payload as Record<string, unknown>);
      args = values.length === 0 ? [] : values;
    }
    if (INJECTS_EXTENSION_ID.has(ns) && extensionId) {
      args = [extensionId, ...args];
    } else if (ALWAYS_INJECTS_CALLER_ID.has(ns)) {
      args = [isPrivilegedHostContext ? null : (extensionId ?? null), ...args];
    }
    if (ns === 'shell' && methodName === 'attach' && originRole) {
      args = [...args, originRole];
    }
    return await (method as (...a: unknown[]) => unknown).apply(service, args);
  }
}
