import { logService } from "../log/logService";
import * as commands from "../../lib/ipc/commands";
import { envService } from "../envService";
import { extensionIframeManager } from './extensionIframeManager.svelte';
import { extensionPreferencesService } from './extensionPreferencesService.svelte';
import { streamDispatcher } from './streamDispatcher.svelte';
import { messageBroker, type Namespace } from 'asyar-sdk/contracts';
import type { ServiceRegistry } from './defineServiceRegistry';
import type { ExtendedManifest } from '../../types/ExtendedManifest';

const EXTENSION_INVOKE_DISPATCH: Record<string, (args: any) => Promise<any>> = {
  'search_items': (args) => commands.searchItems(args?.query ?? ''),
  'check_path_exists': (args) => commands.checkPathExists(args?.path ?? ''),
  'list_applications': () => commands.listApplications(),
  'get_extensions_dir': () => commands.getExtensionsDir(),
  'list_installed_extensions': () => commands.listInstalledExtensions(),
  'get_builtin_extensions_path': () => commands.getBuiltinFeaturesPath(),
  'get_indexed_object_ids': () => commands.getIndexedObjectIds(),
  'get_autostart_status': () => commands.getAutostartStatus(),
  'get_persisted_shortcut': () => commands.getPersistedShortcut(),
  'check_snippet_permission': () => commands.checkSnippetPermission(),
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
  'storage', 'ai', 'oauth', 'shell', 'interop', 'cache', 'preferences', 'notifications', 'power', 'systemEvents', 'appEvents', 'timers', 'state',
] as const satisfies readonly Namespace[]);

/**
 * Services that ALWAYS receive the caller identity as the first argument —
 * even `null` for privileged host-context calls. Used for audit logging where
 * the service needs to know who triggered the request regardless of context.
 */
export const ALWAYS_INJECTS_CALLER_ID = new Set<Namespace>([
  'network',
] as const satisfies readonly Namespace[]);

export class ExtensionIpcRouter {
  constructor(
    private serviceRegistry: ServiceRegistry,
    private getManifestById: (id: string) => ExtendedManifest | undefined,
    private goBack: () => void,
    private saveSearchIndex: () => void
  ) {}

