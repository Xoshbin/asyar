import { logService } from "../log/logService";
import * as commands from "../../lib/ipc/commands";
import { envService } from "../envService";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { NotificationService } from "../notification/notificationService";
import type { ExtensionManifest } from "asyar-sdk";
import { extensionIframeManager } from './extensionIframeManager.svelte';

interface ExtendedManifest extends ExtensionManifest {
  permissions?: string[];
}

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

export class ExtensionIpcRouter {
  constructor(
    private serviceRegistry: Record<string, any>,
    private getManifestById: (id: string) => ExtendedManifest | undefined,
    private goBack: () => void,
    private saveSearchIndex: () => void
  ) {}

  public setup(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('message', async (event: MessageEvent) => {
      extensionIframeManager.handleSearchResponse(event);
      
      const { type, payload, messageId, extensionId: msgExtensionId } = event.data;
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
          }, event.origin && event.origin !== 'null' ? event.origin : '*');
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
            }, event.origin && event.origin !== 'null' ? event.origin : '*');
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
            }, event.origin && event.origin !== 'null' ? event.origin : '*');
            return;
          }
        }
      }

      logService.debug(`[Main] Received IPC message${extensionId ? ` from ${extensionId}` : ' from Privileged Host Context'}: ${type}`);

      try {
        let result: any;
        
        // Unify handling for asyar:api:* and asyar:service:*
        if (type.startsWith('asyar:api:') || type.startsWith('asyar:service:')) {
          const parts = type.split(':');
          let serviceName = '';
          let methodName = '';
          let isServiceStyle = type.startsWith('asyar:service:');

          if (isServiceStyle) {
            serviceName = parts[2];
            methodName = parts[3];
          } else {
            serviceName = parts[2];
            methodName = parts[3] || parts[2];
          }

          const serviceMap: Record<string, string> = {
            'log': 'LogService',
            'extension': 'ExtensionManager',
            'notification': 'NotificationService',
            'clipboard': 'ClipboardHistoryService',
            'command': 'CommandService',
            'action': 'ActionService',
            'statusbar': 'StatusBarService',
            'entitlement': 'EntitlementService',
            'storage': 'StorageService',
            'feedback': 'FeedbackService',
          };
          
          const targetServiceName = serviceMap[serviceName] || serviceName;

          if (type === 'asyar:api:invoke') {
             const handler = EXTENSION_INVOKE_DISPATCH[payload?.cmd];
             if (!handler) {
               if (!isPrivilegedHostContext) {
                 logService.warn(`[PermissionGate] BLOCKED invoke: iframe extension "${extensionId}" tried to call non-allowlisted command "${payload?.cmd}"`);
               }
               throw new Error(`Command "${payload?.cmd}" is not available to extensions`);
             }
             if (envService.isTauri) {
               result = await handler(payload?.args);
             } else {
               logService.warn(`[Main] Mocking invoke for ${payload?.cmd} in browser`);
               result = null;
             }
          } else if (type === 'asyar:api:opener:open') {
             const { url } = payload;
             if (url && envService.isTauri) {
               await commands.openUrl(url);
             }
          } else if (type === 'asyar:api:notification:notify' || type === 'asyar:api:notification:show') {
            if (envService.isTauri && import.meta.env.DEV) {
              const opts = (payload && typeof payload === 'object' && 'options' in payload)
                ? (payload as { options: { title?: string; body?: string } }).options
                : payload as { title?: string; body?: string };
              await commands.sendNotification({
                title: opts?.title ?? '',
                body:  opts?.body  ?? '',
                callerExtensionId: isPrivilegedHostContext ? null : (extensionId ?? null),
              });
            } else {
              const ns = this.serviceRegistry['NotificationService'] as NotificationService;
              const opts = (payload && typeof payload === 'object' && 'options' in payload)
                ? (payload as { options: any }).options
                : payload;
              await ns.notify(opts);
            }
          } else if (type === 'asyar:api:network:fetch') {
             const { url, options } = payload;
             if (envService.isTauri) {
               result = await commands.fetchUrl({
                 url,
                 method: options?.method ?? 'GET',
                 headers: options?.headers,
                 timeoutMs: options?.timeout ?? 20000,
                 callerExtensionId: isPrivilegedHostContext ? null : (extensionId ?? null),
               });
             } else {
               const res = await httpFetch(url, {
                 method: options?.method ?? 'GET',
                 headers: options?.headers,
                 body: options?.body,
               });
               const responseHeaders: Record<string, string> = {};
               res.headers.forEach((value: string, key: string) => { responseHeaders[key] = value; });
               const body = await res.text();
               result = {
                 status: res.status,
                 statusText: res.statusText,
                 headers: responseHeaders,
                 body,
                 ok: res.ok,
               };
             }
          } else {
             const service = this.serviceRegistry[targetServiceName];
             if (service && typeof service[methodName] === 'function') {
               if (isServiceStyle && Array.isArray(payload)) {
                 result = await service[methodName](...payload);
               } else {
                 let args: unknown[];
                 if (payload === null || payload === undefined) {
                   args = [];
                 } else if (typeof payload !== 'object' || Array.isArray(payload)) {
                   args = Array.isArray(payload) ? payload : [payload];
                 } else {
                   const values = Object.values(payload as Record<string, unknown>);
                   args = values.length === 0 ? [] : values;
                 }
                 // StorageService: inject extensionId as first arg for data isolation
                 if (targetServiceName === 'StorageService' && extensionId) {
                   args = [extensionId, ...args];
                 }
                 result = await service[methodName](...args);
               }
             } else if (type === 'asyar:extension:loaded') {
                logService.info(`Extension ready: ${extensionId}`);
             } else if (type === 'asyar:api:notification:show') {
                new NotificationService().notify(payload);
             } else {
               logService.warn(`[Main] Dispatch failed for ${type}: Service ${targetServiceName}.${methodName} not found`);
             }
          }
        } else {
           if (import.meta.env.DEV) {
              logService.warn(`[IPC] Unhandled message type: ${type}`);
           }
        }

        (event.source as WindowProxy)?.postMessage({
          type: 'asyar:response',
          messageId,
          result
        }, event.origin && event.origin !== 'null' ? event.origin : '*');

      } catch (error) {
        logService.error(`[Main] IPC handling error for ${extensionId}: ${error}`);
        (event.source as Window)?.postMessage({
          type: 'asyar:response',
          messageId,
          error: error instanceof Error ? error.message : String(error)
        }, event.origin && event.origin !== 'null' ? event.origin : '*');
      }
    });
  }
}