  public setup(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('message', async (event: MessageEvent) => {
      extensionIframeManager.handleSearchResponse(event);
      
      const data = event.data;
      const { type, payload, messageId, extensionId: msgExtensionId } = data;
      if (!type || !type.startsWith('asyar:')) return;

      // Extension requests launcher to hide
      if (type === 'asyar:window:hide') {
        this.goBack();
        this.saveSearchIndex();
        commands.hideWindow();
        return;
      }
      
      // Ignore responses sent to extensions from the main process to prevent infinite loops
      if (type === 'asyar:response') return;

      // Dev-only: route Phase 7 inspector diagnostic logs (from both view
      // and worker iframes). Gated by `import.meta.env.DEV` + dynamic
      // import so production bundles tree-shake the dev store entirely.
      if (import.meta.env.DEV && (type === 'asyar:dev:rpc-log' || type === 'asyar:dev:ipc-log')) {
        const devExtensionId = payload?.extensionId || msgExtensionId;
        if (devExtensionId) {
          void import('../dev/inspectorStore.svelte').then(({ inspectorStore }) => {
            if (type === 'asyar:dev:rpc-log') {
              inspectorStore.recordRpcLog(devExtensionId, payload);
            } else {
              inspectorStore.recordIpcLog(devExtensionId, payload);
            }
          });
        }
        return;
      }

      const isPrivilegedHostContext = event.source === window;
      const extensionId = msgExtensionId || payload?.extensionId;

      // Mandatory Validation only for external iframe contexts
      if (!isPrivilegedHostContext) {
        if (!extensionId) {
          logService.error(`[Main] Rejected IPC message: No extensionId provided by untrusted frame for type ${type}`);
          return;
        }

        const manifest = this.getManifestById(extensionId);
        if (!manifest) {
          logService.error(`[Main] Unauthorized: No registered manifest found for iframe extension ${extensionId}`);
          (event.source as Window)?.postMessage({
            type: 'asyar:response',
            messageId,
            error: `Unknown extension: ${extensionId}`
          }, '*');
          return;
        }

        // --- Permission Gate ---
        if (envService.isTauri) {
          const permissionResult = await commands.checkExtensionPermission(extensionId, type);
          if (!permissionResult.allowed) {
            logService.warn(`[PermissionGate] BLOCKED: ${permissionResult.reason}`);
            (event.source as Window)?.postMessage({
              type: 'asyar:response',
              messageId,
              error: `Permission denied: "${permissionResult.requiredPermission}" is required but not declared in manifest.json`
            }, '*');
            return;
          }
        } else {
          // Browser fallback: use the local TS permission check
          const { checkPermission } = await import("../permissionGate");
          const permissionResult = checkPermission(extensionId, type, manifest.permissions ?? []);
          if (!permissionResult.allowed) {
            logService.warn(`[PermissionGate] BLOCKED: ${permissionResult.reason}`);
            (event.source as Window)?.postMessage({
              type: 'asyar:response',
              messageId,
              error: `Permission denied: "${permissionResult.requiredPermission}" is required but not declared in manifest.json`
            }, '*');
            return;
          }
        }
      }

      logService.debug(`[Main] Received IPC message${extensionId ? ` from ${extensionId}` : ' from Privileged Host Context'}: ${type}`);

      try {
        let result: any;

        if (type === 'asyar:stream:abort') {
          const streamId =
            (payload as { streamId?: string } | undefined)?.streamId ??
            (data as { streamId?: string }).streamId;
          if (!streamId || typeof streamId !== 'string') {
            logService.warn('[IpcRouter] asyar:stream:abort message missing streamId — ignoring');
            return;
          }
          streamDispatcher.abort(streamId);
          return;
        }

        // Extension iframe signals it has booted and is ready to receive
        // its initial preferences bundle. Reply with the resolved
        // preferences via asyar:event:preferences:set-all so the SDK's
        // ExtensionBridge can install the frozen snapshot on the live
        // ExtensionContext. This MUST be handled at the top level —
        // nesting it under the asyar:api:* branch (as previously) would
        // make the handler unreachable because this message type starts
        // with `asyar:extension:` not `asyar:api:`.
        if (type === 'asyar:extension:loaded') {
          logService.info(`Extension ready: ${extensionId}`);
          if (extensionId) {
            const bundle = await extensionPreferencesService.getEffectivePreferences(extensionId);
            (event.source as WindowProxy)?.postMessage({
              type: 'asyar:event:preferences:set-all',
              payload: {
                extension: bundle.extension,
                commands: bundle.commands,
              }
            }, '*');
          }
          return;
        }

        if (type.startsWith('asyar:api:')) {
          result = await this.dispatchApiCall(type, payload, extensionId, isPrivilegedHostContext);
        } else {
           if (import.meta.env.DEV) {
              logService.warn(`[IPC] Unhandled message type: ${type}`);
           }
        }

        (event.source as WindowProxy)?.postMessage({
          type: 'asyar:response',
          messageId,
          result
        }, '*');

      } catch (error) {
        logService.error(`[Main] IPC handling error for ${extensionId}: ${error}`);
        (event.source as Window)?.postMessage({
          type: 'asyar:response',
          messageId,
          error: error instanceof Error ? error.message : String(error)
        }, '*');
      }
    });

    // Tier-1 built-ins run in the host window; dispatch their invokes
    // synchronously so nav-stack side effects land before the caller's
    // await resumes. Iframes continue to use postMessage.
    messageBroker.setHostDispatcher((command, payload, extensionId) =>
      this.dispatchApiCall(`asyar:api:${command}`, payload, extensionId, true),
    );
  }

  private async dispatchApiCall(
    type: string,
    payload: any,
    extensionId: string | undefined,
    isPrivilegedHostContext: boolean,
  ): Promise<unknown> {
    const parts = type.split(':');
    const serviceName = parts[2];
    const methodName = parts[3] || parts[2];

    if (type === 'asyar:api:invoke') {
      const handler = EXTENSION_INVOKE_DISPATCH[payload?.cmd];
      if (!handler) {
        if (!isPrivilegedHostContext) {
          logService.warn(`[PermissionGate] BLOCKED invoke: iframe extension "${extensionId}" tried to call non-allowlisted command "${payload?.cmd}"`);
        }
        throw new Error(`Command "${payload?.cmd}" is not available to extensions`);
      }
      if (envService.isTauri) {
        return await handler(payload?.args);
      }
      logService.warn(`[Main] Mocking invoke for ${payload?.cmd} in browser`);
      return null;
    }

    const ns = serviceName as Namespace;
    const service = this.serviceRegistry[ns] as Record<string, unknown> | undefined;
    const method = service?.[methodName];
    if (!service || typeof method !== 'function') {
      logService.warn(`[Main] Dispatch failed for ${type}: Service ${serviceName}.${methodName} not found`);
      return undefined;
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
    return await (method as (...a: unknown[]) => unknown).apply(service, args);
  }
}
